import { describe, expect, it } from 'vitest';
import {
  countActiveOneOff,
  countPendingHabits,
  dailyReminderBody,
  dueOneOffReminders,
  dueReminderDateKey,
  dueReminderSlots,
  localDateParts,
  normalizeTimezoneOffset,
  readReminderTimes,
} from '../src/push/push.util';

describe('normalizeTimezoneOffset', () => {
  it('принимает реальные смещения и обнуляет выдуманные', () => {
    expect(normalizeTimezoneOffset(180)).toBe(180);
    expect(normalizeTimezoneOffset(-300)).toBe(-300);
    expect(normalizeTimezoneOffset('120')).toBe(120);
    expect(normalizeTimezoneOffset(9999)).toBe(0);
    expect(normalizeTimezoneOffset(-9999)).toBe(0);
    expect(normalizeTimezoneOffset('abc')).toBe(0);
    expect(normalizeTimezoneOffset(undefined)).toBe(0);
  });
});

describe('localDateParts', () => {
  it('сдвигает UTC на смещение', () => {
    const now = new Date('2026-10-11T19:30:00Z');
    expect(localDateParts(now, 180)).toEqual({ dateKey: '2026-10-11', hhmm: '22:30' });
    expect(localDateParts(now, -300)).toEqual({ dateKey: '2026-10-11', hhmm: '14:30' });
  });

  it('переходит на следующий день при восточном смещении', () => {
    const now = new Date('2026-10-11T22:30:00Z');
    expect(localDateParts(now, 180).dateKey).toBe('2026-10-12');
  });
});

describe('dueReminderDateKey', () => {
  const now = new Date('2026-10-11T17:00:00Z'); // 20:00 при UTC+3

  it('срабатывает ровно в минуту напоминания', () => {
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '20:00' }, now, 180)).toBe('2026-10-11');
  });

  it('не срабатывает раньше назначенного времени', () => {
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '20:01' }, now, 180)).toBeNull();
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '20:00' }, new Date('2026-10-11T16:59:00Z'), 180)).toBeNull();
  });

  it('догоняет напоминание, пропущенное в пределах окна', () => {
    // Сервер лежал в 20:00 и поднялся в 20:30 — напоминание за тот же день уходит.
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '20:00' }, new Date('2026-10-11T17:30:00Z'), 180)).toBe('2026-10-11');
  });

  it('не догоняет позже окна', () => {
    // 23:31 при напоминании в 20:00 — это уже за пределами трёх часов.
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '20:00' }, new Date('2026-10-11T20:31:00Z'), 180)).toBeNull();
  });

  it('молчит, если напоминания выключены', () => {
    expect(dueReminderDateKey({ reminderEnabled: false, reminderTime: '20:00' }, now, 180)).toBeNull();
    expect(dueReminderDateKey(null, now, 180)).toBeNull();
  });

  it('игнорирует некорректное время', () => {
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '25:99' }, now, 180)).toBeNull();
    expect(dueReminderDateKey({ reminderEnabled: true, reminderTime: '' }, now, 180)).toBeNull();
  });
});

describe('readReminderTimes', () => {
  it('поддерживает старый reminderTime и новый список', () => {
    expect(readReminderTimes({ reminderTime: '20:00' })).toEqual(['09:00', '14:00', '20:00']);
    expect(readReminderTimes({ reminderTimes: ['20:00', '09:00', '20:00'] })).toEqual(['09:00', '14:00', '20:00']);
    expect(readReminderTimes({ reminderTimes: ['25:00', '14:00'] })).toEqual(['09:00', '14:00', '20:00']);
    expect(readReminderTimes(null)).toEqual([]);
  });
});

describe('dueReminderSlots', () => {
  it('возвращает только наступившие слоты из трёх', () => {
    const settings = { reminderEnabled: true, reminderTimes: ['09:00', '14:00', '20:00'] };
    expect(dueReminderSlots(settings, new Date('2026-10-11T17:00:00Z'), 180)).toEqual([
      { dateKey: '2026-10-11', time: '20:00' },
    ]);
    expect(dueReminderSlots(settings, new Date('2026-10-11T11:30:00Z'), 180)).toEqual([
      { dateKey: '2026-10-11', time: '14:00' },
    ]);
  });

  it('догоняет несколько слотов, пропущенных в пределах окна', () => {
    const settings = { reminderEnabled: true, reminderTimes: ['19:00', '20:00'] };
    expect(dueReminderSlots(settings, new Date('2026-10-11T17:30:00Z'), 180).map((slot) => slot.time)).toEqual([
      '19:00',
      '20:00',
    ]);
  });

  it('молчит, если напоминания выключены', () => {
    expect(dueReminderSlots({ reminderEnabled: false, reminderTimes: ['20:00'] }, new Date('2026-10-11T17:00:00Z'), 180)).toEqual([]);
  });
});

describe('ежедневный текст и счётчики', () => {
  const state = {
    tasks: [
      { id: 'h1', title: 'Бег', history: { '2026-10-11': 'done' } },
      { id: 'h2', title: 'Чтение', createdAt: '2026-10-11T10:00:00.000Z' },
      { id: 'h3', title: 'Архив', archived: true },
      { id: 'h4', title: 'Завтра', createdAt: '2026-10-12T10:00:00.000Z' },
    ],
    oneOffTasks: [
      { id: 'o1', title: 'Отчёт' },
      { id: 'o2', title: 'Закрыто', done: true },
    ],
  };

  it('считает незакрытые привычки и активные разовые задачи', () => {
    expect(countPendingHabits(state, '2026-10-11')).toBe(1);
    expect(countActiveOneOff(state)).toBe(1);
    expect(dailyReminderBody(state, '2026-10-11')).toContain('привычек: 1');
    expect(dailyReminderBody(state, '2026-10-11')).toContain('разовых задач: 1');
  });
});

describe('dueOneOffReminders', () => {
  const source = {
    oneOffTasks: [
      { id: 't1', title: 'Отправить отчёт', reminderAt: '2026-10-11T17:00:00.000Z' },
      { id: 't2', title: 'Уже закрыто', done: true, reminderAt: '2026-10-11T17:00:00.000Z' },
    ],
  };

  it('находит напоминание о разовой задаче в пределах суток', () => {
    expect(dueOneOffReminders(source, new Date('2026-10-11T17:30:00Z'), 180)).toEqual([
      {
        taskId: 't1',
        title: 'Отправить отчёт',
        dateKey: '2026-10-11',
        slot: 'oneoff:t1:2026-10-11T17:00:00.000Z',
        reminderAt: '2026-10-11T17:00:00.000Z',
      },
    ]);
  });

  it('не будит раньше времени и не догоняет через сутки', () => {
    expect(dueOneOffReminders(source, new Date('2026-10-11T16:59:00Z'), 180)).toEqual([]);
    expect(dueOneOffReminders(source, new Date('2026-10-12T17:01:00Z'), 180)).toEqual([]);
  });
});
