export type PageKey = 'home' | 'daily' | 'oneoff' | 'stats' | 'admin';

export interface PageMeta {
  label: string;
  en: string;
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
}

export const pages: Record<PageKey, PageMeta> = {
  home: { label: 'HOME', en: 'HOME', index: '01', eyebrow: 'ПЛАН НА ДЕЙСТВИЕ', title: 'Точка старта', description: 'Порядок в делах. Холодная голова. Каждый день — шаг вперёд.', image: 'home-bg.jpg' },
  daily: { label: 'DAILY', en: 'DAILY', index: '02', eyebrow: 'РИТМ И ПОВТОРЕНИЕ', title: 'Ежедневный режим', description: 'Отмечай сделанное. Месяц покажет, насколько крепка твоя дисциплина.', image: 'daily-bg.jpg' },
  oneoff: { label: 'ONE-SHOT', en: 'ONE-SHOT', index: '03', eyebrow: 'ДЕЛО ДОЛЖНО БЫТЬ ЗАКРЫТО', title: 'Разовые задачи', description: 'Список конкретных дел. Выполнил — закрыл. История остаётся в архиве.', image: 'oneoff-bg.jpg' },
  stats: { label: 'STATS', en: 'STATS', index: '04', eyebrow: 'ЦИФРЫ НЕ ВРУТ', title: 'Статистика', description: 'Серия, ритм месяца и годовая карта — виден весь путь целиком.', image: 'stats-bg.jpg' },
  admin: { label: 'ADMIN', en: 'ADMIN', index: '05', eyebrow: 'УПРАВЛЕНИЕ ДОСТУПОМ', title: 'Админ-панель', description: 'Одобряй заявки, следи за активностью и управляй доступом пользователей.', image: 'admin-bg.jpg' },
};

export function isPageKey(value: string): value is PageKey {
  return Object.hasOwn(pages, value);
}

export function pathForPage(key: PageKey): string {
  return key === 'home' ? '/' : `/${key}`;
}
