// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HabitManager } from './HabitManager.jsx';

// Компонент сам берёт привычки из стора и дату из контекста — пропсов больше нет.
// Проверяем именно это: список из стора, валидацию формы и действия.

const mocks = vi.hoisted(() => ({
  store: { state: { tasks: [] }, actions: {} },
  confirm: async () => true,
  notify: () => {},
}));

vi.mock('../store/AppStore', () => ({ useAppStore: () => mocks.store }));
vi.mock('./FeedbackContext', () => ({ useFeedback: () => ({ confirm: mocks.confirm, notify: mocks.notify }) }));
vi.mock('../hooks/TodayContext', () => ({ useToday: () => ({ today: new Date(2026, 9, 26, 12), todayKey: '2026-10-26' }) }));

function habit(overrides = {}) {
  return {
    id: 'h1',
    title: 'Утренняя зарядка',
    createdAt: '2026-01-01',
    schedule: [0, 1, 2, 3, 4, 5, 6],
    history: {},
    pauseRanges: [],
    archived: false,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.confirm = vi.fn(async () => true);
  mocks.notify = vi.fn();
  mocks.store = {
    state: {
      tasks: [
        habit(),
        habit({ id: 'h2', title: 'Старая привычка', archived: true }),
      ],
    },
    actions: {
      addHabit: vi.fn(),
      renameHabit: vi.fn(),
      changeHabitSchedule: vi.fn(),
      moveHabit: vi.fn(),
      pauseHabit: vi.fn(),
      unpauseHabit: vi.fn(),
      archiveHabit: vi.fn(),
      restoreHabit: vi.fn(),
      deleteHabit: vi.fn(),
    },
  };
});

afterEach(() => cleanup());

function creationDays() {
  return within(screen.getByRole('group', { name: 'Дни выполнения новой привычки' }));
}

function addHabit(title) {
  fireEvent.change(screen.getByLabelText('Название привычки'), { target: { value: title } });
  fireEvent.click(screen.getByText('Добавить привычку'));
}

describe('HabitManager', () => {
  it('показывает активные и архивные привычки без единого пропса', () => {
    render(<HabitManager />);

    expect(screen.getByText('Утренняя зарядка')).toBeTruthy();
    expect(screen.getByText('Старая привычка')).toBeTruthy();
    expect(screen.getByText('Архив привычек').textContent).toContain('1');
    expect(screen.queryByRole('group', { name: 'Расписание привычки Старая привычка' })).toBeNull();
  });

  it('не создаёт привычку без названия', () => {
    render(<HabitManager />);

    addHabit('   ');

    expect(screen.getByRole('alert').textContent).toBe('Укажи название привычки.');
    expect(mocks.store.actions.addHabit).not.toHaveBeenCalled();
  });

  it('не создаёт привычку без выбранных дней', () => {
    render(<HabitManager />);

    for (const button of creationDays().getAllByRole('button')) fireEvent.click(button);
    addHabit('Без дней');

    expect(screen.getByRole('alert').textContent).toBe('Выбери хотя бы один день выполнения.');
    expect(mocks.store.actions.addHabit).not.toHaveBeenCalled();
  });

  it('создаёт привычку с выбранными днями и очищает поле', () => {
    render(<HabitManager />);

    fireEvent.click(creationDays().getByRole('button', { name: 'СР' }));
    addHabit('  Вечерняя прогулка  ');

    expect(mocks.store.actions.addHabit).toHaveBeenCalledWith('Вечерняя прогулка', [1, 2, 4, 5, 6, 0]);
    expect(screen.getByLabelText('Название привычки').value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('меняет расписание существующей привычки', () => {
    render(<HabitManager />);
    const row = within(screen.getByRole('group', { name: 'Расписание привычки Утренняя зарядка' }));

    fireEvent.click(row.getByRole('button', { name: 'СР: по расписанию' }));

    expect(mocks.store.actions.changeHabitSchedule).toHaveBeenCalledWith('h1', 3);
  });

  it('двигает привычки по списку и блокирует крайние кнопки', () => {
    mocks.store.state.tasks = [habit(), habit({ id: 'h3', title: 'Вторая привычка' })];
    render(<HabitManager />);

    expect(screen.getByLabelText('Поднять Утренняя зарядка выше').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Опустить Утренняя зарядка ниже'));

    expect(mocks.store.actions.moveHabit).toHaveBeenCalledWith(0, 1);
    expect(screen.getByLabelText('Опустить Вторая привычка ниже').disabled).toBe(true);
  });

  it('удаляет только после подтверждения', async () => {
    render(<HabitManager />);

    fireEvent.click(screen.getByLabelText('Удалить Утренняя зарядка'));
    await waitFor(() => expect(mocks.store.actions.deleteHabit).toHaveBeenCalledWith('h1'));
    expect(mocks.notify).toHaveBeenCalledWith('Привычка «Утренняя зарядка» удалена.', { tone: 'success' });

    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByLabelText('Удалить Утренняя зарядка'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.store.actions.deleteHabit).toHaveBeenCalledTimes(1);
  });

  it('архивирует и возвращает привычку', async () => {
    render(<HabitManager />);

    fireEvent.click(screen.getByText('В архив'));
    await waitFor(() => expect(mocks.store.actions.archiveHabit).toHaveBeenCalledWith('h1'));

    fireEvent.click(screen.getByText('Вернуть'));
    expect(mocks.store.actions.restoreHabit).toHaveBeenCalledWith('h2');
  });

  it('ставит паузу с сегодняшнего дня', () => {
    render(<HabitManager />);

    fireEvent.click(screen.getByLabelText('Пауза для Утренняя зарядка'));
    fireEvent.click(screen.getByText('Поставить'));

    expect(mocks.store.actions.pauseHabit).toHaveBeenCalledWith('h1', '2026-10-26', '2026-10-26');
  });

  it('переименовывает привычку', () => {
    render(<HabitManager />);

    fireEvent.click(screen.getByLabelText('Переименовать Утренняя зарядка'));
    const input = screen.getByLabelText('Новое название привычки');
    fireEvent.change(input, { target: { value: '  Утренняя растяжка  ' } });
    fireEvent.click(screen.getByText('Сохранить'));

    expect(mocks.store.actions.renameHabit).toHaveBeenCalledWith('h1', 'Утренняя растяжка');
  });
});
