import { describe, expect, it } from 'vitest';
import { LIMITS, StateValidationError, sanitizeAppState } from '../src/state/state.schema';

const base = {
  version: 3,
  tasks: [],
  oneOffTasks: [],
  notes: {},
  theme: 'dark',
  reminderTimes: ['09:00', '14:00', '20:00'],
  reminderTime: '20:00',
  reminderEnabled: false,
  lastAutoBackupAt: 0,
};

describe('sanitizeAppState', () => {
  it('нормализует пустое состояние', () => {
    const state = sanitizeAppState({});
    expect(state.tasks).toEqual([]);
    expect(state.theme).toBe('dark');
    expect(state.reminderTimes).toEqual(['09:00', '14:00', '20:00']);
    expect(state.reminderTime).toBe('09:00');
  });

  it('переносит старое одиночное время в три слота', () => {
    const state = sanitizeAppState({ ...base, reminderTimes: undefined, reminderTime: '20:00' });
    expect(state.reminderTimes).toEqual(['09:00', '14:00', '20:00']);
    expect(state.reminderTime).toBe('20:00');
  });

  it('бросает ошибку, если вход не объект', () => {
    expect(() => sanitizeAppState(null)).toThrow(StateValidationError);
    expect(() => sanitizeAppState('строка')).toThrow(StateValidationError);
    expect(() => sanitizeAppState([1, 2, 3])).toThrow(StateValidationError);
  });

  it('требует непустое название привычки', () => {
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: '   ' }] })).toThrow(/название/i);
  });

  it('отбрасывает неизвестный статус отметки', () => {
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: 'Бег', history: { '2026-10-01': 'maybe' } }] })).toThrow(StateValidationError);
  });

  it('требует дату в формате ГГГГ-ММ-ДД', () => {
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: 'Бег', history: { '01.10.2026': 'done' } }] })).toThrow(/дата/i);
  });

  it('чинит расписание и отбрасывает некорректные дни', () => {
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: 'Бег', schedule: [1, 9] }] })).toThrow(/день недели/i);
    const state = sanitizeAppState({ ...base, tasks: [{ title: 'Бег', schedule: [1, 1, 2] }] });
    expect(state.tasks[0].schedule).toEqual([1, 2]);
  });

  it('нормализует периоды паузы: сортирует и схлопывает пересечения', () => {
    const state = sanitizeAppState({
      ...base,
      tasks: [{
        title: 'Бег',
        pauseRanges: [
          { from: '2026-10-10', to: '2026-10-12' },
          { from: '2026-10-01', to: '2026-10-05' },
          { from: '2026-10-04', to: '2026-10-08' },
        ],
      }],
    });
    expect(state.tasks[0].pauseRanges).toEqual([
      { from: '2026-10-01', to: '2026-10-08' },
      { from: '2026-10-10', to: '2026-10-12' },
    ]);
  });

  it('отбрасывает некорректные периоды паузы', () => {
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: 'Бег', pauseRanges: [{ from: '05.10.2026', to: '2026-10-05' }] }] })).toThrow(/пауза/i);
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: 'Бег', pauseRanges: [{ from: '2026-10-05', to: '2026-10-01' }] }] })).toThrow(/позже/i);
    expect(() => sanitizeAppState({ ...base, tasks: [{ title: 'Бег', pauseRanges: [{ from: '2026-10-05' }] }] })).toThrow(/пауза/i);
  });

  it('принимает темы light/dark, иначе — dark', () => {
    expect(sanitizeAppState({ ...base, theme: 'light' }).theme).toBe('light');
    expect(sanitizeAppState({ ...base, theme: 'dark' }).theme).toBe('dark');
    expect(sanitizeAppState({ ...base, theme: 'neon' }).theme).toBe('dark');
  });

  it('отбрасывает неизвестный приоритет и чинит дедлайн', () => {
    expect(() => sanitizeAppState({ ...base, oneOffTasks: [{ title: 'X', priority: 'urgent' }] })).toThrow(/приоритет/i);
    expect(() => sanitizeAppState({ ...base, oneOffTasks: [{ title: 'X', deadline: '30-10-2026' }] })).toThrow(/дедлайн/i);
  });

  it('канонизирует время напоминания разовой задачи', () => {
    const state = sanitizeAppState({
      ...base,
      oneOffTasks: [{ title: 'X', reminderAt: '2026-10-01T21:00:00+03:00' }],
    });
    expect(state.oneOffTasks[0].reminderAt).toBe('2026-10-01T18:00:00.000Z');
    expect(() => sanitizeAppState({ ...base, oneOffTasks: [{ title: 'X', reminderAt: 'не дата' }] })).toThrow(/напоминания/i);
  });

  it('отбрасывает слишком длинную и пустую заметку', () => {
    const long = 'z'.repeat(LIMITS.note + 10);
    expect(() => sanitizeAppState({ ...base, notes: { '2026-10-01': long } })).toThrow(/заметка/i);
    expect(sanitizeAppState({ ...base, notes: { '2026-10-01': '   ' } }).notes).toEqual({});
  });

  it('ограничивает число привычек', () => {
    const tasks = Array.from({ length: LIMITS.tasks + 1 }, (_, index) => ({ title: `H${index}` }));
    expect(() => sanitizeAppState({ ...base, tasks })).toThrow(/много привычек/i);
  });

  it('сообщает понятный текст ошибки', () => {
    try {
      sanitizeAppState({ ...base, tasks: [{ title: '' }] });
      throw new Error('должно было бросить');
    } catch (error) {
      expect(error).toBeInstanceOf(StateValidationError);
      expect((error as Error).message).toMatch(/Привычка №1/);
    }
  });
});
