import { describe, expect, it } from 'vitest';
import { getBestStreak, getGoalProgress, getHabitStats, getStreak, isPaused, toggleDoneStatus, markFailedStatus, toDateKey, STATUS } from './calc';

function keyDaysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return toDateKey(date);
}

describe('toggleDoneStatus', () => {
  it('кликом переключает только done/пусто', () => {
    expect(toggleDoneStatus(STATUS.EMPTY)).toBe(STATUS.DONE);
    expect(toggleDoneStatus(STATUS.DONE)).toBe(STATUS.EMPTY);
    expect(toggleDoneStatus(STATUS.FAILED)).toBe(STATUS.EMPTY);
  });
});

describe('markFailedStatus', () => {
  it('ставит провал', () => {
    expect(markFailedStatus()).toBe(STATUS.FAILED);
  });
});

describe('getStreak', () => {
  it('считает подряд идущие done от сегодня', () => {
    const history = { [keyDaysAgo(0)]: 'done', [keyDaysAgo(1)]: 'done', [keyDaysAgo(2)]: 'done' };
    expect(getStreak(history)).toBe(3);
  });

  it('разрыв серии обнуляет стрик', () => {
    const history = { [keyDaysAgo(0)]: 'done', [keyDaysAgo(2)]: 'done', [keyDaysAgo(3)]: 'done' };
    expect(getStreak(history)).toBe(1);
  });

  it('провал сегодня обнуляет стрик', () => {
    const history = { [keyDaysAgo(0)]: 'failed', [keyDaysAgo(1)]: 'done' };
    expect(getStreak(history)).toBe(0);
  });

  it('неотмеченный сегодня не прерывает серию — считается со вчера', () => {
    const history = { [keyDaysAgo(1)]: 'done', [keyDaysAgo(2)]: 'done' };
    expect(getStreak(history)).toBe(2);
  });

  it('учитывает расписание: выходные не прерывают серию', () => {
    const today = new Date();
    const schedule = [today.getDay()]; // только сегодня по расписанию
    const history = { [keyDaysAgo(0)]: 'done' };
    expect(getStreak(history, schedule)).toBe(1);
  });
});

describe('getBestStreak', () => {
  it('находит самую длинную серию в истории', () => {
    const history = {};
    for (let i = 10; i >= 8; i -= 1) history[keyDaysAgo(i)] = 'done';
    history[keyDaysAgo(0)] = 'done';
    history[keyDaysAgo(1)] = 'done';
    expect(getBestStreak(history)).toBe(3);
  });

  it('пустая история — 0', () => {
    expect(getBestStreak({})).toBe(0);
  });
});

describe('getHabitStats', () => {
  it('считает процент месяца и done/expected', () => {
    const today = new Date();
    const createdAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const history = { [keyDaysAgo(0)]: 'done' };
    const stats = getHabitStats({ history, createdAt, schedule: [today.getDay()] }, today);
    expect(stats.monthExpected).toBeGreaterThanOrEqual(1);
    expect(stats.monthDone).toBe(1);
    expect(stats.monthPercent).toBeGreaterThanOrEqual(0);
    expect(stats.monthPercent).toBeLessThanOrEqual(100);
  });

  it('возвращает bestStreak из истории', () => {
    const history = { [keyDaysAgo(0)]: 'done', [keyDaysAgo(1)]: 'done' };
    const stats = getHabitStats({ history });
    expect(stats.bestStreak).toBe(2);
  });
});

describe('getGoalProgress', () => {
  it('считает percent, remaining и isDone', () => {
    const goal = { target: 100, current: 40, dailyRate: 5, createdAt: keyDaysAgo(3), log: [] };
    const progress = getGoalProgress(goal);
    expect(progress.current).toBe(40);
    expect(progress.percent).toBe(40);
    expect(progress.remaining).toBe(60);
    expect(progress.isDone).toBe(false);
    expect(progress.daysLeft).toBeGreaterThan(0);
  });

  it('учитывает лог, а не только поле current', () => {
    const goal = { target: 10, createdAt: keyDaysAgo(0), current: 0, log: [{ date: keyDaysAgo(0), amount: 3 }, { date: keyDaysAgo(0), amount: 2 }] };
    expect(getGoalProgress(goal).current).toBe(5);
  });

  it('isDone при достижении цели', () => {
    const goal = { target: 10, current: 10, dailyRate: 1, createdAt: keyDaysAgo(1), log: [] };
    expect(getGoalProgress(goal).isDone).toBe(true);
    expect(getGoalProgress(goal).daysLeft).toBe(0);
  });
});

describe('пауза привычки', () => {
  it('isPaused определяет попадание даты в период', () => {
    const task = { pauseRanges: [{ from: keyDaysAgo(3), to: keyDaysAgo(1) }] };
    expect(isPaused(task, keyDaysAgo(2))).toBe(true);
    expect(isPaused(task, keyDaysAgo(1))).toBe(true);
    expect(isPaused(task, keyDaysAgo(0))).toBe(false);
    expect(isPaused({}, keyDaysAgo(0))).toBe(false);
  });

  it('день паузы не прерывает стрик', () => {
    const history = { [keyDaysAgo(0)]: 'done', [keyDaysAgo(2)]: 'done', [keyDaysAgo(3)]: 'done' };
    const pauseRanges = [{ from: keyDaysAgo(1), to: keyDaysAgo(1) }];
    expect(getStreak(history, [0, 1, 2, 3, 4, 5, 6], new Date(), pauseRanges)).toBe(3);
  });

  it('провал в день паузы не сгорает', () => {
    const history = { [keyDaysAgo(0)]: 'failed', [keyDaysAgo(1)]: 'done', [keyDaysAgo(2)]: 'done' };
    const pauseRanges = [{ from: keyDaysAgo(0), to: keyDaysAgo(0) }];
    expect(getStreak(history, [0, 1, 2, 3, 4, 5, 6], new Date(), pauseRanges)).toBe(2);
  });

  it('getBestStreak пропускает дни паузы', () => {
    const history = { [keyDaysAgo(0)]: 'done', [keyDaysAgo(2)]: 'done' };
    const pauseRanges = [{ from: keyDaysAgo(1), to: keyDaysAgo(1) }];
    expect(getBestStreak(history, [0, 1, 2, 3, 4, 5, 6], pauseRanges)).toBe(2);
  });

  it('дни паузы не входят в ожидание месяца', () => {
    const today = new Date();
    const createdAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const history = { [keyDaysAgo(0)]: 'done' };
    const base = getHabitStats({ history, createdAt, schedule: [today.getDay()] }, today);
    const paused = getHabitStats({ history, createdAt, schedule: [today.getDay()], pauseRanges: [{ from: createdAt, to: keyDaysAgo(0) }] }, today);
    expect(base.monthExpected).toBeGreaterThanOrEqual(1);
    expect(paused.monthExpected).toBe(0);
  });
});

describe('toDateKey', () => {
  it('форматирует дату как YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});
