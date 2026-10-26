import { useCallback, useEffect } from 'react';
import { pluralize } from '../utils/pluralize';
import { useFeedback } from '../components/FeedbackContext';
import { useAuth } from '../auth/AuthContext';
import { translate } from '../i18n';

const PERIODIC_SYNC_TAG = 'wakanda-daily-reminder';

interface PeriodicSyncManager {
  register: (tag: string, options?: { minInterval: number }) => Promise<void>;
}

type PeriodicSyncRegistration = ServiceWorkerRegistration & {
  periodicSync?: PeriodicSyncManager;
};

export interface ReminderSettings {
  enabled: boolean;
  reminderTime: string;
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

async function showLocalReminder(message: string): Promise<boolean> {
  const title = translate('WakanDa — время свериться');
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
 * Единственное место, где живёт логика напоминаний.
 * Честно: без фоновой синхронизации уведомление приходит, только пока сайт открыт.
 */
export function useReminders({ enabled, reminderTime, pendingHabits, todayKey }: ReminderSettings) {
  const { notify } = useFeedback();
  const { user } = useAuth();
  const userId = user?.id ?? 'anon';

  useEffect(() => {
    if (!enabled) return undefined;
    const lastReminderKey = `wakanda-last-reminder:${userId}:${todayKey}:${reminderTime}`;

    async function checkReminder() {
      if (pendingHabits === 0 || !('Notification' in window) || Notification.permission !== 'granted') return;
      // Фоновая вкладка не должна дёргать уведомление в момент возврата.
      if (document.visibilityState === 'hidden') return;
      const [hours, minutes] = String(reminderTime || '').split(':').map(Number);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return;
      const now = new Date();
      const due = new Date(now);
      due.setHours(hours, minutes, 0, 0);
      // Срабатывает, как только время наступило, и лишь один раз за день.
      if (now < due) return;
      try {
        if (localStorage.getItem(lastReminderKey) === todayKey) return;
      } catch {
        // localStorage недоступен — перестрахуемся и не шлём повторно чаще 15 секунд
      }

      // Если активен серверный push, напоминание уже уйдёт с бэкенда (даже при
      // закрытой вкладке) — локальное только дублировало бы его.
      try {
        const registration = await getActiveServiceWorker();
        if (registration?.pushManager && (await registration.pushManager.getSubscription())) return;
      } catch {
        // не смогли проверить — показываем локальное уведомление
      }

      const message = translate('Осталось отметить {count} {unit}.', {
        count: pendingHabits,
        unit: pluralize(pendingHabits, 'привычку', 'привычки', 'привычек'),
      });
      if (await showLocalReminder(message)) {
        try {
          localStorage.setItem(lastReminderKey, todayKey);
        } catch {
          // приватный режим: на время сессии просто не повторимся чаще интервала
        }
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
  }, [enabled, reminderTime, pendingHabits, todayKey, userId]);

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
