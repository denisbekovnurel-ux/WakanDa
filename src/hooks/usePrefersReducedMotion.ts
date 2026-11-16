import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Отражает предпочтение prefers-reduced-motion. В средах без matchMedia
 * (например, jsdom) возвращает `false`; каждый хук по отдельности ещё и
 * проверяет наличие rAF/IntersectionObserver, прежде чем что-то анимировать.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState<boolean>(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(QUERY);
    const handleChange = (event: MediaQueryListEvent) => setPrefers(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return prefers;
}
