import type { LoggerService } from '@nestjs/common';
import { logger } from './logger';

type Level = 'info' | 'error' | 'warn' | 'debug';

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Переводит стандартный Nest Logger на тот же JSON-поток, что и остальное
 * приложение. Контекст Nest передаёт последним строковым аргументом.
 */
export class NestPinoLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  private write(level: Level, message: unknown, optionalParams: unknown[]): void {
    const params = [...optionalParams];
    const context = typeof params.at(-1) === 'string' ? String(params.pop()) : undefined;
    const details = params.length ? params : undefined;

    if (message instanceof Error) {
      logger[level]({ err: message, context, details }, message.message);
      return;
    }
    logger[level]({ context, details }, asText(message));
  }
}
