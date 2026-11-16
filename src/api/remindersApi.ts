import { apiUrl, authHeaders, parseResponse } from './client';

export interface Reminder {
  id: string;
  text: string;
  /** ISO-время в UTC: браузер покажет его в локальном часовом поясе. */
  dueAt: string;
  timezoneOffset?: number;
  createdAt?: string;
  sentAt?: string | null;
}

export interface CreateReminderPayload {
  text: string;
  /** Локальная дата в формате ГГГГ-ММ-ДД. */
  date: string;
  /** Локальное время в формате ЧЧ:ММ. */
  time: string;
  timezoneOffset: number;
}

export async function fetchReminders(token: string): Promise<Reminder[]> {
  const response = await fetch(apiUrl('/reminders'), { headers: authHeaders(token) });
  const data = await parseResponse<{ reminders?: Reminder[] }>(response, 'Не удалось получить напоминания');
  return Array.isArray(data.reminders) ? data.reminders : [];
}

export async function createReminder(token: string, payload: CreateReminderPayload): Promise<Reminder> {
  const response = await fetch(apiUrl('/reminders'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse<{ reminder: Reminder }>(response, 'Не удалось создать напоминание');
  return data.reminder;
}

export async function deleteReminder(token: string, id: string): Promise<{ removed?: number }> {
  const response = await fetch(apiUrl(`/reminders/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return parseResponse<{ removed?: number }>(response, 'Не удалось удалить напоминание');
}
