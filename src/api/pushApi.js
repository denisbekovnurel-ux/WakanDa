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

export async function fetchPushKey() {
  const response = await fetch(`${API}/push/key`);
  return parse(response, 'Не удалось получить ключ уведомлений');
}

export async function subscribePush(token, subscription, timezoneOffset, deviceId) {
  const response = await fetch(`${API}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ subscription, timezoneOffset, deviceId }),
  });
  return parse(response, 'Не удалось оформить подписку на уведомления');
}

export async function unsubscribePush(token, endpoint) {
  const response = await fetch(`${API}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ endpoint }),
  });
  return parse(response, 'Не удалось отменить подписку на уведомления');
}

export async function fetchPushStatus(token) {
  const response = await fetch(`${API}/push/status`, { headers: authHeaders(token) });
  return parse(response, 'Не удалось получить состояние уведомлений');
}

export async function sendTestPush(token) {
  const response = await fetch(`${API}/push/test`, { method: 'POST', headers: authHeaders(token) });
  return parse(response, 'Не удалось отправить тестовое уведомление');
}
