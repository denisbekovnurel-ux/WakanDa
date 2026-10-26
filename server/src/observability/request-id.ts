import { randomUUID } from 'node:crypto';

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** Пропускает только безопасный внешний request id, иначе генерирует новый. */
export function sanitizeRequestId(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return REQUEST_ID_RE.test(trimmed) ? trimmed : null;
}

export function newRequestId(): string {
  return randomUUID();
}
