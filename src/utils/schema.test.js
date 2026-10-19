import { describe, expect, it } from 'vitest';
import { assertValidBackupData, normalizeState } from './schema';

describe('normalizeState', () => {
  it('подставляет значения по умолчанию для мусора', () => {
    const state = normalizeState(null);
    expect(state.tasks).toEqual([]);
    expect(state.oneOffTasks).toEqual([]);
    expect(state.theme).toBe('system');
    expect(state.reminderTime).toBe('20:00');
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
    expect(state.theme).toBe('system');
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
