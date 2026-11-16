// Чистый разбор напоминаний: дата, время и текст. Здесь нет Nest и базы,
// поэтому формат сообщения бота можно проверять обычными unit-тестами.

export const MAX_REMINDER_TEXT_LENGTH = 500;
export const MAX_ACTIVE_REMINDERS = 100;
/** Сколько времени после наступления срока напоминание ещё имеет смысл доставлять. */
export const REMINDER_DELIVERY_GRACE_MS = 24 * 60 * 60 * 1000;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const TRIGGER_RE = /^(?:\/remind(?:@[A-Za-z0-9_]+)?|напомни(?:те)?|remind(?:\s+me)?)(?:\s+|$)/i;
const RELATIVE_DATE_RE = /(?:^|\s)(сегодня|завтра|послезавтра)(?=\s|$|[,.;!?])/i;
const NUMERIC_DATE_RE = /(?:^|\s)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?=\s|$|[,.;!?])/;
const MONTH_DATE_RE = /(?:^|\s)(\d{1,2})\s+(января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)(?:\s+(\d{4}))?(?=\s|$|[,.;!?])/i;
const TIME_TOKEN_RE = /(?:^|\s)(?:в\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s|$|[,.;!?])/i;
// «через 30 минут», «через час», «через полчаса» — самый быстрый способ
// поставить напоминание, не вспоминая формат даты.
const RELATIVE_TIME_RE =
  /(?:^|\s)через\s+(полчаса|пол\s+часа|(?:(\d{1,3})\s*)?(минут(?:у|ы)?|мин|час(?:а|ов)?|ч|день|дня|дней))(?=\s|$|[,.;!?])/i;

const MONTH_WORDS: Record<string, number> = {
  января: 1,
  январь: 1,
  февраля: 2,
  февраль: 2,
  марта: 3,
  март: 3,
  апреля: 4,
  апрель: 4,
  мая: 5,
  май: 5,
  июня: 6,
  июнь: 6,
  июля: 7,
  июль: 7,
  августа: 8,
  август: 8,
  сентября: 9,
  сентябрь: 9,
  октября: 10,
  октябрь: 10,
  ноября: 11,
  ноябрь: 11,
  декабря: 12,
  декабрь: 12,
};

type Span = { start: number; end: number };

type DateMatch = Span & {
  year: number | null;
  month: number;
  day: number;
  relativeDays: number | null;
};

export type ParsedReminder = {
  text: string;
  dueAt: Date;
  dateKey: string;
  time: string;
  timezoneOffset: number;
};

export type ReminderParseResult =
  | { ok: true; value: ParsedReminder }
  | { ok: false; error: string };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localParts(now: Date, offsetMinutes: number): { dateKey: string; year: number; month: number; day: number } {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  return { dateKey: `${year}-${pad2(month)}-${pad2(day)}`, year, month, day };
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeYear(value: string): number {
  const year = Number(value);
  if (value.length <= 2) return 2000 + year;
  return year;
}

function dueAtMs(year: number, month: number, day: number, hours: number, minutes: number, offsetMinutes: number): number {
  // Локальное время пользователя переводим в UTC: local = UTC + offset.
  return Date.UTC(year, month - 1, day, hours, minutes) - offsetMinutes * 60_000;
}

function spanOf(match: RegExpExecArray): Span {
  return { start: match.index, end: match.index + match[0].length };
}

function cut(text: string, span: Span): string {
  return `${text.slice(0, span.start)} ${text.slice(span.end)}`;
}

type RelativeTime = {
  due: number;
  /** Число дней для сроков «через N дней»; для минут и часов — null. */
  days: number | null;
};

/** «через 30 минут» → точное время; null — неподдерживаемый срок. */
function relativeTime(match: RegExpExecArray, now: Date): RelativeTime | null {
  const whole = (match[1] || '').toLowerCase();
  if (whole.startsWith('пол')) return { due: now.getTime() + 30 * 60_000, days: null };

  const amount = match[2] ? Number(match[2]) : 1;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000) return null;
  const unit = (match[3] || '').toLowerCase();
  if (unit.startsWith('мин')) return { due: now.getTime() + amount * 60_000, days: null };
  if (unit.startsWith('ч')) return { due: now.getTime() + amount * 3_600_000, days: null };
  return { due: now.getTime() + amount * 86_400_000, days: amount };
}

function firstDateMatch(text: string): DateMatch | null {
  const candidates: DateMatch[] = [];

  const numeric = NUMERIC_DATE_RE.exec(text);
  if (numeric) {
    candidates.push({
      ...spanOf(numeric),
      year: numeric[3] ? normalizeYear(numeric[3]) : null,
      month: Number(numeric[2]),
      day: Number(numeric[1]),
      relativeDays: null,
    });
  }

  const namedMonth = MONTH_DATE_RE.exec(text);
  if (namedMonth) {
    candidates.push({
      ...spanOf(namedMonth),
      year: namedMonth[3] ? normalizeYear(namedMonth[3]) : null,
      month: MONTH_WORDS[namedMonth[2].toLowerCase()] ?? 0,
      day: Number(namedMonth[1]),
      relativeDays: null,
    });
  }

  const relative = RELATIVE_DATE_RE.exec(text);
  if (relative) {
    const word = relative[1].toLowerCase();
    candidates.push({
      ...spanOf(relative),
      year: null,
      month: 0,
      day: 0,
      relativeDays: word === 'сегодня' ? 0 : word === 'завтра' ? 1 : 2,
    });
  }

  return candidates.sort((left, right) => left.start - right.start)[0] ?? null;
}

function cleanText(value: string): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/^(?:(?:в|на|к|до)\s+)+/i, '')
    .replace(/^[\s,;:.\-–—!?]+/, '')
    .replace(/[\s,;:\-–—!?]+$/, '')
    .replace(/\s+(?:в|на|к|до)$/i, '')
    .trim();
  return cleaned.slice(0, MAX_REMINDER_TEXT_LENGTH);
}

/**
 * Создаёт напоминание из готовых частей даты и времени (форма на сайте).
 * Дата — `YYYY-MM-DD`, время — `ЧЧ:ММ`, обе в часовом поясе пользователя.
 */
export function resolveReminderParts(
  dateValue: unknown,
  timeValue: unknown,
  now: Date,
  offsetMinutes: number,
): ReminderParseResult {
  const dateKey = typeof dateValue === 'string' ? dateValue.trim() : '';
  const dateMatch = DATE_KEY_RE.exec(dateKey);
  if (!dateMatch) return { ok: false, error: 'Укажи дату в формате ГГГГ-ММ-ДД' };

  const time = typeof timeValue === 'string' ? timeValue.trim() : '';
  const timeMatch = TIME_RE.exec(time);
  if (!timeMatch) return { ok: false, error: 'Укажи время в формате ЧЧ:ММ, например 21:00' };

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, error: 'Такой даты не существует — проверь число и месяц' };
  }

  const dueAt = dueAtMs(year, month, day, Number(timeMatch[1]), Number(timeMatch[2]), offsetMinutes);
  if (dueAt <= now.getTime()) {
    return { ok: false, error: 'Это время уже прошло — выбери будущую дату и время' };
  }
  return { ok: true, value: { text: '', dueAt: new Date(dueAt), dateKey, time, timezoneOffset: offsetMinutes } };
}

/**
 * Создаёт напоминание из сообщения бота. Поддерживает:
 *   «Напомни мне позвонить маме 01.10 в 21:00»
 *   «/remind 01.10 21:00 позвонить маме»
 *   «напомни завтра в 9:30 купить хлеб»
 *   «напомни 1 октября 2026 в 09:00 …»
 *   «напомни через 30 минут позвонить маме»
 *   «напомни в 21:00 проверить почту» — сегодня или завтра, если время прошло
 * Дата без года, которая уже прошла, переносится на следующий год — иначе
 * напоминание на 01.10 в ноябре молча не создалось бы до следующей осени.
 */
export function parseReminderText(rawText: unknown, now: Date, offsetMinutes: number): ReminderParseResult {
  if (typeof rawText !== 'string') return { ok: false, error: 'Напиши, о чём напомнить' };
  const stripped = rawText.trim().replace(TRIGGER_RE, '').replace(/^мне\s+/i, '').trim();
  if (!stripped) return { ok: false, error: 'Напиши, о чём напомнить, и укажи дату и время' };

  const dateMatch = firstDateMatch(stripped);
  const relativeMatch = RELATIVE_TIME_RE.exec(stripped);

  // Относительное время удобнее явной даты, но не должно перебивать её:
  // «завтра через 30 минут» — противоречивая фраза, оставляем дату.
  if (relativeMatch && !dateMatch) {
    const relative = relativeTime(relativeMatch, now);
    if (!relative) {
      return { ok: false, error: 'Не понял срок. Напиши, например: «через 30 минут» или «через 2 часа»' };
    }
    let due = relative.due;
    let text = cleanText(cut(stripped, spanOf(relativeMatch)));
    // «через 2 дня в 10:00»: относительная дата плюс явное время.
    if (relative.days !== null) {
      const afterRelative = cut(stripped, spanOf(relativeMatch));
      const timeMatch = TIME_TOKEN_RE.exec(afterRelative);
      if (timeMatch) {
        const localRelative = new Date(relative.due + offsetMinutes * 60_000);
        due = dueAtMs(
          localRelative.getUTCFullYear(),
          localRelative.getUTCMonth() + 1,
          localRelative.getUTCDate(),
          Number(timeMatch[1]),
          Number(timeMatch[2]),
          offsetMinutes,
        );
        if (due <= now.getTime()) {
          return { ok: false, error: 'Это время уже прошло — выбери будущую дату и время' };
        }
        text = cleanText(cut(afterRelative, spanOf(timeMatch)));
      }
    }
    const localDue = new Date(due + offsetMinutes * 60_000);
    return {
      ok: true,
      value: {
        text: text || 'Напоминание',
        dueAt: new Date(due),
        dateKey: `${localDue.getUTCFullYear()}-${pad2(localDue.getUTCMonth() + 1)}-${pad2(localDue.getUTCDate())}`,
        time: `${pad2(localDue.getUTCHours())}:${pad2(localDue.getUTCMinutes())}`,
        timezoneOffset: offsetMinutes,
      },
    };
  }

  // Время без даты: «в 21:00» — ближайшее будущее (сегодня или завтра).
  if (!dateMatch) {
    const timeOnly = TIME_TOKEN_RE.exec(stripped);
    if (!timeOnly) {
      return { ok: false, error: 'Не вижу дату или время. Напиши так: «Напомни мне … 01.10 в 21:00»' };
    }
    const hours = Number(timeOnly[1]);
    const minutes = Number(timeOnly[2]);
    const local = localParts(now, offsetMinutes);
    let dateKey = local.dateKey;
    let due = dueAtMs(local.year, local.month, local.day, hours, minutes, offsetMinutes);
    if (due <= now.getTime()) {
      dateKey = addDays(local.dateKey, 1);
      const [year, month, day] = dateKey.split('-').map(Number);
      due = dueAtMs(year, month, day, hours, minutes, offsetMinutes);
    }
    const text = cleanText(cut(stripped, spanOf(timeOnly)));
    return {
      ok: true,
      value: {
        text: text || 'Напоминание',
        dueAt: new Date(due),
        dateKey,
        time: `${pad2(hours)}:${pad2(minutes)}`,
        timezoneOffset: offsetMinutes,
      },
    };
  }

  // Время ищем после удаления даты: иначе «01.10» можно принять за 01:10.
  const afterDateText = cut(stripped, dateMatch);
  const timeMatch = TIME_TOKEN_RE.exec(afterDateText);
  if (!timeMatch) {
    return { ok: false, error: 'Не вижу время. Напиши так: «Напомни мне … 01.10 в 21:00»' };
  }
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const time = `${pad2(hours)}:${pad2(minutes)}`;
  const text = cleanText(cut(afterDateText, spanOf(timeMatch)));
  const local = localParts(now, offsetMinutes);

  let due: number;
  if (dateMatch.relativeDays !== null) {
    const dateKey = addDays(local.dateKey, dateMatch.relativeDays);
    const [year, month, day] = dateKey.split('-').map(Number);
    due = dueAtMs(year, month, day, hours, minutes, offsetMinutes);
    if (due <= now.getTime()) {
      return { ok: false, error: 'Это время уже прошло — выбери будущую дату и время' };
    }
  } else if (dateMatch.year !== null) {
    if (
      dateMatch.year < 2000 ||
      dateMatch.year > 2100 ||
      dateMatch.month < 1 ||
      dateMatch.month > 12 ||
      dateMatch.day < 1 ||
      dateMatch.day > daysInMonth(dateMatch.year, dateMatch.month)
    ) {
      return { ok: false, error: 'Такой даты не существует — проверь число и месяц' };
    }
    due = dueAtMs(dateMatch.year, dateMatch.month, dateMatch.day, hours, minutes, offsetMinutes);
    if (due <= now.getTime()) {
      return { ok: false, error: 'Это время уже прошло — выбери будущую дату и время' };
    }
  } else {
    const year = local.year;
    if (dateMatch.month < 1 || dateMatch.month > 12 || dateMatch.day < 1 || dateMatch.day > daysInMonth(year, dateMatch.month)) {
      return { ok: false, error: 'Такой даты не существует — проверь число и месяц' };
    }
    due = dueAtMs(year, dateMatch.month, dateMatch.day, hours, minutes, offsetMinutes);
    if (due <= now.getTime()) {
      // Без года пользователь почти всегда имеет в виду ближайшую будущую дату.
      due = dueAtMs(year + 1, dateMatch.month, dateMatch.day, hours, minutes, offsetMinutes);
    }
  }

  const dueDate = new Date(due);
  const localDue = new Date(due + offsetMinutes * 60_000);
  return {
    ok: true,
    value: {
      text: text || 'Напоминание',
      dueAt: dueDate,
      dateKey: `${localDue.getUTCFullYear()}-${pad2(localDue.getUTCMonth() + 1)}-${pad2(localDue.getUTCDate())}`,
      time,
      timezoneOffset: offsetMinutes,
    },
  };
}

/** Проверяет, является ли сообщение командой создания напоминания. */
export function isReminderRequest(text: unknown): boolean {
  return typeof text === 'string' && TRIGGER_RE.test(text.trim());
}

/** Команда списка напоминаний. */
export function isReminderListCommand(text: unknown): boolean {
  return typeof text === 'string' && /^\/reminders(?:@[A-Za-z0-9_]+)?\s*$/i.test(text.trim());
}

/** Локальная дата и время напоминания для сообщения в Telegram. */
export function formatReminderLocalDate(dueAt: string | Date, offsetMinutes: number): string {
  const local = new Date(new Date(dueAt).getTime() + offsetMinutes * 60_000);
  return `${pad2(local.getUTCDate())}.${pad2(local.getUTCMonth() + 1)}.${local.getUTCFullYear()} в ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
}
