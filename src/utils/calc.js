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
  // Полдень вместо полуночи: перевод часов не делает «соседний день»
  // вчерашним/завтрашним и не выкидывает сегодня из цикла.
  day.setHours(12, 0, 0, 0);
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
    .filter(
      (date) =>
        history[date] === STATUS.DONE &&
        !isPaused({ pauseRanges }, date) &&
        schedule.includes(new Date(`${date}T12:00:00`).getDay()),
    )
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
  const monthStart = new Date(year, month, 1, 12);
  const monthEnd = new Date(year, month + 1, 0, 12);
  const today = new Date(year, month, referenceDate.getDate(), 12);
  const parsedCreated = task.createdAt ? new Date(`${task.createdAt}T12:00:00`) : monthStart;
  const created = Number.isNaN(parsedCreated.getTime()) ? monthStart : parsedCreated;
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

/**
 * Доля выполненных привычек за конкретный день — основа графика «ритм месяца»,
 * линии тренда и матрицы. Возвращает null, если в этот день по расписанию не
 * было ни одной активной привычки (выходной) — такие дни отмечаем отдельно.
 */
export function buildDayPercent(tasks, dateKey, day, referenceDate = new Date()) {
  // Будущие дни текущего месяца ещё не наступили: это не «0%», а «нет данных».
  if (dateKey > toDateKey(referenceDate)) return null;
  let expected = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.archived) continue;
    if (task.createdAt && task.createdAt > dateKey) continue; // привычки ещё не было
    if (!(task.schedule || [0, 1, 2, 3, 4, 5, 6]).includes(day.getDay())) continue;
    if (isPaused(task, dateKey)) continue;
    expected += 1;
    if (task.history?.[dateKey] === STATUS.DONE) done += 1;
  }
  return expected === 0 ? null : done / expected;
}

/**
 * Сводка выполнения за месяц по всем активным привычкам: сколько раз надо было
 * отметить и сколько отмечено. asOfDay ограничивает расчёт (для текущего месяца
 * считаем только до сегодня; для прошедших — весь месяц).
 */
export function getMonthSummary(tasks, year, month, asOfDay, referenceDate = new Date()) {
  const monthEnd = new Date(year, month + 1, 0, 12);
  const now = new Date(referenceDate);
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const fallbackDay = isFutureMonth ? 0 : isCurrentMonth ? now.getDate() : monthEnd.getDate();
  const lastDay = Math.max(0, Math.min(asOfDay ?? fallbackDay, monthEnd.getDate()));
  let expected = 0;
  let done = 0;
  for (let dayNumber = 1; dayNumber <= lastDay; dayNumber++) {
    const day = new Date(year, month, dayNumber, 12);
    const dateKey = toDateKey(day);
    for (const task of tasks) {
      if (task.archived) continue;
      if (task.createdAt && task.createdAt > dateKey) continue;
      if (!(task.schedule || [0, 1, 2, 3, 4, 5, 6]).includes(day.getDay())) continue;
      if (isPaused(task, dateKey)) continue;
      expected += 1;
      if (task.history?.[dateKey] === STATUS.DONE) done += 1;
    }
  }
  return { done, expected, percent: expected ? Math.round((done / expected) * 100) : 0 };
}

/** Разница между текущим и прошлым процентом (в процентных пунктах). */
export function getPercentDelta(currentPercent, previousPercent) {
  return Math.round(currentPercent) - Math.round(previousPercent);
}

/**
 * Сводка по дням недели за всю историю: сколько раз каждая привычка должна была
 * выполняться и сколько раз выполнена. Используется, чтобы найти самый
 * продуктивный день недели.
 */
export function getWeekdayStats(tasks, referenceDate = new Date()) {
  const today = new Date(referenceDate);
  today.setHours(12, 0, 0, 0);
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, done: 0, expected: 0 }));
  for (const task of tasks) {
    if (task.archived) continue;
    const history = task.history || {};
    const schedule = task.schedule || [0, 1, 2, 3, 4, 5, 6];
    const parsedCreated = task.createdAt ? new Date(`${task.createdAt}T12:00:00`) : null;
    const created = parsedCreated && !Number.isNaN(parsedCreated.getTime()) ? parsedCreated : null;
    const start = created ?? new Date(today.getFullYear(), today.getMonth(), 1, 12);
    for (const day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
      if (!schedule.includes(day.getDay()) || isPaused(task, toDateKey(day))) continue;
      weekdays[day.getDay()].expected += 1;
      if (history[toDateKey(day)] === STATUS.DONE) weekdays[day.getDay()].done += 1;
    }
  }
  return weekdays;
}

/** Самый продуктивный день недели (0 — воскресенье) или null, если данных нет. */
export function getMostProductiveWeekday(tasks, referenceDate = new Date()) {
  return getWeekdayStats(tasks, referenceDate).reduce((best, day) => {
    if (!day.expected) return best;
    if (!best || day.done / day.expected > best.done / best.expected) return day;
    return best;
  }, null)?.day ?? null;
}

// ---------- Утилиты дат ----------

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export { STATUS };
