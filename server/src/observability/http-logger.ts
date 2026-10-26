import { logger } from './logger';
import { newRequestId, sanitizeRequestId } from './request-id';

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  id?: string;
  user?: { id?: string };
};

type ResponseLike = {
  statusCode: number;
  writableEnded?: boolean;
  setHeader(name: string, value: string): void;
  on(event: 'finish' | 'close', listener: () => void): void;
};

function pathOnly(value: string | undefined): string {
  if (!value) return '';
  const query = value.indexOf('?');
  return query === -1 ? value : value.slice(0, query);
}

/**
 * Логирует завершение каждого API-запроса и выдаёт X-Request-Id.
 * Query-строка и тело намеренно не попадают в лог: там могут быть секреты.
 */
export function requestLogger(request: unknown, response: unknown, next: () => void): void {
  const req = request as RequestLike;
  const res = response as ResponseLike;
  const requestId = sanitizeRequestId(req.headers['x-request-id']) ?? newRequestId();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  let logged = false;

  const write = (statusCode: number, aborted = false) => {
    if (logged) return;
    logged = true;
    const path = pathOnly(req.originalUrl ?? req.url);
    if (path === '/api/health') return;
    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const fields = {
      requestId,
      method: req.method,
      path,
      statusCode,
      durationMs,
      userId: req.user?.id,
      ...(aborted ? { aborted: true } : {}),
    };
    if (statusCode >= 500) logger.error(fields, 'request completed');
    else if (statusCode >= 400) logger.warn(fields, 'request completed');
    else logger.info(fields, 'request completed');
  };

  res.on('finish', () => write(res.statusCode));
  res.on('close', () => {
    if (!res.writableEnded) write(499, true);
  });
  next();
}
