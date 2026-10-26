import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { logger } from './logger';
import { sanitizeClientError } from './client-error';

type RequestLike = {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
};

@Controller('client-errors')
export class ClientErrorsController {
  /**
   * Клиентские ошибки пишутся в тот же JSON-поток, что и серверные. Эндпоинт
   * без авторизации, поэтому жёстко ограничен по частоте и размеру полей.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  report(@Body() body: unknown, @Req() request: RequestLike) {
    const report = sanitizeClientError(body);
    if (!report) throw new BadRequestException('Некорректный отчёт об ошибке');
    const userAgent = request.headers['user-agent'];
    logger.error(
      {
        clientError: report,
        requestId: request.id,
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      },
      'client error reported',
    );
    return { ok: true };
  }
}
