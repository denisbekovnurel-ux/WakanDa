import { randomUUID } from 'node:crypto';

// Схема и серверная валидация состояния пользователя.
// Файл намеренно не зависит от Nest: валидатор можно запускать и тестировать сам по себе.
// Клиент тоже нормализует состояние (src/utils/schema.js), но сервер не должен
// доверять клиенту: сюда может прийти что угодно, в том числе в обход интерфейса.

export const SCHEMA_VERSION = 2;

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
  }>;
  goals: Array<{
    id: string;
    title: string;
    unit: string;
    target: number;
    dailyRate: number;
    current: number;
    log: Array<{ date: string; amount: number }>;
    createdAt?: string;
  }>;
  notes: Record<string, string>;
  theme: string;
  reminderTime: string;
  reminderEnabled: boolean;
  lastAutoBackupAt: number;
};

export const DEFAULT_STATE: AppState = {
  version: SCHEMA_VERSION,
  tasks: [],
  oneOffTasks: [],
  goals: [],
  notes: {},
  theme: 'system',
  reminderTime: '20:00',
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
  goals: 500,
  goalLog: 20000,
  notes: 10000,
  title: 200,
  note: 5000,
  unit: 24,
  id: 128,
  timestamp: 40,
  deadline: 32,
} as const;

const VALID_STATUSES = new Set<HabitStatus>(['done', 'failed', 'empty']);
const VALID_PRIORITIES = new Set(['high', 'normal', 'low']);
const VALID_THEMES = new Set(['light', 'dark', 'system']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

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

function readOptionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, max);
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
    if (!DATE_RE.test(key)) fail(`${where}: некорректная дата отметки «${key}»`);
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
    if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
      fail(`${itemWhere}: нужны даты ГГГГ-ММ-ДД (от и до)`);
    }
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
    createdAt: readOptionalString(input.createdAt, LIMITS.timestamp),
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
    deadline = input.deadline.slice(0, LIMITS.deadline);
    if (deadline && !DATE_RE.test(deadline)) fail(`${where}: дедлайн должен быть в формате ГГГГ-ММ-ДД`);
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
    createdAt: readOptionalString(input.createdAt, LIMITS.timestamp),
    deadline,
    priority,
  };
}

function readGoalLog(value: unknown, where: string): Array<{ date: string; amount: number }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${where}: журнал прогресса должен быть списком`);
  if (value.length > LIMITS.goalLog) fail(`${where}: слишком много записей прогресса (максимум ${LIMITS.goalLog})`);
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) fail(`${where}: запись прогресса №${index + 1} повреждена`);
    if (typeof entry.date !== 'string' || !DATE_RE.test(entry.date)) {
      fail(`${where}: запись прогресса №${index + 1} — некорректная дата`);
    }
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount)) fail(`${where}: запись прогресса №${index + 1} — некорректное число`);
    return { date: entry.date, amount };
  });
}

function sanitizeGoal(input: unknown, index: number): AppState['goals'][number] {
  const where = `Цель №${index + 1}`;
  if (!isPlainObject(input)) fail(`${where}: ожидается объект`);
  const target = Number(input.target);
  if (!Number.isFinite(target) || target <= 0) fail(`${where}: общий объём должен быть положительным числом`);
  const dailyRate = Number(input.dailyRate);
  if (!Number.isFinite(dailyRate) || dailyRate <= 0) fail(`${where}: норма в день должна быть положительным числом`);
  const current = Number(input.current);
  const unitRaw = typeof input.unit === 'string' ? input.unit.trim() : '';
  if (unitRaw.length > LIMITS.unit) fail(`${where}: единица измерения слишком длинная`);
  return {
    id: readId(input.id),
    title: readTitle(input.title, where),
    unit: unitRaw || 'шт',
    target,
    dailyRate,
    current: Number.isFinite(current) ? current : 0,
    log: readGoalLog(input.log, where),
    createdAt: readOptionalString(input.createdAt, LIMITS.timestamp),
  };
}

function readNotes(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) fail('Заметки должны быть объектом');
  const keys = Object.keys(value);
  if (keys.length > LIMITS.notes) fail(`Слишком много заметок (максимум ${LIMITS.notes})`);
  const notes: Record<string, string> = {};
  for (const key of keys) {
    if (!DATE_RE.test(key)) fail(`Некорректная дата заметки «${key}»`);
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

  const goalsInput = input.goals ?? [];
  if (!Array.isArray(goalsInput)) fail('Поле «goals» должно быть списком');
  if (goalsInput.length > LIMITS.goals) fail(`Слишком много целей (максимум ${LIMITS.goals})`);

  const reminderTime = typeof input.reminderTime === 'string' && TIME_RE.test(input.reminderTime) ? input.reminderTime : '20:00';
  const lastAutoBackupAt = Number(input.lastAutoBackupAt);

  return {
    version: SCHEMA_VERSION,
    tasks: tasksInput.map(sanitizeHabit),
    oneOffTasks: oneOffInput.map(sanitizeOneOff),
    goals: goalsInput.map(sanitizeGoal),
    notes: readNotes(input.notes),
    theme: typeof input.theme === 'string' && VALID_THEMES.has(input.theme) ? input.theme : 'system',
    reminderTime,
    reminderEnabled: Boolean(input.reminderEnabled),
    lastAutoBackupAt: Number.isFinite(lastAutoBackupAt) ? lastAutoBackupAt : 0,
  };
}
