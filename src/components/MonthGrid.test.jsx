// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthGrid } from './MonthGrid';
import { STATUS } from '../utils/calc';

// Календарь раньше получал активные привычки пропсом из App.
// Теперь проверяем, что он сам берёт их из стора и фильтрует архив.

const mocks = vi.hoisted(() => ({
  store: { state: { tasks: [] }, actions: {} },
  confirm: async () => true,
  notify: () => {},
}));

vi.mock('../store/AppStore', () => ({ useAppStore: () => mocks.store }));
vi.mock('./FeedbackContext', () => ({ useFeedback: () => ({ confirm: mocks.confirm, notify: mocks.notify }) }));
vi.mock('../hooks/TodayContext', () => ({ useToday: () => ({ today: new Date(2026, 9, 26, 12), todayKey: '2026-10-26' }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
  mocks.confirm = vi.fn(async () => true);
  mocks.notify = vi.fn();
  mocks.store = {
    state: {
      tasks: [
        { id: 'h1', title: 'Утренняя зарядка', createdAt: '2026-01-01', schedule: [0, 1, 2, 3, 4, 5, 6], history: {}, pauseRanges: [], archived: false },
        { id: 'h2', title: 'Старая привычка', createdAt: '2025-01-01', schedule: [0, 1, 2, 3, 4, 5, 6], history: {}, pauseRanges: [], archived: true },
      ],
    },
    actions: { setHabitStatus: vi.fn(), archiveHabit: vi.fn() },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MonthGrid', () => {
  it('берёт активные привычки из стора и не показывает архив', () => {
    render(<MonthGrid />);

    expect(screen.getByText('Утренняя зарядка')).toBeTruthy();
    expect(screen.queryByText('Старая привычка')).toBeNull();
    expect(screen.getByText('Ритм месяца')).toBeTruthy();
  });

  it('отмечает выполнение по клику на прошедший день', () => {
    render(<MonthGrid />);

    fireEvent.click(screen.getByRole('button', { name: /2026-10-25: не отмечено/ }));

    expect(mocks.store.actions.setHabitStatus).toHaveBeenCalledWith('h1', '2026-10-25', STATUS.DONE);
  });

  it('не даёт отметиться в будущем', () => {
    render(<MonthGrid />);

    const future = screen.getByRole('button', { name: /2026-10-27: будущее/ });
    expect(future.disabled).toBe(true);
    fireEvent.click(future);
    expect(mocks.store.actions.setHabitStatus).not.toHaveBeenCalled();
  });

  it('архивирует привычку после подтверждения', async () => {
    render(<MonthGrid />);

    fireEvent.click(screen.getByLabelText('Переместить привычку Утренняя зарядка в архив'));

    await vi.waitFor(() => expect(mocks.store.actions.archiveHabit).toHaveBeenCalledWith('h1'));
    expect(mocks.notify).toHaveBeenCalledWith('«Утренняя зарядка» перемещена в архив.', { tone: 'success' });
  });

  it('показывает подсказку, когда привычек нет', () => {
    mocks.store.state.tasks = [];
    render(<MonthGrid />);

    expect(screen.getByText(/Сначала добавь привычку/)).toBeTruthy();
  });
});
