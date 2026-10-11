// Единая схема данных приложения. Всё, что попадает с сервера,
// из localStorage или из файла бэкапа, проходит через normalizeState.

export const SCHEMA_VERSION = 2;

export const DEFAULT_STATE = {
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

const VALID_STATUSES = new Set(['done', 'failed', 'empty']);
const VALID_THEMES = new Set(['light', 'dark', 'system']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHistory(history) {
  if (!isPlainObject(history)) return {};
  const result = {};
  for (const [key, value] of Object.entries(history)) {
    if (typeof key === 'string' && VALID_STATUSES.has(value)) result[key] = value;
  }
  return result;
}

function normalizeSchedule(schedule) {
  if (!Array.isArray(schedule)) return undefined;
  const days = schedule.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length ? [...new Set(days)] : undefined;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Периоды паузы привычки: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }],
 * границы включительно. Битые записи отбрасываются, список сортируется.
 */
function normalizePauseRanges(pauseRanges) {
  if (!Array.isArray(pauseRanges)) return [];
  const result = [];
  for (const range of pauseRanges) {
    if (!isPlainObject(range)) continue;
    const { from, to } = range;
    if (typeof from === 'string' && DATE_KEY_RE.test(from) && typeof to === 'string' && DATE_KEY_RE.test(to) && from <= to) {
      result.push({ from, to });
    }
  }
  return result.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function normalizeHabit(task) {
  if (!isPlainObject(task) || typeof task.title !== 'string' || !task.title.trim()) return null;
  return {
    id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
    title: task.title,
    history: normalizeHistory(task.history),
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : undefined,
    schedule: normalizeSchedule(task.schedule),
    archived: Boolean(task.archived),
    pauseRanges: normalizePauseRanges(task.pauseRanges),
  };
}

export function normalizeOneOff(task) {
  if (!isPlainObject(task) || typeof task.title !== 'string' || !task.title.trim()) return null;
  return {
    id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
    title: task.title,
    done: Boolean(task.done),
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : undefined,
    deadline: typeof task.deadline === 'string' && task.deadline ? task.deadline : '',
    priority: ['high', 'normal', 'low'].includes(task.priority) ? task.priority : 'normal',
  };
}

export function normalizeGoal(goal) {
  if (!isPlainObject(goal) || typeof goal.title !== 'string' || !goal.title.trim()) return null;
  const target = Number(goal.target);
  const dailyRate = Number(goal.dailyRate);
  if (!Number.isFinite(target) || target <= 0) return null;
  return {
    id: typeof goal.id === 'string' ? goal.id : crypto.randomUUID(),
    title: goal.title,
    unit: typeof goal.unit === 'string' && goal.unit ? goal.unit : 'шт',
    target,
    dailyRate: Number.isFinite(dailyRate) && dailyRate > 0 ? dailyRate : 1,
    current: Number(goal.current) || 0,
    log: Array.isArray(goal.log) ? goal.log.filter((item) => isPlainObject(item) && typeof item.date === 'string').map((item) => ({ date: item.date, amount: Number(item.amount) || 0 })) : [],
    createdAt: typeof goal.createdAt === 'string' ? goal.createdAt : undefined,
  };
}

export function normalizeNotes(notes) {
  if (!isPlainObject(notes)) return {};
  const result = {};
  for (const [key, value] of Object.entries(notes)) {
    if (typeof value === 'string' && value.trim()) result[key] = value;
  }
  return result;
}

/**
 * Превращает произвольные данные в корректное состояние приложения.
 * Ничего не бросает: битые элементы отбрасываются, отсутствующие — берутся по умолчанию.
 */
export function normalizeState(input) {
  const source = isPlainObject(input) ? input : {};
  return {
    version: SCHEMA_VERSION,
    tasks: Array.isArray(source.tasks) ? source.tasks.map(normalizeHabit).filter(Boolean) : [],
    oneOffTasks: Array.isArray(source.oneOffTasks) ? source.oneOffTasks.map(normalizeOneOff).filter(Boolean) : [],
    goals: Array.isArray(source.goals) ? source.goals.map(normalizeGoal).filter(Boolean) : [],
    notes: normalizeNotes(source.notes),
    theme: VALID_THEMES.has(source.theme) ? source.theme : 'system',
    reminderTime: typeof source.reminderTime === 'string' && /^\d{2}:\d{2}$/.test(source.reminderTime) ? source.reminderTime : '20:00',
    reminderEnabled: Boolean(source.reminderEnabled),
    lastAutoBackupAt: Number(source.lastAutoBackupAt) || 0,
  };
}

/**
 * Строгая проверка для импорта бэкапа: если структура совсем не похожа
 * на наш формат — бросаем понятную ошибку, а не роняем рендер.
 */
export function assertValidBackupData(data) {
  if (!isPlainObject(data)) throw new Error('Некорректное содержимое файла.');
  for (const key of ['tasks', 'oneOffTasks', 'goals']) {
    if (!Array.isArray(data[key])) throw new Error(`Поле «${key}» в бэкапе должно быть списком.`);
  }
  const hasBrokenHabit = data.tasks.some((task) => !isPlainObject(task) || typeof task.title !== 'string');
  const hasBrokenOneOff = data.oneOffTasks.some((task) => !isPlainObject(task) || typeof task.title !== 'string');
  const hasBrokenGoal = data.goals.some((goal) => !isPlainObject(goal) || typeof goal.title !== 'string' || !(Number(goal.target) > 0));
  if (hasBrokenHabit || hasBrokenOneOff || hasBrokenGoal) {
    throw new Error('В бэкапе есть повреждённые записи.');
  }
  return true;
}
