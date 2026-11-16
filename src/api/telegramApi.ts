import { apiUrl, authHeaders, parseResponse } from './client';

export interface TelegramStatus {
  configured?: boolean;
  botUsername?: string | null;
  linked?: boolean;
  telegramUsername?: string | null;
  linkedAt?: string | null;
  /** Сервер получает сообщения бота (вебхук или опрос) — без этого привязка не сработает. */
  webhookReady?: boolean;
}

export interface TelegramLink {
  code?: string;
  deepLink?: string;
  botUsername?: string;
  expiresAt?: string;
}

export async function fetchTelegramStatus(token: string): Promise<TelegramStatus> {
  const response = await fetch(apiUrl('/telegram/status'), { headers: authHeaders(token) });
  return parseResponse<TelegramStatus>(response, 'Не удалось получить состояние Telegram');
}

export async function createTelegramLink(token: string, timezoneOffset: number): Promise<TelegramLink> {
  const response = await fetch(apiUrl('/telegram/link'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ timezoneOffset }),
  });
  return parseResponse<TelegramLink>(response, 'Не удалось получить ссылку для подключения');
}

export async function unlinkTelegram(token: string): Promise<{ removed?: number }> {
  const response = await fetch(apiUrl('/telegram/link'), { method: 'DELETE', headers: authHeaders(token) });
  return parseResponse<{ removed?: number }>(response, 'Не удалось отключить Telegram');
}

export async function sendTestTelegram(token: string): Promise<{ sent?: boolean }> {
  const response = await fetch(apiUrl('/telegram/test'), { method: 'POST', headers: authHeaders(token) });
  return parseResponse<{ sent?: boolean }>(response, 'Не удалось отправить тестовое сообщение');
}
