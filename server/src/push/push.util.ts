// Чистая логика напоминаний для Web Push: без Nest и БД, чтобы её можно было
// тестировать отдельно. Здесь же нормализация часового пояса клиента.

export type ReminderSettings = {
  reminderEnabled?: boolean;
  reminderTime?: string;
  reminderTimes?: string[];
};

type ReminderState = {
  tasks?: Array<{
    id: string;
    title: string;
    archived?: boolean;
    createdAt?: string;
    schedule?: number[];
    pauseRanges?: Array<{ from: string; to: string }>;
    history?: Record<string, string>;
  }>;
  oneOffTasks?: Array<{
    id: string;
    title: string;
    done?: boolean;
    reminderAt?: string;
  }>;
};

export type ReminderSlot = {
  dateKey: string;
  /** Локальное время слота «ЧЧ:ММ»: оно же ключ в журнале отправок. */
  time: string;
};

export type DueOneOffReminder = {
  taskId: string;
  title: string;
  dateKey: string;
  slot: string;
  reminderAt: string;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FULL_SCHEDULE = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_REMINDER_TIMES = ['09:00', '14:00', '20:00'];

// Сколько минут после назначенного времени ежедневное напоминание ещё может быть отправлено.
export const REMINDER_GRACE_MINUTES = 180;
// Напоминание о разовой задаче догоняем в течение суток: задача всё ещё актуальна.
export const ONE_OFF_REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function minutesOfDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
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

/** Валидные ежедневные времена из состояния; старое одиночное поле тоже поддерживаем. */
export function readReminderTimes(settings: ReminderSettings | null | undefined): string[] {
  const candidates = [
    ...(Array.isArray(settings?.reminderTimes) ? settings.reminderTimes : []),
    settings?.reminderTime,
  ].filter((value): value is string => typeof value === 'string' && TIME_RE.test(value));
  const times = [...new Set(candidates)].sort().slice(0, DEFAULT_REMINDER_TIMES.length);
  if (!times.length) return [];
  // Старое состояние хранило одно время. Клиент при первом открытии добивает
  // его до трёх слотов значениями по умолчанию — сервер делает так же, чтобы
  // напоминания не расходились с тем, что видит пользователь.
  for (const fallback of DEFAULT_REMINDER_TIMES) {
    if (times.length >= DEFAULT_REMINDER_TIMES.length) break;
    if (!times.includes(fallback)) times.push(fallback);
  }
  return times.sort();
}

/**
 * Ежедневные слоты, которые пора отправить. Точная минута не обязательна:
 * если сервер в этот момент лежал (деплой, перезапуск, нагрузка), напоминание
 * догоняет в пределах окна REMINDER_GRACE_MINUTES. Дубли ограничивает push_log.
 */
export function dueReminderSlots(
  settings: ReminderSettings | null | undefined,
  now: Date,
  offsetMinutes: number,
): ReminderSlot[] {
  if (!settings || settings.reminderEnabled !== true) return [];
  const { dateKey, hhmm } = localDateParts(now, normalizeTimezoneOffset(offsetMinutes));
  return readReminderTimes(settings)
    .filter((time) => {
      const diff = minutesOfDay(hhmm) - minutesOfDay(time);
      return diff >= 0 && diff <= REMINDER_GRACE_MINUTES;
    })
    .map((time) => ({ dateKey, time }));
}

/**
 * Первый слот на сегодня — совместимость со старым кодом и тестами.
 * Планировщик использует dueReminderSlots, чтобы отправить все три времени.
 */
export function dueReminderDateKey(
  settings: ReminderSettings | null | undefined,
  now: Date,
  offsetMinutes: number,
): string | null {
  return dueReminderSlots(settings, now, offsetMinutes)[0]?.dateKey ?? null;
}

function isPaused(task: NonNullable<ReminderState['tasks']>[number], dateKey: string): boolean {
  return (task.pauseRanges || []).some((range) => dateKey >= range.from && dateKey <= range.to);
}

function weekday(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function createdAtKey(value: string | undefined): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

/** Сколько привычек ещё не отмечено на указанную локальную дату. */
export function countPendingHabits(state: ReminderState | null | undefined, dateKey: string): number {
  const day = weekday(dateKey);
  return (state?.tasks || []).filter((task) => {
    if (task.archived) return false;
    const created = createdAtKey(task.createdAt);
    if (created && created > dateKey) return false;
    const schedule = task.schedule?.length ? task.schedule : FULL_SCHEDULE;
    if (!schedule.includes(day) || isPaused(task, dateKey)) return false;
    const status = task.history?.[dateKey];
    return status !== 'done' && status !== 'failed';
  }).length;
}

/** Активные разовые задачи — о них тоже стоит напомнить. */
export function countActiveOneOff(state: ReminderState | null | undefined): number {
  return (state?.oneOffTasks || []).filter((task) => !task.done).length;
}

/** Текст ежедневного напоминания: он же уходит в Telegram. */
export function dailyReminderBody(state: ReminderState | null | undefined, dateKey: string): string {
  const pendingHabits = countPendingHabits(state, dateKey);
  const oneOff = countActiveOneOff(state);
  const parts: string[] = [];
  if (pendingHabits > 0) parts.push(`привычек: ${pendingHabits}`);
  if (oneOff > 0) parts.push(`разовых задач: ${oneOff}`);
  if (!parts.length) return 'Пора отметить привычки за сегодня и закрыть день.';
  if (pendingHabits === 0) return `Пора закрыть день. Активных разовых задач: ${oneOff}.`;
  return `Пора отметить привычки за сегодня и закрыть день. Осталось — ${parts.join(', ')}.`;
}

/** Разовые задачи, время напоминания которых наступило и ещё не истекло. */
export function dueOneOffReminders(
  state: ReminderState | null | undefined,
  now: Date,
  offsetMinutes: number,
): DueOneOffReminder[] {
  const nowMs = now.getTime();
  const offset = normalizeTimezoneOffset(offsetMinutes);
  const result: DueOneOffReminder[] = [];
  for (const task of state?.oneOffTasks || []) {
    if (task.done || !task.reminderAt) continue;
    const at = Date.parse(task.reminderAt);
    if (!Number.isFinite(at) || at > nowMs || nowMs - at > ONE_OFF_REMINDER_GRACE_MS) continue;
    const reminderAt = new Date(at).toISOString();
    result.push({
      taskId: task.id,
      title: task.title,
      dateKey: localDateParts(new Date(at), offset).dateKey,
      slot: `oneoff:${task.id}:${reminderAt}`,
      reminderAt,
    });
  }
  return result.sort((left, right) => left.reminderAt.localeCompare(right.reminderAt));
}
