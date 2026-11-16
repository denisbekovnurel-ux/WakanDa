import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AdminGuard, AuthGuard } from './auth.guard';
import { userOrIpTracker } from '../security/rate-limit';

// Админ-эндпоинты раньше вообще не троттлились. Guard + лимиты ниже защищают
// от перебора действий при скомпрометированной/утекшей админ-сессии.
@Controller('admin')
@UseGuards(AuthGuard, AdminGuard, ThrottlerGuard)
export class AdminController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('users')
  users() {
    return { users: this.auth.listUsers(), stats: this.auth.stats() };
  }

  @Post('users/:id/approve')
  approve(@Param('id') id: string) {
    return { user: this.auth.setStatus(id, 'approved') };
  }

  @Post('users/:id/block')
  block(@Param('id') id: string) {
    return { user: this.auth.setStatus(id, 'blocked') };
  }

  @Post('users/:id/unblock')
  unblock(@Param('id') id: string) {
    return { user: this.auth.setStatus(id, 'approved') };
  }

  @Post('users/:id/kick')
  kick(@Param('id') id: string) {
    return this.auth.kick(id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post('users/:id/password')
  resetPassword(@Param('id') id: string, @Body() body: { password?: unknown }) {
    return this.auth.resetPassword(id, body?.password);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000, getTracker: userOrIpTracker } })
  @Delete('users/:id')
  remove(@Param('id') id: string) {
    return this.auth.deleteUser(id);
  }
}
