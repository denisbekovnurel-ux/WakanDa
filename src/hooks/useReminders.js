import { useCallback, useEffect } from 'react';
import { pluralize } from '../utils/pluralize';

const PERIODIC_SYNC_TAG = 'wakanda-daily-reminder';

async function registerPeriodicSync() {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    const registration = await navigator.serviceWorker.ready;
    if (!('periodicSync' in registration)) return;
    await registration.periodicSync.register(PERIODIC_SYNC_TAG, {
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
export function useReminders({ enabled, reminderTime, pendingHabits, todayKey }) {
  useEffect(() => {
    if (!enabled) return undefined;
    function checkReminder() {
      if (pendingHabits === 0 || !('Notification' in window) || Notification.permission !== 'granted') return;
      // Фоновая вкладка не должна дёргать уведомление в момент возврата.
      if (document.visibilityState === 'hidden') return;
      const [hours, minutes] = String(reminderTime || '').split(':').map(Number);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return;
      const now = new Date();
      const due = new Date(now);
      due.setHours(hours, minutes, 0, 0);
      // Срабатывает, как только время наступило, и лишь один раз за день.
      if (now < due || localStorage.getItem('wakanda-last-reminder-date') === todayKey) return;
      const message = `Осталось отметить ${pendingHabits} ${pluralize(pendingHabits, 'привычку', 'привычки', 'привычек')}.`;
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => registration.showNotification('WakanDa — время свериться', { body: message, icon: '/icons/icon.svg' }))
          .catch(() => new Notification('WakanDa — время свериться', { body: message }));
      } else {
        new Notification('WakanDa — время свериться', { body: message });
      }
      localStorage.setItem('wakanda-last-reminder-date', todayKey);
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
  }, [enabled, reminderTime, pendingHabits, todayKey]);

  const enable = useCallback(async () => {
    if (!('Notification' in window)) {
      window.alert('Этот браузер не поддерживает уведомления. Напоминание останется в заголовке сайта.');
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        registerPeriodicSync();
        return true;
      }
      window.alert('Разреши уведомления для этого сайта в настройках браузера, чтобы получать напоминания.');
      return false;
    } catch {
      window.alert('Браузер не смог запросить разрешение. Разреши уведомления в настройках сайта.');
      return false;
    }
  }, []);

  return { enable };
}
