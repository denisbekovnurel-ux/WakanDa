// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncConflictDialog } from './SyncConflictDialog.jsx';

// Конфликт синхронизации — точка, где можно потерять данные. Проверяем
// подписи с количеством, выбор стороны, блокировку кнопок и ошибку сохранения.

afterEach(() => cleanup());

function makeState({ tasks = 0, oneOff = 0, notes = 0 }) {
  return {
    tasks: Array.from({ length: tasks }, (_, index) => ({ id: `task-${index}`, title: `Привычка ${index}` })),
    oneOffTasks: Array.from({ length: oneOff }, (_, index) => ({ id: `one-${index}`, title: `Дело ${index}` })),
    notes: Object.fromEntries(Array.from({ length: notes }, (_, index) => [`2026-10-0${index + 1}`, 'текст'])),
  };
}

function conflict(local = {}, remote = {}) {
  return {
    local: makeState(local),
    remote: makeState(remote),
    remoteUpdatedAt: '2026-10-26T10:00:00.000Z',
    remoteRevision: 7,
  };
}

describe('SyncConflictDialog', () => {
  it('показывает количество данных в обеих версиях с правильными формами', () => {
    render(<SyncConflictDialog conflict={conflict({ tasks: 1, oneOff: 2, notes: 5 }, { tasks: 5, oneOff: 21, notes: 1 })} onChoose={vi.fn()} />);

    const text = document.body.textContent;
    expect(text).toContain('1 привычка');
    expect(text).toContain('2 разовых дела');
    expect(text).toContain('5 заметок');
    expect(text).toContain('5 привычек');
    expect(text).toContain('21 разовое дело');
    expect(text).toContain('1 заметка');
    expect(screen.getByText('Есть две версии данных')).toBeTruthy();
  });

  it('возвращает выбранную сторону: локальные правки или сервер', async () => {
    const onChoose = vi.fn(async () => {});
    render(<SyncConflictDialog conflict={conflict({ tasks: 1 }, {})} onChoose={onChoose} />);

    fireEvent.click(screen.getByText('Оставить мои данные'));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('local'));

    fireEvent.click(screen.getByText('Загрузить серверную'));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('server'));
  });

  it('на время сохранения блокирует обе кнопки', async () => {
    let finish;
    const onChoose = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<SyncConflictDialog conflict={conflict()} onChoose={onChoose} />);

    fireEvent.click(screen.getByText('Оставить мои данные'));

    const local = screen.getByText('Оставить мои данные');
    const server = screen.getByText('Загрузить серверную');
    await waitFor(() => expect(local.disabled).toBe(true));
    expect(server.disabled).toBe(true);

    finish();
    await waitFor(() => expect(local.disabled).toBe(false));
    expect(server.disabled).toBe(false);
  });

  it('ошибку сервера показывает сообщением и разрешает повторить', async () => {
    const onChoose = vi.fn(async () => { throw new Error('Нет связи с сервером'); });
    render(<SyncConflictDialog conflict={conflict()} onChoose={onChoose} />);

    fireEvent.click(screen.getByText('Оставить мои данные'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Нет связи с сервером');
    expect(screen.getByText('Оставить мои данные').disabled).toBe(false);
  });

  it('Escape не закрывает диалог: выбор обязателен', () => {
    const onChoose = vi.fn();
    render(<SyncConflictDialog conflict={conflict()} onChoose={onChoose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('при открытии фокус уходит в диалог', () => {
    render(<SyncConflictDialog conflict={conflict()} onChoose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
