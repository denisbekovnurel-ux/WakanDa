import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { logger } from './logger';

type RequestLike = {
  id?: string;
  method?: string;
  originalUrl?: string;
  url?: string;
  user?: { id?: string };
};

type ResponseLike = {
  status(code: number): { json(body: unknown): void };
};

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  // body-parser и другие middleware Express бросают ошибки с готовым status.
  const value = exception as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof value?.status === 'number' ? value.status : value?.statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500;
}

function safeBody(exception: unknown, status: number): unknown {
  // Наружу не отдаём текст внутренней ошибки и stack — только в лог.
  if (status >= 500) {
    return { statusCode: status, message: 'Внутренняя ошибка сервера' };
  }
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') return { statusCode: status, message: response };
    if (response && typeof response === 'object') return response;
  }
  return { statusCode: status, message: 'Ошибка запроса' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<ResponseLike>();
    const request = context.getRequest<RequestLike>();
    const status = statusOf(exception);

    if (status >= 500) {
      logger.error(
        {
          err: exception,
          requestId: request.id,
          method: request.method,
          path: (request.originalUrl ?? request.url ?? '').split('?')[0],
          userId: request.user?.id,
        },
        'unhandled exception',
      );
    }

    response.status(status).json(safeBody(exception, status));
  }
}
