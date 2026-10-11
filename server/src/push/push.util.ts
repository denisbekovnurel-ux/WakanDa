// Чистая логика напоминаний для Web Push: без Nest и БД, чтобы её можно было
// тестировать отдельно. Здесь же нормализация часового пояса клиента.

export type ReminderSettings = {
  reminderEnabled?: boolean;
  reminderTime?: string;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Часовой пояс клиента: минуты к востоку от UTC (то, что отдаёт
 * `-new Date().getTimezoneOffset()`). Ограничиваем реальным диапазоном UTC-14…UTC+14.
 */
export function normalizeTimezoneOffset(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.round(numeric);
  if (rounded < -840 || rounded > 840) return 0;
  return rounded;
}

/** Локальные дата и время («YYYY-MM-DD» и «ЧЧ:ММ») для смещения в минутах. */
export function localDateParts(now: Date, offsetMinutes: number): { dateKey: string; hhmm: string } {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const dateKey = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
  const hhmm = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
  return { dateKey, hhmm };
}

/**
 * Возвращает локальную дату («YYYY-MM-DD»), если прямо сейчас наступило время
 * напоминания, иначе null. Одно напоминание в день — вызывающий сверяет дату
 * с журналом отправок.
 */
export function dueReminderDateKey(
  settings: ReminderSettings | null | undefined,
  now: Date,
  offsetMinutes: number,
): string | null {
  if (!settings || settings.reminderEnabled !== true) return null;
  const match = TIME_RE.exec(String(settings.reminderTime ?? ''));
  if (!match) return null;
  const { dateKey, hhmm } = localDateParts(now, normalizeTimezoneOffset(offsetMinutes));
  return hhmm === `${match[1]}:${match[2]}` ? dateKey : null;
}
