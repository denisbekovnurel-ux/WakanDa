import { Controller, Get, Inject, Res } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { PushService } from './push/push.service';

type HealthResponse = { status(code: number): unknown };

/**
 * Лёгкая проверка живости для хостинга/мониторинга: отвечает, доступна ли БД
 * и жив ли планировщик напоминаний. При недоступной БД отдаём 503, чтобы
 * внешний мониторинг видел проблему по HTTP-статусу, а не только по телу.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  @Get()
  check(@Res({ passthrough: true }) response: HealthResponse) {
    const database = this.database.ping() ? 'ok' : 'error';
    if (database !== 'ok') response.status(503);
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      scheduler: this.push.schedulerStatus(),
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
