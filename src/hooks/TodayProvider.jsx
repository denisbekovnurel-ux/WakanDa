import { useEffect, useMemo, useState } from 'react';
import { toDateKey } from '../utils/calc';
import { TodayContext } from './TodayContext';

/**
 * Один таймер до полуночи на всё приложение.
 *
 * Раньше каждый компонент вызывал useToday() сам и заводил собственный таймер,
 * а App прокидывал today/todayKey вниз пропсами. Теперь дата обновляется здесь,
 * а компоненты берут её из контекста — без пропсов и без лишних таймеров.
 */
export function TodayProvider({ children }) {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    let timeoutId;
    function refreshToday() {
      setToday(new Date());
      window.clearTimeout(timeoutId);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      // +100 мс, чтобы не сработать за мгновение до смены суток.
      timeoutId = window.setTimeout(refreshToday, midnight.getTime() - now.getTime() + 100);
    }
    function refreshOnVisible() {
      // Вкладка могла быть в фоне несколько дней — дата обязана догнать реальность.
      if (document.visibilityState === 'visible') refreshToday();
    }
    refreshToday();
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, []);

  // Новый объект контекста создаём только при смене даты, а не на каждый рендер.
  const value = useMemo(() => ({ today, todayKey: toDateKey(today) }), [today]);

  return <TodayContext.Provider value={value}>{children}</TodayContext.Provider>;
}
