import { describe, expect, it } from 'vitest';
import { dueReminderDateKey, localDateParts, normalizeTimezoneOffset } from '../src/push/push.util';

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
