import { describe, expect, it } from 'vitest';
import { assertValidBackupData, normalizeState } from './schema';

describe('normalizeState', () => {
  it('подставляет значения по умолчанию для мусора', () => {
    const state = normalizeState(null);
    expect(state.tasks).toEqual([]);
    expect(state.oneOffTasks).toEqual([]);
    expect(state.theme).toBe('dark');
    expect(state.reminderTimes).toEqual(['09:00', '14:00', '20:00']);
  });

  it('отбрасывает битые записи и чинит поля', () => {
    const state = normalizeState({
      tasks: [{ title: 'Утро', history: { '2026-10-01': 'done', bad: 'oops' }, schedule: [1, 8, 'x', 2] }, { noTitle: true }, 'строка'],
      oneOffTasks: [{ title: 'Задача', priority: 'critical' }],
      notes: { '2026-10-01': 'текст', '2026-10-02': '' },
      theme: 'blue',
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].history).toEqual({ '2026-10-01': 'done' });
    expect(state.tasks[0].schedule).toEqual([1, 2]);
    expect(state.oneOffTasks).toHaveLength(1);
    expect(state.oneOffTasks[0].priority).toBe('normal');
    expect(state.notes).toEqual({ '2026-10-01': 'текст' });
    expect(state.theme).toBe('dark');
  });

  it('переводит устаревшую системную тему в тёмную', () => {
    expect(normalizeState({ theme: 'system' }).theme).toBe('dark');
  });

  it('нормализует периоды паузы привычки', () => {
    const state = normalizeState({
      tasks: [{
        title: 'Спорт',
        pauseRanges: [
          { from: '2026-10-05', to: '2026-10-03' }, // начало позже конца — отбрасывается
          { from: '2026-10-10', to: '2026-10-12' },
          { from: '2026-10-01', to: '2026-10-02' },
          { from: 'нет', to: '2026-10-12' },
          'мусор',
        ],
      }],
    });
    expect(state.tasks[0].pauseRanges).toEqual([
      { from: '2026-10-01', to: '2026-10-02' },
      { from: '2026-10-10', to: '2026-10-12' },
    ]);
  });

  it('отбрасывает несуществующие даты, а не только битый формат', () => {
    const state = normalizeState({
      tasks: [{ title: 'Утро', history: { '2026-02-30': 'done', '2026-13-01': 'done', '2026-06-31': 'failed' } }],
      notes: { '2025-02-29': 'невисокосный год' },
    });
    expect(state.tasks[0].history).toEqual({});
    expect(state.notes).toEqual({});
  });

  it('приводит ISO-createdAt к дневному ключу', () => {
    const state = normalizeState({
      tasks: [{ title: 'Утро', createdAt: '2026-10-05T21:30:00.000Z' }],
      oneOffTasks: [{ title: 'Задача', createdAt: '2026-10-05' }],
    });
    expect(state.tasks[0].createdAt).toBe('2026-10-05');
    expect(state.oneOffTasks[0].createdAt).toBe('2026-10-05');
  });

  it('обнуляет битые createdAt и дедлайн', () => {
    const state = normalizeState({
      tasks: [{ title: 'Утро', createdAt: 'вчера' }],
      oneOffTasks: [{ title: 'Задача', deadline: '30-10-2026' }],
    });
    expect(state.tasks[0].createdAt).toBeUndefined();
    expect(state.oneOffTasks[0].deadline).toBe('');
  });

  it('даёт новый id повторяющейся записи — состояние остаётся сохраняемым', () => {
    const state = normalizeState({
      tasks: [
        { id: 'same', title: 'Первая' },
        { id: 'same', title: 'Вторая' },
      ],
    });
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[0].id).toBe('same');
    expect(state.tasks[1].id).not.toBe('same');
    const ids = state.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('чинит битое время напоминания и lastAutoBackupAt', () => {
    const state = normalizeState({ reminderTime: '25:99', lastAutoBackupAt: 'не число' });
    expect(state.reminderTimes).toEqual(['09:00', '14:00', '20:00']);
    expect(state.lastAutoBackupAt).toBe(0);
  });
});

describe('assertValidBackupData', () => {
  it('принимает корректные данные', () => {
    expect(() => assertValidBackupData({ tasks: [], oneOffTasks: [] })).not.toThrow();
  });

  it('бросает ошибку на tasks: "abc"', () => {
    expect(() => assertValidBackupData({ tasks: 'abc', oneOffTasks: [] })).toThrow(/tasks/);
  });

  it('бросает ошибку на записи без title', () => {
    expect(() => assertValidBackupData({ tasks: [{ id: '1' }], oneOffTasks: [] })).toThrow();
  });
});
