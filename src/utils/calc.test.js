import { describe, expect, it } from 'vitest';
import { buildDayPercent, getBestStreak, getHabitStats, getMonthSummary, getMostProductiveWeekday, getPercentDelta, getStreak, isPaused, toggleDoneStatus, markFailedStatus, toDateKey, STATUS } from './calc';

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

describe('buildDayPercent', () => {
  const day = new Date(2026, 4, 20); // 2026-05-20
  const key = toDateKey(day);

  it('считает долю выполненных среди запланированных', () => {
    const tasks = [
      { createdAt: '2026-05-01', schedule: [day.getDay()], history: { [key]: 'done' } },
      { createdAt: '2026-05-01', schedule: [day.getDay()], history: {} },
      { createdAt: '2026-05-01', schedule: [(day.getDay() + 1) % 7], history: {} },
    ];
    expect(buildDayPercent(tasks, key, day)).toBeCloseTo(0.5);
  });

  it('возвращает null, если в этот день ничего не запланировано', () => {
    const tasks = [{ createdAt: '2026-05-01', schedule: [(day.getDay() + 1) % 7], history: {} }];
    expect(buildDayPercent(tasks, key, day)).toBeNull();
  });

  it('не учитывает привычку, созданную позже даты', () => {
    const tasks = [{ createdAt: '2026-06-01', schedule: [day.getDay()], history: {} }];
    expect(buildDayPercent(tasks, key, day)).toBeNull();
  });
});

describe('getMonthSummary', () => {
  it('считает общий процент месяца', () => {
    const tasks = [{ createdAt: '2026-05-01', schedule: [0, 1, 2, 3, 4, 5, 6], history: { '2026-05-01': 'done', '2026-05-02': 'done' } }];
    const summary = getMonthSummary(tasks, 2026, 4, 2);
    expect(summary.expected).toBe(2);
    expect(summary.done).toBe(2);
    expect(summary.percent).toBe(100);
  });

  it('дни паузы не входят в ожидание', () => {
    const tasks = [{ createdAt: '2026-05-01', schedule: [0, 1, 2, 3, 4, 5, 6], history: { '2026-05-01': 'done' }, pauseRanges: [{ from: '2026-05-02', to: '2026-05-02' }] }];
    const summary = getMonthSummary(tasks, 2026, 4, 2);
    expect(summary.expected).toBe(1);
    expect(summary.percent).toBe(100);
  });

  it('пустой месяц — ноль без деления на ноль', () => {
    expect(getMonthSummary([], 2026, 4, 31)).toEqual({ done: 0, expected: 0, percent: 0 });
  });
});

describe('getPercentDelta', () => {
  it('считает разницу в процентных пунктах', () => {
    expect(getPercentDelta(80, 65)).toBe(15);
    expect(getPercentDelta(50, 72)).toBe(-22);
    expect(getPercentDelta(40, 40)).toBe(0);
  });
});

describe('getMostProductiveWeekday', () => {
  it('выбирает день недели с лучшей долей выполнения', () => {
    const history = {};
    const start = new Date();
    for (let i = 0; i < 60; i += 1) {
      const date = new Date(start);
      date.setDate(date.getDate() - i);
      history[toDateKey(date)] = date.getDay() === 1 ? 'done' : 'failed';
    }
    const task = { history, createdAt: toDateKey(new Date(Date.now() - 60 * 86400000)) };
    expect(getMostProductiveWeekday([task], new Date())).toBe(1); // понедельник
  });

  it('без данных возвращает null', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    expect(getMostProductiveWeekday([{ history: {}, createdAt: toDateKey(future) }], new Date())).toBeNull();
  });
});
