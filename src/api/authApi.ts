import type { AdminStats, User } from '../types';
import { apiUrl, authHeaders, parseResponse } from './client';

export interface AuthResponse {
  token: string;
  user: User;
}

export interface AdminUsersResponse {
  users: User[];
  stats: AdminStats;
}

export type AdminUserAction = 'approve' | 'block' | 'unblock';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  token?: string;
  body?: unknown;
}

async function request<T>(path: string, { method = 'GET', token, body }: RequestOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(token),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseResponse<T>(response, 'Ошибка запроса');
}

export function apiRegister(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } });
}

export function apiLogin(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } });
}

export function apiMe(token: string): Promise<{ user: User }> {
  return request<{ user: User }>('/auth/me', { token });
}

export function apiHeartbeat(token: string): Promise<unknown> {
  return request('/auth/heartbeat', { method: 'POST', token });
}

export function apiLogout(token: string): Promise<unknown> {
  return request('/auth/logout', { method: 'POST', token });
}

export function apiLogoutEverywhere(token: string): Promise<{ sessionsRemoved: number }> {
  return request<{ sessionsRemoved: number }>('/auth/logout-everywhere', { method: 'POST', token });
}

export function apiChangePassword(token: string, currentPassword: string, newPassword: string): Promise<unknown> {
  return request('/auth/password', { method: 'POST', token, body: { currentPassword, newPassword } });
}

export function apiAdminUsers(token: string): Promise<AdminUsersResponse> {
  return request<AdminUsersResponse>('/admin/users', { token });
}

export function apiAdminSetStatus(token: string, id: string, action: AdminUserAction): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/${action}`, { method: 'POST', token });
}

export function apiAdminKick(token: string, id: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/kick`, { method: 'POST', token });
}

export function apiAdminResetPassword(token: string, id: string, password: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}/password`, { method: 'POST', token, body: { password } });
}

export function apiAdminDeleteUser(token: string, id: string): Promise<unknown> {
  return request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}
