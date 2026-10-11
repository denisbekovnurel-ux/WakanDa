import { describe, expect, it } from 'vitest';
import { LIMITS, StateValidationError, sanitizeAppState } from '../src/state/state.schema';

const base = {
  version: 2,
  tasks: [],
  oneOffTasks: [],
  goals: [],
  notes: {},
  theme: 'system',
  reminderTime: '20:00',
  reminderEnabled: false,
  lastAutoBackupAt: 0,
};

describe('sanitizeAppState', () => {
  it('нормализует пустое состояние', () => {
    const state = sanitizeAppState({});
    expect(state.tasks).toEqual([]);
    expect(state.goals).toEqual([]);
    expect(state.theme).toBe('system');
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

  it('принимает темы light/dark/system, иначе — system', () => {
    expect(sanitizeAppState({ ...base, theme: 'light' }).theme).toBe('light');
    expect(sanitizeAppState({ ...base, theme: 'dark' }).theme).toBe('dark');
    expect(sanitizeAppState({ ...base, theme: 'neon' }).theme).toBe('system');
  });

  it('требует положительный объём цели', () => {
    expect(() => sanitizeAppState({ ...base, goals: [{ title: 'Книги', target: 0 }] })).toThrow(/положительн/i);
  });

  it('отбрасывает неизвестный приоритет и чинит дедлайн', () => {
    expect(() => sanitizeAppState({ ...base, oneOffTasks: [{ title: 'X', priority: 'urgent' }] })).toThrow(/приоритет/i);
    expect(() => sanitizeAppState({ ...base, oneOffTasks: [{ title: 'X', deadline: '30-10-2026' }] })).toThrow(/дедлайн/i);
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
