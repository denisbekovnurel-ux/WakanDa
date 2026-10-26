import type { ApiError } from '../types';

const API = '/api';

/** Заголовок авторизации; пустой объект вместо `Authorization: undefined`. */
export function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiUrl(path: string): string {
  return `${API}${path}`;
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // тело может быть пустым — это нормально
    return null;
  }
}

/**
 * Единая проверка ответа API: понятная ошибка с HTTP-статусом и телом.
 * Тело нужно для 409-конфликтов синхронизации и сообщений сервера.
 */
export async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await readBody(response);
  if (!response.ok) {
    const error = new Error(errorMessage(data, `${fallbackMessage} (${response.status})`)) as ApiError;
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data as T;
}
