import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AppState, SnapshotReason, StateService } from './state.service';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { userOrIpTracker } from '../security/rate-limit';

type SnapshotBody = { reason?: unknown };

// Лимит на запись: автосохранение шлёт PUT после паузы в наборе, поэтому 30/мин
// с запасом покрывает обычную работу, но не позволяет заливать 2 МБ непрерывно.
@Controller('state')
@UseGuards(AuthGuard, ThrottlerGuard)
export class StateController {
  constructor(@Inject(StateService) private readonly state: StateService) {}

  private ensureApproved(req: AuthedRequest) {
    if (req.user?.status !== 'approved') {
      throw new ForbiddenException('Доступ к данным откроется после одобрения администратором');
    }
  }

  @Get()
  get(@Req() req: AuthedRequest) {
    this.ensureApproved(req);
    const isAdmin = req.user?.role === 'admin';
    const state = this.state.loadForUser(req.user!.id, isAdmin);
    return { state, updatedAt: this.state.updatedAtForUser(req.user!.id) };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000, getTracker: userOrIpTracker } })
  @Put()
  save(@Req() req: AuthedRequest, @Body() body: AppState) {
    this.ensureApproved(req);
    this.state.saveForUser(req.user!.id, body);
    return { ok: true, savedAt: new Date().toISOString() };
  }

  @Get('history')
  history(@Req() req: AuthedRequest) {
    this.ensureApproved(req);
    return { history: this.state.listHistory(req.user!.id) };
  }

  @Get('history/:id')
  historyEntry(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.ensureApproved(req);
    const { state, ...meta } = this.state.getHistory(req.user!.id, Number(id));
    return { ...meta, state };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post('history/:id/restore')
  restore(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.ensureApproved(req);
    return { state: this.state.restoreHistory(req.user!.id, Number(id)), restoredAt: new Date().toISOString() };
  }

  // Принудительный снимок текущего состояния — клиент вызывает перед импортом бэкапа.
  @Throttle({ default: { limit: 10, ttl: 60_000, getTracker: userOrIpTracker } })
  @Post('snapshot')
  snapshot(@Req() req: AuthedRequest, @Body() body: SnapshotBody) {
    this.ensureApproved(req);
    const reason: SnapshotReason = body?.reason === 'import' ? 'import' : 'manual';
    return this.state.snapshotNow(req.user!.id, reason);
  }
}
