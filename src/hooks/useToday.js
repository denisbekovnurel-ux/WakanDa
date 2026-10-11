import { useEffect, useState } from 'react';
import { toDateKey } from '../utils/calc';

export function useToday() {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    let timeoutId;
    function refreshToday() {
      setToday(new Date());
      window.clearTimeout(timeoutId);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeoutId = window.setTimeout(refreshToday, midnight.getTime() - now.getTime() + 100);
    }
    function refreshOnVisible() {
      if (document.visibilityState === 'visible') refreshToday();
    }
    refreshToday();
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, []);

  return { today, todayKey: toDateKey(today) };
}
