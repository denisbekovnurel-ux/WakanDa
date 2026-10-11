import { Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AdminGuard, AuthGuard } from './auth.guard';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
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

  @Delete('users/:id')
  remove(@Param('id') id: string) {
    return this.auth.deleteUser(id);
  }
}
