import { useSyncExternalStore } from 'react';
import { EN } from './messages.en';

export type Locale = 'ru' | 'en';

const STORAGE_KEY = 'wakanda.locale';
const listeners = new Set<() => void>();

function isLocale(value: string | null): value is Locale {
  return value === 'ru' || value === 'en';
}

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Приватный режим или тесты без localStorage.
  }
  return 'ru';
}

let currentLocale: Locale = typeof window === 'undefined' ? 'ru' : readStoredLocale();

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  const ogLocale = document.querySelector('meta[property="og:locale"]');
  if (ogLocale) ogLocale.setAttribute('content', locale === 'en' ? 'en_US' : 'ru_RU');
}

applyDocumentLocale(currentLocale);

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Настройка всё равно применяется до перезагрузки.
  }
  applyDocumentLocale(locale);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Перевод по исходной русской строке; неизвестные строки остаются русскими. */
export function translate(source: string, params?: Record<string, string | number>): string {
  const template = currentLocale === 'en' ? EN[source] ?? source : source;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    Object.hasOwn(params, key) ? String(params[key]) : match
  ));
}

/** Частое короткое имя для JSX и утилит. */
export const t = translate;

/** Локаль для Intl: русская или английская. */
export function intlLocale(locale: Locale = currentLocale): string {
  return locale === 'en' ? 'en-US' : 'ru-RU';
}

export function formatDate(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions,
  locale: Locale = currentLocale,
): string {
  const value = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(), options).format(value);
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return {
    locale,
    setLocale,
    t: translate,
    formatDate: (date: Date | string | number, options: Intl.DateTimeFormatOptions) => formatDate(date, options, locale),
    formatNumber,
  };
}
