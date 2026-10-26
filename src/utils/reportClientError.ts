type ClientErrorSource = 'react' | 'window' | 'unhandledrejection';

type ClientErrorContext = {
  componentStack?: string;
  source?: ClientErrorSource;
};

const recent = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5000;
const MAX_TRACKED = 50;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  recent.set(key, now);
  if (recent.size > MAX_TRACKED) {
    for (const [entry, at] of recent) {
      if (now - at >= DEDUPE_WINDOW_MS) recent.delete(entry);
    }
  }
  return true;
}

/**
 * Отправляет короткий технический отчёт на свой сервер. Работает только в
 * production-сборке: в dev/test ошибки остаются в консоли и не создают шум.
 * Токены, тело запросов и query-строка намеренно не отправляются.
 */
export function reportClientError(error: unknown, context: ClientErrorContext = {}): void {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;

  const message = messageOf(error).slice(0, 1000);
  const stack = error instanceof Error ? error.stack?.slice(0, 4000) : undefined;
  if (!shouldSend(`${message}\n${stack ?? ''}`)) return;

  const payload = {
    message,
    ...(stack ? { stack } : {}),
    ...(context.componentStack ? { componentStack: context.componentStack.slice(0, 4000) } : {}),
    source: context.source ?? 'window',
    url: window.location.pathname.slice(0, 512),
    release: import.meta.env.VITE_RELEASE || undefined,
  };

  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {
      // Приёмник недоступен — не превращаем это в новую ошибку.
    });
  } catch {
    // fetch может быть недоступен в старых WebView; отчёт не критичен.
  }
}

let installed = false;

/** Глобальные ошибки вне React-дерева: обработчики событий, промисы, chunk load. */
export function installGlobalErrorReporting(): void {
  if (!import.meta.env.PROD || installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    reportClientError(event.error ?? event.message, { source: 'window' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, { source: 'unhandledrejection' });
  });
}
