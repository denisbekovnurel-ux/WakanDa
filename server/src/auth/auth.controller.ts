import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthGuard, AuthedRequest } from './auth.guard';

type CredentialsBody = { username?: unknown; password?: unknown };

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
  login(@Body() body: CredentialsBody) {
    return this.auth.login(body?.username, body?.password);
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
}
