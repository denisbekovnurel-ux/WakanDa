import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { userOrIpTracker } from '../security/rate-limit';
import { CreateReminderInput, RemindersService } from './reminders.service';

@Controller('reminders')
@UseGuards(AuthGuard, ThrottlerGuard)
export class RemindersController {
  constructor(@Inject(RemindersService) private readonly reminders: RemindersService) {}

  private ensureApproved(req: AuthedRequest) {
    if (req.user?.status !== 'approved') {
      throw new ForbiddenException('Напоминания доступны после одобрения администратором');
    }
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    this.ensureApproved(req);
    return { reminders: this.reminders.list(req.user!.id) };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateReminderInput) {
    this.ensureApproved(req);
    return { reminder: this.reminders.create(req.user!.id, body ?? {}) };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000, getTracker: userOrIpTracker } })
  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.ensureApproved(req);
    return this.reminders.remove(req.user!.id, id);
  }
}
