import { Body, Controller, Delete, ForbiddenException, Get, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { TelegramService } from './telegram.service';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { userOrIpTracker } from '../security/rate-limit';

type LinkBody = { timezoneOffset?: unknown };

@Controller('telegram')
export class TelegramController {
  constructor(@Inject(TelegramService) private readonly telegram: TelegramService) {}

  private ensureApproved(req: AuthedRequest) {
    if (req.user?.status !== 'approved') {
      throw new ForbiddenException('Telegram-уведомления доступны после одобрения администратором');
    }
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Get('status')
  status(@Req() req: AuthedRequest) {
    return this.telegram.status(req.user!.id);
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post('link')
  link(@Req() req: AuthedRequest, @Body() body: LinkBody) {
    this.ensureApproved(req);
    return this.telegram.createLink(req.user!.id, body?.timezoneOffset);
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000, getTracker: userOrIpTracker } })
  @Delete('link')
  unlink(@Req() req: AuthedRequest) {
    this.ensureApproved(req);
    return this.telegram.unlink(req.user!.id);
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post('test')
  test(@Req() req: AuthedRequest) {
    this.ensureApproved(req);
    return this.telegram.sendTest(req.user!.id);
  }

  // Публичный endpoint для Telegram. Подлинность запроса подтверждает
  // secret_token из setWebhook, а не авторизация пользователя.
  @Post('webhook')
  webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
  ) {
    return this.telegram.handleWebhook(secret, body);
  }
}
