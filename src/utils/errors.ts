import type { ApiError } from '../types';
import { translate } from '../i18n';

/** Сужает неизвестную ошибку до ApiError, не теряя исходный объект. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error;
}

/** Текст ошибки для интерфейса: сообщение сервера или понятный fallback. */
export function errorMessage(error: unknown, fallback = 'Не удалось выполнить действие'): string {
  if (error instanceof Error && error.message) return translate(error.message);
  return translate(fallback);
}
