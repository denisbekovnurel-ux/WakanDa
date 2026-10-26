const API = '/api';

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parse(response, fallbackMessage) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    // тело может быть пустым — это нормально
  }
  if (!response.ok) {
    const error = new Error(data?.message || `${fallbackMessage} (${response.status})`);
    error.status = response.status;
    // 409 присылает актуальное серверное состояние и revision — без этого
    // клиент не сможет показать конфликт и разрешить его.
    error.data = data;
    throw error;
  }
  return data;
}

export async function fetchServerState(token) {
  const response = await fetch(`${API}/state`, { headers: authHeaders(token) });
  const data = await parse(response, 'Не удалось загрузить данные');
  // Новый формат — { state, updatedAt, revision }. Старый (просто состояние)
  // тоже поддерживаем: revision 0, обновление произойдёт при первой записи.
  if (data && typeof data === 'object' && 'state' in data) {
    return {
      state: data.state,
      updatedAt: data.updatedAt ?? null,
      revision: Number.isInteger(data.revision) ? data.revision : 0,
    };
  }
  return { state: data, updatedAt: null, revision: 0 };
}

export async function saveServerState(token, state, baseRevision) {
  const response = await fetch(`${API}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({
      state,
      baseRevision: Number.isInteger(baseRevision) ? baseRevision : null,
    }),
  });
  return parse(response, 'Не удалось сохранить данные');
}

export async function fetchStateHistory(token) {
  const response = await fetch(`${API}/state/history`, { headers: authHeaders(token) });
  return parse(response, 'Не удалось загрузить историю');
}

export async function restoreStateSnapshot(token, id) {
  const response = await fetch(`${API}/state/history/${id}/restore`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return parse(response, 'Не удалось восстановить снимок');
}

export async function createStateSnapshot(token, reason = 'manual') {
  const response = await fetch(`${API}/state/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ reason }),
  });
  return parse(response, 'Не удалось создать снимок');
}

export function isEmptyAppState(state) {
  if (!state) return true;
  // «Пусто» — это действительно состояние по умолчанию, а не «нет задач».
  // Иначе аккаунт с одними настройками (тема/напоминание) считался бы пустым
  // и его настройки затирались бы при первом входе с другого устройства.
  return (
    !state.tasks.length &&
    !state.oneOffTasks.length &&
    Object.keys(state.notes).length === 0 &&
    state.theme === 'system' &&
    state.reminderTime === '20:00' &&
    !state.reminderEnabled &&
    !state.lastAutoBackupAt
  );
}
