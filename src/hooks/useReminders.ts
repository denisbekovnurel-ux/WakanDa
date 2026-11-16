import { useCallback, useEffect } from 'react';
import { pluralize } from '../utils/pluralize';
import { useFeedback } from '../components/FeedbackContext';
import { useAuth } from '../auth/AuthContext';
import { translate } from '../i18n';
import type { OneOffTask } from '../types';

const PERIODIC_SYNC_TAG = 'wakanda-daily-reminder';
// Как и сервер, догоняем пропущенное напоминание в пределах трёх часов.
const DAILY_GRACE_MS = 3 * 60 * 60 * 1000;
// Напоминание о разовой задаче полезно и спустя сутки: задача всё ещё не закрыта.
const ONE_OFF_GRACE_MS = 24 * 60 * 60 * 1000;

interface PeriodicSyncManager {
  register: (tag: string, options?: { minInterval: number }) => Promise<void>;
}

type PeriodicSyncRegistration = ServiceWorkerRegistration & {
  periodicSync?: PeriodicSyncManager;
};

export interface ReminderSettings {
  enabled: boolean;
  reminderTimes: string[];
  oneOffTasks: OneOffTask[];
  pendingHabits: number;
  todayKey: string;
}

async function getActiveServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // В dev service worker не регистрируется, и `ready` ждал бы вечно.
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (!registrations.length) return null;
  return navigator.serviceWorker.ready;
}

async function hasPushSubscription(): Promise<boolean> {
  try {
    const registration = await getActiveServiceWorker();
    return Boolean(registration?.pushManager && (await registration.pushManager.getSubscription()));
  } catch {
    // не смогли проверить — лучше показать локальное уведомление, чем промолчать
    return false;
  }
}

async function showLocalReminder(message: string, title = translate('WakanDa — время свериться')): Promise<boolean> {
  try {
    const registration = await getActiveServiceWorker();
    if (registration) {
      await registration.showNotification(title, { body: message, icon: '/icons/icon.svg' });
    } else {
      new Notification(title, { body: message });
    }
    return true;
  } catch {
    try {
      new Notification(title, { body: message });
      return true;
    } catch {
      // уведомление не показали — фиксируем успех только после реальной отправки
      return false;
    }
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // приватный режим: на время сессии просто не повторимся чаще интервала
  }
}

async function registerPeriodicSync(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    const registration = await getActiveServiceWorker() as PeriodicSyncRegistration | null;
    if (!registration) return;
    const periodicSync = registration.periodicSync;
    if (!periodicSync) return;
    await periodicSync.register(PERIODIC_SYNC_TAG, {
      minInterval: 12 * 60 * 60 * 1000, // браузер может увеличить интервал сам
    });
  } catch {
    // periodicBackgroundSync поддерживается только в части браузеров — тихо отступаем
  }
}

/**
 * Единственное место, где живёт локальная логика напоминаний.
 * Честно: без фоновой синхронизации уведомление приходит, только пока сайт открыт.
 */
export function useReminders({ enabled, reminderTimes, oneOffTasks, pendingHabits, todayKey }: ReminderSettings) {
  const { notify } = useFeedback();
  const { user } = useAuth();
  const userId = user?.id ?? 'anon';
  const timesKey = reminderTimes.join(',');

  useEffect(() => {
    if (!enabled) return undefined;
    const times = timesKey.split(',').filter(Boolean);

    async function checkReminder() {
      if (pendingHabits === 0 || !('Notification' in window) || Notification.permission !== 'granted') return;
      // Фоновая вкладка не должна дёргать уведомление в момент возврата.
      if (document.visibilityState === 'hidden') return;
      const now = new Date();
      // Проверяем каждый слот отдельно. Напоминание, которое уже ушло, не
      // повторяем: ключ в localStorage привязан ко времени и дате.
      const due = times.filter((time) => {
        const [hours, minutes] = String(time).split(':').map(Number);
        if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false;
        const target = new Date(now);
        target.setHours(hours, minutes, 0, 0);
        const diff = now.getTime() - target.getTime();
        return diff >= 0 && diff <= DAILY_GRACE_MS;
      });
      if (!due.length) return;

      // Если активен серверный push, напоминания уже уйдут с бэкенда (даже при
      // закрытой вкладке) — локальные только дублировали бы их.
      if (await hasPushSubscription()) return;

      const message = translate('Осталось отметить {count} {unit}.', {
        count: pendingHabits,
        unit: pluralize(pendingHabits, 'привычку', 'привычки', 'привычек'),
      });
      for (const time of due) {
        const key = `wakanda-last-reminder:${userId}:${todayKey}:${time}`;
        if (readFlag(key)) continue;
        if (await showLocalReminder(message)) writeFlag(key);
      }
    }

    const interval = window.setInterval(checkReminder, 15000);
    document.addEventListener('visibilitychange', checkReminder);
    window.addEventListener('focus', checkReminder);
    checkReminder();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkReminder);
      window.removeEventListener('focus', checkReminder);
    };
  }, [enabled, timesKey, pendingHabits, todayKey, userId]);

  // Напоминания о разовых задачах не зависят от ежедневного переключателя:
  // если пользователь выбрал время для задачи, он ждёт уведомление.
  useEffect(() => {
    const scheduled = oneOffTasks.filter((task) => !task.done && task.reminderAt);
    if (!scheduled.length) return undefined;

    async function checkOneOff() {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (document.visibilityState === 'hidden') return;
      if (await hasPushSubscription()) return;
      const now = Date.now();
      for (const task of scheduled) {
        const at = task.reminderAt ? Date.parse(task.reminderAt) : Number.NaN;
        if (!Number.isFinite(at) || at > now || now - at > ONE_OFF_GRACE_MS) continue;
        const key = `wakanda-oneoff-reminder:${userId}:${task.id}:${task.reminderAt}`;
        if (readFlag(key)) continue;
        if (await showLocalReminder(task.title, translate('WakanDa — напоминание о задаче'))) writeFlag(key);
      }
    }

    const interval = window.setInterval(checkOneOff, 15000);
    document.addEventListener('visibilitychange', checkOneOff);
    window.addEventListener('focus', checkOneOff);
    checkOneOff();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkOneOff);
      window.removeEventListener('focus', checkOneOff);
    };
  }, [oneOffTasks, userId]);

  const enable = useCallback(async () => {
    if (!('Notification' in window)) {
      notify('Этот браузер не поддерживает уведомления. Напоминание останется в заголовке сайта.', { tone: 'warning' });
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        void registerPeriodicSync();
        return true;
      }
      notify('Разреши уведомления для этого сайта в настройках браузера, чтобы получать напоминания.', { tone: 'warning' });
      return false;
    } catch {
      notify('Браузер не смог запросить разрешение. Разреши уведомления в настройках сайта.', { tone: 'error' });
      return false;
    }
  }, [notify]);

  return { enable };
}
