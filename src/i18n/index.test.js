// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, getLocale, setLocale, translate } from './index';
import { pluralize } from '../utils/pluralize';

afterEach(() => {
  setLocale('ru');
});

describe('i18n', () => {
  it('переводит известные строки и оставляет неизвестные русскими', () => {
    setLocale('en');
    expect(translate('Серия')).toBe('Streak');
    expect(translate('Строка без перевода')).toBe('Строка без перевода');
  });

  it('подставляет параметры в перевод', () => {
    setLocale('en');
    expect(translate('И ещё {count} привычек', { count: 3 })).toBe('3 more habits');
  });

  it('сохраняет локаль и обновляет lang', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem('wakanda.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('форматирует даты по локали', () => {
    setLocale('en');
    const date = new Date(2026, 9, 26);
    expect(formatDate(date, { month: 'long' }, 'en')).toBe('October');
    expect(formatDate(date, { month: 'long' }, 'ru')).toBe('октябрь');
  });

  it('использует английские формы множественного числа', () => {
    setLocale('en');
    expect(pluralize(1, 'день', 'дня', 'дней')).toBe('day');
    expect(pluralize(2, 'день', 'дня', 'дней')).toBe('days');
    setLocale('ru');
    expect(pluralize(2, 'день', 'дня', 'дней')).toBe('дня');
  });
});
