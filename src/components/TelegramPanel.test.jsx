// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramPanel } from './TelegramPanel';
import { FeedbackProvider, FeedbackViewport } from './Feedback';
import { createTelegramLink, fetchTelegramStatus, sendTestTelegram, unlinkTelegram } from '../api/telegramApi';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ token: 'token-1' }),
}));

vi.mock('../api/telegramApi', () => ({
  createTelegramLink: vi.fn(),
  fetchTelegramStatus: vi.fn(),
  sendTestTelegram: vi.fn(),
  unlinkTelegram: vi.fn(),
}));

const OFF = { configured: false, botUsername: null, linked: false, telegramUsername: null, linkedAt: null, webhookReady: false };
const READY = { configured: true, botUsername: 'wakanda_bot', linked: false, telegramUsername: null, linkedAt: null, webhookReady: true };
const LINKED = { ...READY, linked: true, telegramUsername: 'tester', linkedAt: new Date().toISOString() };

function renderPanel() {
  return render(
    <FeedbackProvider>
      <TelegramPanel />
      <FeedbackViewport />
    </FeedbackProvider>,
  );
}

beforeEach(() => {
  vi.mocked(createTelegramLink).mockReset();
  vi.mocked(fetchTelegramStatus).mockReset();
  vi.mocked(sendTestTelegram).mockReset();
  vi.mocked(unlinkTelegram).mockReset();
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TelegramPanel', () => {
  it('не показывается, пока бот не настроен на сервере', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue(OFF);
    const { container } = renderPanel();

    await waitFor(() => expect(fetchTelegramStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(screen.queryByText('Подключить Telegram')).toBeNull();
  });

  it('даёт получить ссылку и открывает чат', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue(READY);
    vi.mocked(createTelegramLink).mockResolvedValue({
      code: 'abc123',
      deepLink: 'https://t.me/wakanda_bot?start=abc123',
      botUsername: 'wakanda_bot',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    renderPanel();
    fireEvent.click(await screen.findByText('Подключить Telegram'));

    await waitFor(() => expect(createTelegramLink).toHaveBeenCalled());
    // Смещение передаём в минутах к востоку от UTC — его ждёт сервер.
    expect(vi.mocked(createTelegramLink).mock.calls[0][1]).toBeTypeOf('number');
    expect(window.open).toHaveBeenCalledWith('https://t.me/wakanda_bot?start=abc123', '_blank', 'noopener,noreferrer');
    expect(await screen.findByText('abc123')).toBeTruthy();
    expect(screen.queryByText('Подключить Telegram')).toBeNull();
  });

  it('показывает привязанный чат и отвязывает после подтверждения', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(unlinkTelegram).mockResolvedValue({ removed: 1 });

    renderPanel();
    const state = await screen.findByText(/Telegram подключён/);
    expect(state.textContent).toContain('@tester');

    fireEvent.click(screen.getByText('Отключить Telegram'));
    fireEvent.click(await screen.findByText('Отключить', { selector: 'button' }));

    await waitFor(() => expect(unlinkTelegram).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Telegram подключён/)).toBeNull());
  });

  it('отправляет тестовое сообщение в чат', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(sendTestTelegram).mockResolvedValue({ sent: true });

    renderPanel();
    fireEvent.click(await screen.findByText('Проверить сообщение'));

    await waitFor(() => expect(sendTestTelegram).toHaveBeenCalledWith('token-1'));
  });

  it('предупреждает, если сервер не получает ответы бота', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue({ ...READY, webhookReady: false });

    renderPanel();

    expect(await screen.findByText(/не получает ответы бота/)).toBeTruthy();
  });
});
