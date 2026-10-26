// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OneOffList } from './OneOffList.jsx';

// Разовые задачи тоже берутся из стора, а «сегодня» — из контекста.

const mocks = vi.hoisted(() => ({
  store: { state: { oneOffTasks: [] }, actions: {} },
  confirm: async () => true,
  notify: () => {},
}));

vi.mock('../store/AppStore', () => ({ useAppStore: () => mocks.store }));
vi.mock('./FeedbackContext', () => ({ useFeedback: () => ({ confirm: mocks.confirm, notify: mocks.notify }) }));
vi.mock('../hooks/TodayContext', () => ({ useToday: () => ({ today: new Date(2026, 9, 26, 12), todayKey: '2026-10-26' }) }));

beforeEach(() => {
  mocks.confirm = vi.fn(async () => true);
  mocks.notify = vi.fn();
  mocks.store = {
    state: {
      oneOffTasks: [
        { id: 'a1', title: 'Отправить документы', done: false, createdAt: '2026-10-01', deadline: '2026-10-20', priority: 'high' },
        { id: 'a2', title: 'Купить лампу', done: false, createdAt: '2026-10-02', deadline: '', priority: 'normal' },
        { id: 'd1', title: 'Оплатить счёт', done: true, createdAt: '2026-09-01', deadline: '', priority: 'normal' },
      ],
    },
    actions: {
      addOneOff: vi.fn(),
      toggleOneOff: vi.fn(),
      deleteOneOff: vi.fn(),
      renameOneOff: vi.fn(),
      moveOneOff: vi.fn(),
    },
  };
});

afterEach(() => cleanup());

describe('OneOffList', () => {
  it('рисует задачи из стора, делит на активные и архив', () => {
    render(<OneOffList />);

    expect(screen.getByRole('heading', { name: /В работе/ }).textContent).toContain('2');
    expect(screen.getByRole('heading', { name: /Архив выполненного/ }).textContent).toContain('1');
    expect(screen.getByText('Отправить документы')).toBeTruthy();
    expect(screen.getByText('Оплатить счёт')).toBeTruthy();
    expect(screen.getByText('ПРОСРОЧЕНО · 2026-10-20')).toBeTruthy();
  });

  it('добавляет задачу с сегодняшней датой по умолчанию', () => {
    render(<OneOffList />);

    fireEvent.change(screen.getByLabelText('Название разовой задачи'), { target: { value: '  Позвонить в банк  ' } });
    fireEvent.click(screen.getByText('Добавить задачу'));

    expect(mocks.store.actions.addOneOff).toHaveBeenCalledWith('Позвонить в банк', { deadline: '', priority: 'normal' }, '2026-10-26');
    expect(screen.getByLabelText('Название разовой задачи').value).toBe('');
  });

  it('фильтрует просроченные и приоритетные задачи', () => {
    render(<OneOffList />);

    fireEvent.click(screen.getByRole('button', { name: 'Просроченные' }));
    expect(screen.queryByText('Купить лампу')).toBeNull();
    expect(screen.getByText('Отправить документы')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Высокий приоритет' }));
    expect(screen.getByText('Отправить документы')).toBeTruthy();
    expect(screen.queryByText('Купить лампу')).toBeNull();
  });

  it('отмечает задачу выполненной', () => {
    render(<OneOffList />);

    fireEvent.click(screen.getByLabelText('Отметить выполненной: Отправить документы'));

    expect(mocks.store.actions.toggleOneOff).toHaveBeenCalledWith('a1');
  });

  it('в ручном режиме двигает задачи кнопками', () => {
    render(<OneOffList />);
    fireEvent.click(screen.getByRole('button', { name: 'Вручную' }));

    expect(screen.getByLabelText('Поднять Отправить документы').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Опустить Отправить документы'));

    expect(mocks.store.actions.moveOneOff).toHaveBeenCalledWith('a1', 1);
  });

  it('удаляет задачу только после подтверждения', async () => {
    render(<OneOffList />);

    fireEvent.click(screen.getByLabelText('Удалить разовую задачу Отправить документы'));
    await waitFor(() => expect(mocks.store.actions.deleteOneOff).toHaveBeenCalledWith('a1'));
    expect(mocks.notify).toHaveBeenCalledWith('Задача «Отправить документы» удалена.', { tone: 'success' });

    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByLabelText('Удалить разовую задачу Купить лампу'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.store.actions.deleteOneOff).toHaveBeenCalledTimes(1);
  });

  it('переименовывает задачу', () => {
    render(<OneOffList />);

    fireEvent.click(screen.getByLabelText('Переименовать Отправить документы'));
    fireEvent.change(screen.getByLabelText('Новое название задачи'), { target: { value: 'Отправить отчёт' } });
    fireEvent.click(screen.getByText('Сохранить'));

    expect(mocks.store.actions.renameOneOff).toHaveBeenCalledWith('a1', 'Отправить отчёт');
  });

  it('при включённом фильтре счётчик показывает только видимые задачи', () => {
    render(<OneOffList />);
    fireEvent.click(screen.getByRole('button', { name: 'Просроченные' }));

    expect(screen.getByRole('heading', { name: /В работе/ }).textContent).toContain('1');
    expect(screen.queryByText('Купить лампу')).toBeNull();
  });
});
