const SOURCES = new Set(['react', 'window', 'unhandledrejection']);

export type ClientErrorReport = {
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  source: 'react' | 'window' | 'unhandledrejection';
  release?: string;
};

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

function pathOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, 'http://localhost').pathname.slice(0, 512) || '/';
  } catch {
    return value.split(/[?#]/)[0].slice(0, 512);
  }
}

/**
 * Принимает только короткий технический отчёт. Никаких токенов, localStorage,
 * тела запросов и query-строк: клиентский отчёт не должен превращаться в канал
 * утечки пользовательских данных.
 */
export function sanitizeClientError(input: unknown): ClientErrorReport | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const message = text(value.message, 1000);
  if (!message) return null;
  const source = typeof value.source === 'string' && SOURCES.has(value.source)
    ? (value.source as ClientErrorReport['source'])
    : 'window';
  const stack = text(value.stack, 4000);
  const componentStack = text(value.componentStack, 4000);
  const url = pathOnly(text(value.url, 2000));
  const release = text(value.release, 64);
  return {
    message,
    ...(stack ? { stack } : {}),
    ...(componentStack ? { componentStack } : {}),
    ...(url ? { url } : {}),
    source,
    ...(release ? { release } : {}),
  };
}
