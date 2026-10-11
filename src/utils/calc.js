// ---------- Цели с прогрессом (книга, страницы и т.п.) ----------

/**
 * Считает % выполнения, реальный темп и прогноз оставшихся дней.
 * goal: { target, current, dailyRate, createdAt: 'YYYY-MM-DD' }
 */
export function getGoalProgress(goal, referenceDate = new Date()) {
  const { target, dailyRate, createdAt } = goal;
  const current = Array.isArray(goal.log) && goal.log.length
    ? goal.log.reduce((total, item) => total + Math.max(0, Number(item.amount) || 0), 0)
    : Number(goal.current) || 0;

  const safeTarget = Math.max(1, Number(target) || 1);
  const safeCurrent = Math.max(0, Number(current) || 0);
  const percent = Math.min(100, Math.round((safeCurrent / safeTarget) * 100));
  const remaining = Math.max(0, safeTarget - safeCurrent);

  const start = new Date(`${createdAt}T00:00:00`);
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  const daysSinceStart = Number.isNaN(start.getTime()) ? 1 : Math.max(1, Math.floor((today - start) / 86400000) + 1);

  // реальный темп: сколько в среднем делаешь в день, а не сколько планировал
  const actualRate = safeCurrent / daysSinceStart;

  // если ещё не начинал — прогноз строим по плановому темпу, чтобы не делить на 0
  const rateForForecast = actualRate > 0 ? actualRate : Math.max(1, Number(dailyRate) || 1);
  const daysLeft = remaining > 0 ? Math.ceil(remaining / rateForForecast) : 0;
  const todayKey = toDateKey(today);
  const todayProgress = (goal.log || []).reduce((total, item) => total + (item.date === todayKey ? Math.max(0, Number(item.amount) || 0) : 0), 0);

  return {
    current: safeCurrent,
    percent,
    remaining,
    daysLeft,
    actualRate: Math.round(actualRate * 10) / 10, // для отображения "твой темп: 3.2/день"
    todayProgress,
    dailyRate: Math.max(0, Number(dailyRate) || 0),
    isDone: safeCurrent >= safeTarget,
  };
}

// ---------- Daily-задачи: тройной статус и стрик ----------

const STATUS = { EMPTY: 'empty', DONE: 'done', FAILED: 'failed' };

/**
 * Короткий клик: пусто → выполнено → пусто. Провал сбрасывается в пусто.
 * Для «провала» используйте markFailedStatus (long-press / контекстное меню).
 */
export function toggleDoneStatus(current) {
  if (current === STATUS.DONE || current === STATUS.FAILED) return STATUS.EMPTY;
  return STATUS.DONE;
}

export function markFailedStatus() {
  return STATUS.FAILED;
}

/**
 * Привычка на паузе в дату dateKey ('YYYY-MM-DD')?
 * pauseRanges: Array<{ from: string, to: string }> — границы включительно.
 */
export function isPaused(task, dateKey) {
  const ranges = Array.isArray(task?.pauseRanges) ? task.pauseRanges : [];
  return ranges.some((range) => {
    if (!range || typeof range.from !== 'string' || typeof range.to !== 'string') return false;
    return dateKey >= range.from && dateKey <= range.to;
  });
}

/**
 * Текущий стрик подряд идущих "done", считая от сегодня назад.
 * history: { 'YYYY-MM-DD': 'done' | 'failed' | 'empty' }
 * pauseRanges: дни паузы считаются нейтральными — стрик не сгорает.
 */
export function getStreak(history, schedule = [0, 1, 2, 3, 4, 5, 6], referenceDate = new Date(), pauseRanges = []) {
  if (!schedule.length) return 0;
  const day = new Date(referenceDate);
  day.setHours(0, 0, 0, 0);
  const paused = (dateKey) => isPaused({ pauseRanges }, dateKey);
  const todayKey = toDateKey(day);
  if (schedule.includes(day.getDay()) && !paused(todayKey)) {
    if (history[todayKey] === STATUS.FAILED) return 0;
    if (history[todayKey] !== STATUS.DONE) day.setDate(day.getDate() - 1);
  }
  let streak = 0;

  while (true) {
    if (!schedule.includes(day.getDay()) || paused(toDateKey(day))) {
      day.setDate(day.getDate() - 1);
      continue;
    }
    const key = toDateKey(day);
    if (history[key] === STATUS.DONE) {
      streak++;
      day.setDate(day.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export function getBestStreak(history, schedule = [0, 1, 2, 3, 4, 5, 6], pauseRanges = []) {
  const dates = Object.keys(history || {})
    .filter((date) => history[date] === STATUS.DONE && schedule.includes(new Date(`${date}T12:00:00`).getDay()))
    .sort();
  let best = 0;
  let current = 0;
  let previous = null;

  dates.forEach((dateKey) => {
    const date = new Date(`${dateKey}T12:00:00`);
    const previousDate = previous ? new Date(`${previous}T12:00:00`) : null;
    let scheduledGap = 0;
    if (previousDate) {
      const cursor = new Date(previousDate);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor < date) {
        if (schedule.includes(cursor.getDay()) && !isPaused({ pauseRanges }, toDateKey(cursor))) scheduledGap++;
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const consecutive = previousDate && scheduledGap === 0;
    current = consecutive ? current + 1 : 1;
    best = Math.max(best, current);
    previous = dateKey;
  });

  return best;
}

export function getHabitStats(task, referenceDate = new Date()) {
  const history = task.history || {};
  const schedule = task.schedule || [0, 1, 2, 3, 4, 5, 6];
  const pauseRanges = task.pauseRanges || [];
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const today = new Date(year, month, referenceDate.getDate());
  const created = task.createdAt ? new Date(`${task.createdAt}T00:00:00`) : monthStart;
  const start = created > monthStart ? created : monthStart;
  let monthExpected = 0;
  let monthDone = 0;

  for (const day = new Date(start); day <= today && day <= monthEnd; day.setDate(day.getDate() + 1)) {
    if (!schedule.includes(day.getDay()) || isPaused(task, toDateKey(day))) continue;
    monthExpected++;
    if (history[toDateKey(day)] === STATUS.DONE) monthDone++;
  }

  const weekdays = Array.from({ length: 7 }, (_, index) => ({ day: index, done: 0, expected: 0 }));
  for (const day = new Date(created); day <= today; day.setDate(day.getDate() + 1)) {
    if (!schedule.includes(day.getDay()) || isPaused(task, toDateKey(day))) continue;
    const weekday = weekdays[day.getDay()];
    weekday.expected++;
    if (history[toDateKey(day)] === STATUS.DONE) weekday.done++;
  }

  const mostProductiveDay = weekdays.reduce((best, day) => {
    if (!day.expected) return best;
    if (!best || day.done / day.expected > best.done / best.expected) return day;
    return best;
  }, null);

  return {
    bestStreak: getBestStreak(history, schedule, pauseRanges),
    monthPercent: monthExpected ? Math.round((monthDone / monthExpected) * 100) : 0,
    monthDone,
    monthExpected,
    mostProductiveDay: mostProductiveDay?.day ?? null,
  };
}

// ---------- Утилиты дат ----------

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export { STATUS };
