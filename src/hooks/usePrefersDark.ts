import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function readPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(QUERY).matches;
}

/**
 * Следит за системной темой (prefers-color-scheme), чтобы поддержать
 * режим «как в системе» и переключаться без ручного выбора.
 */
export function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(readPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia(QUERY);
    const handleChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return prefersDark;
}
