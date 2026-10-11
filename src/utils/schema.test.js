import { describe, expect, it } from 'vitest';
import { assertValidBackupData, normalizeState } from './schema';

describe('normalizeState', () => {
  it('подставляет значения по умолчанию для мусора', () => {
    const state = normalizeState(null);
    expect(state.tasks).toEqual([]);
    expect(state.oneOffTasks).toEqual([]);
    expect(state.goals).toEqual([]);
    expect(state.theme).toBe('system');
    expect(state.reminderTime).toBe('20:00');
  });

  it('отбрасывает битые записи и чинит поля', () => {
    const state = normalizeState({
      tasks: [{ title: 'Утро', history: { '2026-10-01': 'done', bad: 'oops' }, schedule: [1, 8, 'x', 2] }, { noTitle: true }, 'строка'],
      oneOffTasks: [{ title: 'Задача', priority: 'critical' }],
      goals: [{ title: 'Книги', target: 0 }],
      notes: { '2026-10-01': 'текст', '2026-10-02': '' },
      theme: 'blue',
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].history).toEqual({ '2026-10-01': 'done' });
    expect(state.tasks[0].schedule).toEqual([1, 2]);
    expect(state.oneOffTasks).toHaveLength(1);
    expect(state.oneOffTasks[0].priority).toBe('normal');
    expect(state.goals).toHaveLength(0);
    expect(state.notes).toEqual({ '2026-10-01': 'текст' });
    expect(state.theme).toBe('system');
  });
});

describe('assertValidBackupData', () => {
  it('принимает корректные данные', () => {
    expect(() => assertValidBackupData({ tasks: [], oneOffTasks: [], goals: [] })).not.toThrow();
  });

  it('бросает ошибку на tasks: "abc"', () => {
    expect(() => assertValidBackupData({ tasks: 'abc', oneOffTasks: [], goals: [] })).toThrow(/tasks/);
  });

  it('бросает ошибку на записи без title', () => {
    expect(() => assertValidBackupData({ tasks: [{ id: '1' }], oneOffTasks: [], goals: [] })).toThrow();
  });
});
