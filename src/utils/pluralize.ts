import { getLocale, translate } from '../i18n';

/**
 * Форма множественного числа: pluralize(2, 'день', 'дня', 'дней').
 * Для английского интерфейса используем одну/множественную форму, а сами
 * слова переводим по словарю. Русские правила остаются прежними.
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
  if (getLocale() === 'en') {
    return translate(Math.abs(count) === 1 ? one : many);
  }
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return translate(many);
  if (remainder10 === 1) return translate(one);
  if (remainder10 >= 2 && remainder10 <= 4) return translate(few);
  return translate(many);
}
