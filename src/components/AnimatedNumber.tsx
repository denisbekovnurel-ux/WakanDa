import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

/**
 * Анимирует целое число (обычно счётчики статистики) от текущего значения
 * к `value`. Рендерит только число — разделитель « / N» остаётся снаружи.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const display = useAnimatedNumber(value);
  return <>{display}</>;
}
