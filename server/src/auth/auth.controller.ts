import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthGuard, AuthedRequest } from './auth.guard';
import { userOrIpTracker } from '../security/rate-limit';

type CredentialsBody = { username?: unknown; password?: unknown };

type LoginRequest = { ip?: string };

@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() body: CredentialsBody) {
    return this.auth.register(body?.username, body?.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() body: CredentialsBody, @Req() req: LoginRequest) {
    // IP нужен для блокировки перебора по логину+IP внутри отдельного сервиса.
    return this.auth.login(body?.username, body?.password, String(req.ip ?? 'unknown'));
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() req: AuthedRequest) {
    return { user: req.user };
  }

  @UseGuards(AuthGuard)
  @Post('heartbeat')
  heartbeat(@Req() req: AuthedRequest) {
    return { user: req.user, at: new Date().toISOString() };
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Req() req: AuthedRequest) {
    if (req.sessionToken) this.auth.logout(req.sessionToken);
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Post('logout-everywhere')
  logoutEverywhere(@Req() req: AuthedRequest) {
    return this.auth.logoutEverywhere(req.user!.id, req.sessionToken);
  }

  // Смена пароля требует текущий пароль и потому сама является мишенью для
  // подбора — ограничиваем по пользователю.
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post('password')
  password(@Req() req: AuthedRequest, @Body() body: { currentPassword?: unknown; newPassword?: unknown }) {
    return this.auth.changePassword(req.user!.id, req.sessionToken ?? '', body?.currentPassword, body?.newPassword);
  }
}
