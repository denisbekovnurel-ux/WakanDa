import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/** Минимальная длительность, чтобы мелкие изменения не «вспыхивали». */
const MIN_DURATION_MS = 220;

/**
 * Плавная анимация числа от текущего отображаемого значения к целевому.
 * Первый показ на странице — счёт от 0 вверх, дальше — «перелистывание»
 * от предыдущего значения к новому. При prefers-reduced-motion или отсутствии
 * requestAnimationFrame число возвращается сразу, без анимации.
 */
export function useAnimatedNumber(target: number, duration = 650): number {
  const reduced = usePrefersReducedMotion();
  const canAnimate = typeof requestAnimationFrame === 'function';
  const shouldAnimate = !reduced && canAnimate;

  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shouldAnimate) {
      fromRef.current = target;
      return undefined;
    }

    const start = fromRef.current;
    if (start === target) return undefined;

    const totalMs = Math.max(MIN_DURATION_MS, duration);
    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / totalMs);
      const eased = 1 - Math.pow(1 - progress, 3); // кубический ease-out
      const current = start + (target - start) * eased;
      setDisplay(Math.round(current));
      fromRef.current = current;
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
        fromRef.current = target;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [target, duration, shouldAnimate]);

  // Без анимации всегда отдаём истинное значение, а не промежуточные 0.
  return shouldAnimate ? display : target;
}
