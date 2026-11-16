// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemindersPanel } from './RemindersPanel';
import { FeedbackProvider, FeedbackViewport } from './Feedback';
import { createReminder, deleteReminder, fetchReminders } from '../api/remindersApi';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ token: 'token-1' }),
}));

vi.mock('../api/remindersApi', () => ({
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  fetchReminders: vi.fn(),
}));

function renderPanel() {
  return render(
    <FeedbackProvider>
      <RemindersPanel />
      <FeedbackViewport />
    </FeedbackProvider>,
  );
}

beforeEach(() => {
  vi.mocked(createReminder).mockReset();
  vi.mocked(deleteReminder).mockReset();
  vi.mocked(fetchReminders).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RemindersPanel', () => {
  it('загружает список и создаёт напоминание на выбранные дату и время', async () => {
    vi.mocked(fetchReminders).mockResolvedValue([]);
    vi.mocked(createReminder).mockResolvedValue({
      id: 'rem-1',
      text: 'позвонить маме',
      dueAt: '2030-10-01T18:00:00.000Z',
    });

    renderPanel();
    await waitFor(() => expect(fetchReminders).toHaveBeenCalledWith('token-1'));
    expect(await screen.findByText('Пока пусто. Добавь первое напоминание.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Что напомнить/), { target: { value: 'позвонить маме' } });
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2030-10-01' } });
    fireEvent.change(screen.getByLabelText('Время'), { target: { value: '21:00' } });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => expect(createReminder).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReminder).mock.calls[0][1]).toMatchObject({
      text: 'позвонить маме',
      date: '2030-10-01',
      time: '21:00',
    });
    expect(await screen.findByText('позвонить маме')).toBeTruthy();
  });

  it('удаляет напоминание после подтверждения', async () => {
    vi.mocked(fetchReminders).mockResolvedValue([
      { id: 'rem-1', text: 'проверить отчёт', dueAt: '2030-10-01T18:00:00.000Z' },
    ]);
    vi.mocked(deleteReminder).mockResolvedValue({ removed: 1 });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Удалить напоминание/ }));
    fireEvent.click(await screen.findByText('Удалить', { selector: 'button' }));

    await waitFor(() => expect(deleteReminder).toHaveBeenCalledWith('token-1', 'rem-1'));
    await waitFor(() => expect(screen.queryByText('проверить отчёт')).toBeNull());
  });
});
