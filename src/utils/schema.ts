// Единая схема данных приложения. Всё, что попадает с сервера,
// из localStorage или из файла бэкапа, проходит через normalizeState.

import type { AppState, Habit, HabitStatus, OneOffPriority, OneOffTask, PauseRange, Theme } from '../types';
import { translate } from '../i18n';

export const SCHEMA_VERSION = 2;

export const DEFAULT_STATE: AppState = {
  version: SCHEMA_VERSION,
  tasks: [],
  oneOffTasks: [],
  notes: {},
  theme: 'system',
  reminderTime: '20:00',
  reminderEnabled: false,
  lastAutoBackupAt: 0,
};

const VALID_STATUSES: ReadonlySet<string> = new Set<HabitStatus>(['done', 'failed', 'empty']);
const VALID_THEMES: ReadonlySet<string> = new Set<Theme>(['light', 'dark', 'system']);
const VALID_PRIORITIES: ReadonlySet<string> = new Set<OneOffPriority>(['high', 'normal', 'low']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isRealDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// createdAt в старых данных мог быть ISO-таймстампом. Оставляем только
// реальную дневную часть, иначе `new Date('...T00:00:00')` ломает статистику.
function normalizeCreatedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().slice(0, 10);
  return isRealDateKey(key) ? key : undefined;
}

function normalizeHistory(history: unknown): Record<string, HabitStatus> {
  if (!isPlainObject(history)) return {};
  const result: Record<string, HabitStatus> = {};
  for (const [key, value] of Object.entries(history)) {
    if (isRealDateKey(key) && typeof value === 'string' && VALID_STATUSES.has(value)) {
      result[key] = value as HabitStatus;
    }
  }
  return result;
}

function normalizeSchedule(schedule: unknown): number[] | undefined {
  if (!Array.isArray(schedule)) return undefined;
  const days = schedule.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length ? [...new Set(days)] : undefined;
}

/**
 * Периоды паузы привычки: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }],
 * границы включительно. Битые записи отбрасываются, список сортируется.
 */
function normalizePauseRanges(pauseRanges: unknown): PauseRange[] {
  if (!Array.isArray(pauseRanges)) return [];
  const result: PauseRange[] = [];
  for (const range of pauseRanges) {
    if (!isPlainObject(range)) continue;
    const { from, to } = range;
    if (isRealDateKey(from) && isRealDateKey(to) && from <= to) {
      result.push({ from, to });
    }
  }
  return result.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function normalizeHabit(task: unknown): Habit | null {
  if (!isPlainObject(task) || typeof task.title !== 'string' || !task.title.trim()) return null;
  return {
    id: typeof task.id === 'string' && task.id.trim() ? task.id : crypto.randomUUID(),
    title: task.title,
    history: normalizeHistory(task.history),
    createdAt: normalizeCreatedAt(task.createdAt),
    schedule: normalizeSchedule(task.schedule),
    archived: Boolean(task.archived),
    pauseRanges: normalizePauseRanges(task.pauseRanges),
  };
}

export function normalizeOneOff(task: unknown): OneOffTask | null {
  if (!isPlainObject(task) || typeof task.title !== 'string' || !task.title.trim()) return null;
  return {
    id: typeof task.id === 'string' && task.id.trim() ? task.id : crypto.randomUUID(),
    title: task.title,
    done: Boolean(task.done),
    createdAt: normalizeCreatedAt(task.createdAt),
    deadline: isRealDateKey(task.deadline) ? task.deadline : '',
    priority: typeof task.priority === 'string' && VALID_PRIORITIES.has(task.priority)
      ? (task.priority as OneOffPriority)
      : 'normal',
  };
}

export function normalizeNotes(notes: unknown): Record<string, string> {
  if (!isPlainObject(notes)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(notes)) {
    if (isRealDateKey(key) && typeof value === 'string' && value.trim()) result[key] = value;
  }
  return result;
}

// Сервер отвергает повторяющиеся id. Клиент не должен создавать состояние,
// которое никогда не сохранится: вторую запись с тем же id считаем новой.
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    const copy = { ...item, id: crypto.randomUUID() };
    seen.add(copy.id);
    return copy;
  });
}

/**
 * Превращает произвольные данные в корректное состояние приложения.
 * Ничего не бросает: битые элементы отбрасываются, отсутствующие — берутся по умолчанию.
 */
export function normalizeState(input: unknown): AppState {
  const source = isPlainObject(input) ? input : {};
  const lastAutoBackupAt = Number(source.lastAutoBackupAt);
  return {
    version: SCHEMA_VERSION,
    tasks: uniqueById(Array.isArray(source.tasks) ? source.tasks.map(normalizeHabit).filter((task): task is Habit => task !== null) : []),
    oneOffTasks: uniqueById(Array.isArray(source.oneOffTasks) ? source.oneOffTasks.map(normalizeOneOff).filter((task): task is OneOffTask => task !== null) : []),
    notes: normalizeNotes(source.notes),
    theme: typeof source.theme === 'string' && VALID_THEMES.has(source.theme) ? (source.theme as Theme) : 'system',
    reminderTime: typeof source.reminderTime === 'string' && TIME_RE.test(source.reminderTime) ? source.reminderTime : '20:00',
    reminderEnabled: Boolean(source.reminderEnabled),
    lastAutoBackupAt: Number.isFinite(lastAutoBackupAt) && lastAutoBackupAt > 0 ? lastAutoBackupAt : 0,
  };
}

/**
 * Строгая проверка для импорта бэкапа: если структура совсем не похожа
 * на наш формат — бросаем понятную ошибку, а не роняем рендер.
 */
export function assertValidBackupData(data: unknown): true {
  if (!isPlainObject(data)) throw new Error(translate('Некорректное содержимое файла.'));
  for (const key of ['tasks', 'oneOffTasks'] as const) {
    if (!Array.isArray(data[key])) throw new Error(translate('Поле «{field}» в бэкапе должно быть списком.', { field: key }));
  }
  const tasks = data.tasks as unknown[];
  const oneOffTasks = data.oneOffTasks as unknown[];
  const hasBrokenHabit = tasks.some((task) => !isPlainObject(task) || typeof task.title !== 'string');
  const hasBrokenOneOff = oneOffTasks.some((task) => !isPlainObject(task) || typeof task.title !== 'string');
  if (hasBrokenHabit || hasBrokenOneOff) {
    throw new Error(translate('В бэкапе есть повреждённые записи.'));
  }
  return true;
}
