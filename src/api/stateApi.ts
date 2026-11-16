import type { AppState, ServerStateResponse, StatusHistoryItem } from '../types';
import { DEFAULT_REMINDER_TIMES } from '../utils/schema';
import { apiUrl, authHeaders, parseResponse } from './client';

export interface SavedStateResponse {
  revision?: number;
  savedAt?: string;
  updatedAt?: string;
}

export interface StateHistoryResponse {
  history: StatusHistoryItem[];
}

export interface RestoreStateResponse {
  state: unknown;
  updatedAt?: string | null;
  restoredAt?: string | null;
  revision?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fetchServerState(token: string): Promise<ServerStateResponse> {
  const response = await fetch(apiUrl('/state'), { headers: authHeaders(token) });
  const data = await parseResponse<unknown>(response, 'Не удалось загрузить данные');
  // Новый формат — { state, updatedAt, revision }. Старый (просто состояние)
  // тоже поддерживаем: revision 0, обновление произойдёт при первой записи.
  if (isRecord(data) && 'state' in data) {
    return {
      state: data.state,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      revision: typeof data.revision === 'number' && Number.isInteger(data.revision) ? data.revision : 0,
    };
  }
  return { state: data, updatedAt: null, revision: 0 };
}

export async function saveServerState(token: string, state: AppState, baseRevision?: number | null): Promise<SavedStateResponse> {
  const response = await fetch(apiUrl('/state'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({
      state,
      baseRevision: Number.isInteger(baseRevision) ? baseRevision : null,
    }),
  });
  return parseResponse<SavedStateResponse>(response, 'Не удалось сохранить данные');
}

export async function fetchStateHistory(token: string): Promise<StateHistoryResponse> {
  const response = await fetch(apiUrl('/state/history'), { headers: authHeaders(token) });
  return parseResponse<StateHistoryResponse>(response, 'Не удалось загрузить историю');
}

export async function restoreStateSnapshot(token: string, id: string): Promise<RestoreStateResponse> {
  const response = await fetch(apiUrl(`/state/history/${encodeURIComponent(id)}/restore`), {
    method: 'POST',
    headers: authHeaders(token),
  });
  return parseResponse<RestoreStateResponse>(response, 'Не удалось восстановить снимок');
}

export async function createStateSnapshot(token: string, reason = 'manual'): Promise<{ created?: boolean }> {
  const response = await fetch(apiUrl('/state/snapshot'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ reason }),
  });
  return parseResponse<{ created?: boolean }>(response, 'Не удалось создать снимок');
}

export function isEmptyAppState(state: AppState | null | undefined): boolean {
  if (!state) return true;
  // «Пусто» — это действительно состояние по умолчанию, а не «нет задач».
  // Иначе аккаунт с одними настройками (тема/напоминание) считался бы пустым
  // и его настройки затирались бы при первом входе с другого устройства.
  const reminderTimes = Array.isArray(state.reminderTimes) ? state.reminderTimes : [];
  return (
    !state.tasks.length &&
    !state.oneOffTasks.length &&
    Object.keys(state.notes).length === 0 &&
    state.theme === 'dark' &&
    reminderTimes.length === DEFAULT_REMINDER_TIMES.length &&
    reminderTimes.every((time, index) => time === DEFAULT_REMINDER_TIMES[index]) &&
    !state.reminderEnabled &&
    !state.lastAutoBackupAt
  );
}
