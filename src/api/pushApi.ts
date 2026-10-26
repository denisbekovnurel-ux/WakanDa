import { apiUrl, authHeaders, parseResponse } from './client';

export interface PushKeyResponse {
  publicKey?: string;
}

export interface PushTestResult {
  sent?: number;
  failed?: number;
}

interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh: string;
    auth: string;
  };
}

export async function fetchPushKey(): Promise<PushKeyResponse> {
  const response = await fetch(apiUrl('/push/key'));
  return parseResponse<PushKeyResponse>(response, 'Не удалось получить ключ уведомлений');
}

export async function subscribePush(
  token: string,
  subscription: PushSubscriptionPayload,
  timezoneOffset: number,
  deviceId: string,
): Promise<unknown> {
  const response = await fetch(apiUrl('/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ subscription, timezoneOffset, deviceId }),
  });
  return parseResponse(response, 'Не удалось оформить подписку на уведомления');
}

export async function unsubscribePush(token: string, endpoint: string): Promise<unknown> {
  const response = await fetch(apiUrl('/push/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ endpoint }),
  });
  return parseResponse(response, 'Не удалось отменить подписку на уведомления');
}

export async function fetchPushStatus(token: string): Promise<unknown> {
  const response = await fetch(apiUrl('/push/status'), { headers: authHeaders(token) });
  return parseResponse(response, 'Не удалось получить состояние уведомлений');
}

export async function sendTestPush(token: string): Promise<PushTestResult> {
  const response = await fetch(apiUrl('/push/test'), { method: 'POST', headers: authHeaders(token) });
  return parseResponse<PushTestResult>(response, 'Не удалось отправить тестовое уведомление');
}
