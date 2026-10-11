import { Body, Controller, ForbiddenException, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';

@Controller('push')
export class PushController {
  constructor(@Inject(PushService) private readonly push: PushService) {}

  private ensureApproved(req: AuthedRequest) {
    if (req.user?.status !== 'approved') {
      throw new ForbiddenException('Уведомления доступны после одобрения администратором');
    }
  }

  // Публичный ключ нужен до подписки — это не секрет.
  @Get('key')
  key() {
    return { publicKey: this.push.publicKey() };
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req: AuthedRequest) {
    return { subscriptions: this.push.countForUser(req.user!.id) };
  }

  @UseGuards(AuthGuard)
  @Post('subscribe')
  subscribe(@Req() req: AuthedRequest, @Body() body: { subscription?: unknown; timezoneOffset?: unknown }) {
    this.ensureApproved(req);
    return this.push.subscribe(req.user!.id, body?.subscription, body?.timezoneOffset);
  }

  @UseGuards(AuthGuard)
  @Post('unsubscribe')
  unsubscribe(@Req() req: AuthedRequest, @Body() body: { endpoint?: unknown }) {
    return this.push.unsubscribe(req.user!.id, body?.endpoint);
  }

  @UseGuards(AuthGuard)
  @Post('test')
  test(@Req() req: AuthedRequest) {
    this.ensureApproved(req);
    return this.push.sendTest(req.user!.id);
  }
}
