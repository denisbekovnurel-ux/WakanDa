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
    throw error;
  }
  return data;
}

export async function fetchServerState(token) {
  const response = await fetch(`${API}/state`, { headers: authHeaders(token) });
  const data = await parse(response, 'Не удалось загрузить данные');
  // Новый формат — { state, updatedAt }. Старый (просто состояние) тоже поддерживаем.
  if (data && typeof data === 'object' && 'state' in data) return data;
  return { state: data, updatedAt: null };
}

export async function saveServerState(token, state) {
  const response = await fetch(`${API}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(state),
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
  return !state.tasks.length && !state.oneOffTasks.length && !state.goals.length && Object.keys(state.notes).length === 0;
}
