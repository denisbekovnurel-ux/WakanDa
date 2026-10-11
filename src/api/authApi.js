const API = '/api';

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(token),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // тело может быть пустым — это нормально
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Ошибка запроса (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function apiRegister(username, password) {
  return request('/auth/register', { method: 'POST', body: { username, password } });
}

export function apiLogin(username, password) {
  return request('/auth/login', { method: 'POST', body: { username, password } });
}

export function apiMe(token) {
  return request('/auth/me', { token });
}

export function apiHeartbeat(token) {
  return request('/auth/heartbeat', { method: 'POST', token });
}

export function apiLogout(token) {
  return request('/auth/logout', { method: 'POST', token });
}

export function apiAdminUsers(token) {
  return request('/admin/users', { token });
}

export function apiAdminSetStatus(token, id, action) {
  return request(`/admin/users/${id}/${action}`, { method: 'POST', token });
}

export function apiAdminKick(token, id) {
  return request(`/admin/users/${id}/kick`, { method: 'POST', token });
}

export function apiAdminDeleteUser(token, id) {
  return request(`/admin/users/${id}`, { method: 'DELETE', token });
}
