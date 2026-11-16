import type { AppState } from '../state/state.schema';

// Чистая логика AI-тренера: собираем компактную сводку по состоянию и умеем
// дать полезный локальный разбор, если внешняя модель не настроена.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FULL_SCHEDULE = [0, 1, 2, 3, 4, 5, 6];

export type CoachSummary = {
  today: string;
  activeHabits: number;
  scheduledToday: number;
  doneToday: number;
  pendingToday: number;
  pendingTitles: string[];
  bestStreak: number;
  completion30d: number;
  weekDone: number;
  openTasks: number;
  overdueTasks: number;
  overdueTitles: string[];
};

function dateKey(value: string): string {
  return value.slice(0, 10);
}

function addDays(key: string, delta: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function weekday(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function isPaused(task: AppState['tasks'][number], key: string): boolean {
  return (task.pauseRanges || []).some((range) => key >= range.from && key <= range.to);
}

function isScheduled(task: AppState['tasks'][number], key: string): boolean {
  const schedule = task.schedule?.length ? task.schedule : FULL_SCHEDULE;
  return schedule.includes(weekday(key)) && !isPaused(task, key);
}

function isCreated(task: AppState['tasks'][number], key: string): boolean {
  return !task.createdAt || dateKey(task.createdAt) <= key;
}

function habitStreak(task: AppState['tasks'][number], today: string): number {
  const history = task.history || {};
  if (!isCreated(task, today)) return 0;
  let cursor = today;
  let streak = 0;

  if (isScheduled(task, today)) {
    if (history[today] === 'failed') return 0;
    // Сегодняшний незакрытый день не обнуляет серию: она считается по
    // предыдущим запланированным дням.
    if (history[today] !== 'done') cursor = addDays(today, -1);
  }

  for (let guard = 0; guard < 366; guard += 1) {
    if (!isCreated(task, cursor)) break;
    if (!isScheduled(task, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (history[cursor] === 'done') {
      streak += 1;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

export function normalizeCoachDate(value: unknown): string {
  if (typeof value === 'string' && DATE_RE.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return new Date().toISOString().slice(0, 10);
}

export function sanitizeCoachQuestion(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    // Контрольные символы вырезаются намеренно: они портят запрос к модели.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 500);
}

export function buildCoachSummary(state: AppState, today: string): CoachSummary {
  const active = (state.tasks || []).filter((task) => !task.archived);
  const scheduled = active.filter((task) => isCreated(task, today) && isScheduled(task, today));
  const doneToday = scheduled.filter((task) => task.history?.[today] === 'done').length;
  const pending = scheduled.filter((task) => {
    const status = task.history?.[today];
    return status !== 'done' && status !== 'failed';
  });
  const bestStreak = active.reduce((best, task) => Math.max(best, habitStreak(task, today)), 0);

  let expected30 = 0;
  let done30 = 0;
  let weekDone = 0;
  for (const task of active) {
    for (let offset = 0; offset < 30; offset += 1) {
      const key = addDays(today, -offset);
      if (!isCreated(task, key) || !isScheduled(task, key)) continue;
      expected30 += 1;
      if (task.history?.[key] === 'done') done30 += 1;
    }
    for (let offset = 0; offset < 7; offset += 1) {
      if (task.history?.[addDays(today, -offset)] === 'done') weekDone += 1;
    }
  }

  const open = (state.oneOffTasks || []).filter((task) => !task.done);
  const overdue = open.filter((task) => Boolean(task.deadline) && task.deadline! < today);

  return {
    today,
    activeHabits: active.length,
    scheduledToday: scheduled.length,
    doneToday,
    pendingToday: pending.length,
    pendingTitles: pending.slice(0, 6).map((task) => task.title),
    bestStreak,
    completion30d: expected30 ? Math.round((done30 / expected30) * 100) : 0,
    weekDone,
    openTasks: open.length,
    overdueTasks: overdue.length,
    overdueTitles: overdue.slice(0, 5).map((task) => task.title),
  };
}

/** Локальный разбор без внешней модели — честный fallback, а не «пустышка». */
export function localCoachAdvice(summary: CoachSummary): string {
  if (summary.activeHabits === 0) {
    return 'Пока нет активных привычек. Начни с одной маленькой: например, «5 минут растяжки» или «прочитать 2 страницы». Главное — сделать её настолько простой, чтобы пропустить было трудно.\n\nСледующий шаг: добавь одну привычку и отметь её сегодня.';
  }

  const lines: string[] = [];
  if (summary.scheduledToday === 0) {
    lines.push('Сегодня по расписанию нет привычек — это хороший день, чтобы разобрать разовые задачи и подготовиться к следующей неделе.');
  } else if (summary.pendingToday === 0) {
    lines.push(`Сегодня закрыто ${summary.doneToday} из ${summary.scheduledToday} привычек. День уже выглядит собранным.`);
  } else {
    const titles = summary.pendingTitles.length ? `: ${summary.pendingTitles.join(', ')}` : '';
    lines.push(`Сегодня отмечено ${summary.doneToday} из ${summary.scheduledToday}. Осталось ${summary.pendingToday}${titles}.`);
  }

  if (summary.bestStreak >= 7) {
    lines.push(`Лучшая текущая серия — ${summary.bestStreak} дн. Не увеличивай нагрузку резко: сохрани ритм ещё на неделю.`);
  } else if (summary.bestStreak > 0) {
    lines.push(`Текущая серия — ${summary.bestStreak} дн. Она уже работает; защити её минимальным действием даже в загруженный день.`);
  } else {
    lines.push('Серия пока не началась. Не пытайся закрыть всё сразу — выбери одну привычку и отметь её сегодня.');
  }

  if (summary.completion30d < 50) {
    lines.push(`За 30 дней выполнено ${summary.completion30d}% запланированного. Возможно, график слишком плотный: сократи количество привычек или сделай шаги меньше.`);
  } else {
    lines.push(`За 30 дней выполнено ${summary.completion30d}% запланированного — это устойчивый темп.`);
  }

  if (summary.overdueTasks > 0) {
    lines.push(`Просрочено разовых задач: ${summary.overdueTasks}${summary.overdueTitles.length ? ` (${summary.overdueTitles.join(', ')})` : ''}. Выбери одну и назначь новый реальный срок.`);
  }

  lines.push(
    summary.pendingToday > 0
      ? 'Следующий шаг: закрой одну самую короткую привычку из списка прямо сейчас.'
      : 'Следующий шаг: сохрани ритм — отметь завтрашний день так же спокойно и без рывка.',
  );
  return lines.join('\n\n');
}

export function buildCoachPrompt(summary: CoachSummary, question: string): {
  system: string;
  user: string;
} {
  const system =
    'Ты — AI-тренер по дисциплине и привычкам в приложении WakanDa. ' +
    'Отвечай по-русски, коротко и по делу: до 180 слов. ' +
    'Не ставь медицинских диагнозов, не морализируй и не выдумывай данные. ' +
    'Опирайся только на переданную сводку. Дай 1–2 наблюдения и один конкретный следующий шаг. ' +
    'Если данных мало, предложи минимальный первый шаг.';
  const user = [
    `Дата пользователя: ${summary.today}.`,
    question ? `Вопрос пользователя: ${question}` : 'Пользователь просит разбор текущего ритма.',
    `Сводка (JSON): ${JSON.stringify(summary)}`,
  ].join('\n');
  return { system, user };
}
