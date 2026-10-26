import { describe, expect, it } from 'vitest';
import { selectActiveHabits } from './selectors';

describe('selectActiveHabits', () => {
  it('возвращает только неархивные привычки', () => {
    const state = {
      tasks: [
        { id: 'h1', title: 'Активная', archived: false },
        { id: 'h2', title: 'Архивная', archived: true },
        { id: 'h3', title: 'Без флага' },
      ],
    };

    expect(selectActiveHabits(state).map((task) => task.id)).toEqual(['h1', 'h3']);
  });

  it('на пустом состоянии возвращает пустой список', () => {
    expect(selectActiveHabits({ tasks: [] })).toEqual([]);
  });
});
