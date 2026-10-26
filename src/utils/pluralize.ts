/**
 * Русская форма множественного числа: pluralize(2, 'день', 'дня', 'дней').
 * Держим в одном месте, чтобы подписи не расходились по коду.
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return many;
  if (remainder10 === 1) return one;
  if (remainder10 >= 2 && remainder10 <= 4) return few;
  return many;
}
