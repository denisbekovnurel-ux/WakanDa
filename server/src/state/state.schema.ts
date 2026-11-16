import { randomUUID } from 'node:crypto';

// Схема и серверная валидация состояния пользователя.
// Файл намеренно не зависит от Nest: валидатор можно запускать и тестировать сам по себе.
// Клиент тоже нормализует состояние (src/utils/schema.js), но сервер не должен
// доверять клиенту: сюда может прийти что угодно, в том числе в обход интерфейса.

export const SCHEMA_VERSION = 3;

export const DEFAULT_REMINDER_TIMES = ['09:00', '14:00', '20:00'] as const;

export type HabitStatus = 'done' | 'failed' | 'empty';

export type AppState = {
  version: number;
  tasks: Array<{
    id: string;
    title: string;
    history: Record<string, HabitStatus>;
    createdAt?: string;
    schedule?: number[];
    archived?: boolean;
    pauseRanges?: Array<{ from: string; to: string }>;
  }>;
  oneOffTasks: Array<{
    id: string;
    title: string;
    done: boolean;
    createdAt?: string;
    deadline?: string;
    priority?: string;
    reminderAt?: string;
  }>;
  notes: Record<string, string>;
  theme: string;
  /** До трёх ежедневных напоминаний о привычках. */
  reminderTimes: string[];
  /** Старое одиночное время: оставляем для совместимости со старыми клиентами. */
  reminderTime: string;
  reminderEnabled: boolean;
  lastAutoBackupAt: number;
};

export const DEFAULT_STATE: AppState = {
  version: SCHEMA_VERSION,
  tasks: [],
  oneOffTasks: [],
  notes: {},
  theme: 'dark',
  reminderTimes: [...DEFAULT_REMINDER_TIMES],
  reminderTime: DEFAULT_REMINDER_TIMES[0],
  reminderEnabled: false,
  lastAutoBackupAt: 0,
};

// Верхние границы — защита от «мусорного» огромного состояния. Тело запроса
// всё равно ограничено 2 МБ, но лимиты дают понятные ошибки и держат БД в форме.
export const LIMITS = {
  tasks: 1000,
  historyPerTask: 4000,
  scheduleDays: 7,
  pauseRangesPerTask: 200,
  oneOffTasks: 2000,
  notes: 10000,
  title: 200,
  note: 5000,
  id: 128,
  timestamp: 40,
  deadline: 32,
} as const;

const VALID_STATUSES = new Set<HabitStatus>(['done', 'failed', 'empty']);
const VALID_PRIORITIES = new Set(['high', 'normal', 'low']);
const VALID_THEMES = new Set(['light', 'dark']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Проверяет не только формат, но и то, что такая дата реально существует. */
function isRealDateKey(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export class StateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateValidationError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new StateValidationError(message);
}

function readId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, LIMITS.id);
  return randomUUID();
}

function readTitle(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where}: название должно быть текстом`);
  const title = value.trim();
  if (!title) fail(`${where}: название не может быть пустым`);
  if (title.length > LIMITS.title) fail(`${where}: название слишком длинное (максимум ${LIMITS.title} символов)`);
  return title;
}

/**
 * createdAt раньше мог быть ISO-таймстампом, а теперь это дневной ключ.
 * Приводим оба формата к «YYYY-MM-DD», чтобы статистика не получала Invalid Date.
 */
function readCreatedAt(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') fail(`${where}: дата создания должна быть текстом`);
  const dateKey = value.trim().slice(0, 10);
  if (!isRealDateKey(dateKey)) fail(`${where}: некорректная дата создания «${value.slice(0, LIMITS.timestamp)}»`);
  return dateKey;
}

function readDateKey(value: string, where: string, label: string): string {
  if (!isRealDateKey(value)) fail(`${where}: некорректная ${label} «${value}»`);
  return value;
}

/** Три ежедневных времени: новые `reminderTimes` или старое одиночное `reminderTime`. */
function readReminderTimes(input: Record<string, unknown>): string[] {
  const candidates = [
    ...(Array.isArray(input.reminderTimes) ? input.reminderTimes : []),
    input.reminderTime,
  ].filter((value): value is string => typeof value === 'string' && TIME_RE.test(value));
  const times = [...new Set(candidates)].sort().slice(0, DEFAULT_REMINDER_TIMES.length);
  for (const fallback of DEFAULT_REMINDER_TIMES) {
    if (times.length >= DEFAULT_REMINDER_TIMES.length) break;
    if (!times.includes(fallback)) times.push(fallback);
  }
  return times.sort();
}

function readReminderAt(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') fail(`${where}: время напоминания должно быть текстом`);
  const text = value.trim();
  if (!text || text.length > LIMITS.timestamp) fail(`${where}: некорректное время напоминания`);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) fail(`${where}: некорректное время напоминания «${text}»`);
  return new Date(parsed).toISOString();
}

function readHistory(value: unknown, where: string): Record<string, HabitStatus> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) fail(`${where}: история должна быть объектом`);
  const keys = Object.keys(value);
  if (keys.length > LIMITS.historyPerTask) {
    fail(`${where}: слишком много отметок в истории (максимум ${LIMITS.historyPerTask})`);
  }
  const history: Record<string, HabitStatus> = {};
  for (const key of keys) {
    readDateKey(key, where, 'дата отметки');
    const status = value[key];
    if (typeof status !== 'string' || !VALID_STATUSES.has(status as HabitStatus)) {
      fail(`${where}: неизвестный статус отметки «${String(status)}»`);
    }
    history[key] = status as HabitStatus;
  }
  return history;
}

function readSchedule(value: unknown, where: string): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail(`${where}: расписание должно быть списком дней`);
  if (value.length > LIMITS.scheduleDays * 2) fail(`${where}: слишком много дней в расписании`);
  const days: number[] = [];
  for (const day of value) {
    if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) {
      fail(`${where}: день недели должен быть числом от 0 до 6`);
    }
    if (!days.includes(day as number)) days.push(day as number);
  }
  return days.length ? days : undefined;
}

function readPauseRanges(value: unknown, where: string): Array<{ from: string; to: string }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${where}: паузы должны быть списком`);
  if (value.length > LIMITS.pauseRangesPerTask) {
    fail(`${where}: слишком много периодов паузы (максимум ${LIMITS.pauseRangesPerTask})`);
  }
  const ranges: Array<{ from: string; to: string }> = [];
  for (const [index, item] of value.entries()) {
    const itemWhere = `${where}, пауза №${index + 1}`;
    if (!isPlainObject(item)) fail(`${itemWhere}: ожидается объект`);
    const { from, to } = item;
    if (typeof from !== 'string' || typeof to !== 'string') {
      fail(`${itemWhere}: нужны даты ГГГГ-ММ-ДД (от и до)`);
    }
    readDateKey(from, itemWhere, 'дата начала');
    readDateKey(to, itemWhere, 'дата окончания');
    if (from > to) fail(`${itemWhere}: начало позже конца`);
    ranges.push({ from, to });
  }
  // Сортировка и схлопывание пересечений — как при добавлении на клиенте.
  ranges.sort((a, b) => a.from.localeCompare(b.from));
  const merged: Array<{ from: string; to: string }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = range.to > last.to ? range.to : last.to;
    else merged.push({ ...range });
  }
  return merged;
}

function sanitizeHabit(input: unknown, index: number): AppState['tasks'][number] {
  const where = `Привычка №${index + 1}`;
  if (!isPlainObject(input)) fail(`${where}: ожидается объект`);
  const schedule = readSchedule(input.schedule, where);
  return {
    id: readId(input.id),
    title: readTitle(input.title, where),
    history: readHistory(input.history, where),
    createdAt: readCreatedAt(input.createdAt, where),
    schedule,
    archived: Boolean(input.archived),
    pauseRanges: readPauseRanges(input.pauseRanges, where),
  };
}

function sanitizeOneOff(input: unknown, index: number): AppState['oneOffTasks'][number] {
  const where = `Разовое дело №${index + 1}`;
  if (!isPlainObject(input)) fail(`${where}: ожидается объект`);
  let deadline: string | undefined;
  if (input.deadline !== undefined && input.deadline !== null) {
    if (typeof input.deadline !== 'string') fail(`${where}: дедлайн должен быть текстом`);
    deadline = input.deadline.trim();
    if (deadline) readDateKey(deadline, where, 'дата дедлайна');
  }
  let priority = 'normal';
  if (input.priority !== undefined && input.priority !== null) {
    if (typeof input.priority !== 'string' || !VALID_PRIORITIES.has(input.priority)) {
      fail(`${where}: неизвестный приоритет «${String(input.priority)}»`);
    }
    priority = input.priority;
  }
  return {
    id: readId(input.id),
    title: readTitle(input.title, where),
    done: Boolean(input.done),
    createdAt: readCreatedAt(input.createdAt, where),
    deadline,
    priority,
    reminderAt: readReminderAt(input.reminderAt, where),
  };
}

function readNotes(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) fail('Заметки должны быть объектом');
  const keys = Object.keys(value);
  if (keys.length > LIMITS.notes) fail(`Слишком много заметок (максимум ${LIMITS.notes})`);
  const notes: Record<string, string> = {};
  for (const key of keys) {
    readDateKey(key, 'Заметки', 'дата заметки');
    const text = value[key];
    if (typeof text !== 'string') fail(`Заметка на ${key} должна быть текстом`);
    if (text.length > LIMITS.note) fail(`Заметка на ${key} слишком длинная (максимум ${LIMITS.note} символов)`);
    if (text.trim()) notes[key] = text;
  }
  return notes;
}

/**
 * Превращает произвольные данные в корректное состояние или бросает
 * StateValidationError с понятным описанием. Ничего не «чинит» молча:
 * всё, что не укладывается в схему, — повод показать ошибку, а не сохранять.
 */
export function sanitizeAppState(input: unknown): AppState {
  if (!isPlainObject(input)) fail('Состояние должно быть объектом');

  const tasksInput = input.tasks ?? [];
  if (!Array.isArray(tasksInput)) fail('Поле «tasks» должно быть списком');
  if (tasksInput.length > LIMITS.tasks) fail(`Слишком много привычек (максимум ${LIMITS.tasks})`);

  const oneOffInput = input.oneOffTasks ?? [];
  if (!Array.isArray(oneOffInput)) fail('Поле «oneOffTasks» должно быть списком');
  if (oneOffInput.length > LIMITS.oneOffTasks) fail(`Слишком много разовых дел (максимум ${LIMITS.oneOffTasks})`);

  const reminderTimes = readReminderTimes(input);
  const reminderTime = typeof input.reminderTime === 'string' && TIME_RE.test(input.reminderTime)
    ? input.reminderTime
    : reminderTimes[0];
  const lastAutoBackupAt = Number(input.lastAutoBackupAt);

  const taskIds = new Set<string>();
  const tasks = tasksInput.map((item, index) => {
    const task = sanitizeHabit(item, index);
    if (taskIds.has(task.id)) fail(`Привычка №${index + 1}: повторяющийся id «${task.id}»`);
    taskIds.add(task.id);
    return task;
  });

  const oneOffIds = new Set<string>();
  const oneOffTasks = oneOffInput.map((item, index) => {
    const task = sanitizeOneOff(item, index);
    if (oneOffIds.has(task.id)) fail(`Разовое дело №${index + 1}: повторяющийся id «${task.id}»`);
    oneOffIds.add(task.id);
    return task;
  });

  return {
    version: SCHEMA_VERSION,
    tasks,
    oneOffTasks,
    notes: readNotes(input.notes),
    theme: typeof input.theme === 'string' && VALID_THEMES.has(input.theme) ? input.theme : 'dark',
    reminderTimes,
    reminderTime,
    reminderEnabled: Boolean(input.reminderEnabled),
    lastAutoBackupAt: Number.isFinite(lastAutoBackupAt) ? lastAutoBackupAt : 0,
  };
}
