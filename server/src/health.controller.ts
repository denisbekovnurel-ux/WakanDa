import { Controller, Get, Inject } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

/**
 * Лёгкая проверка живости для хостинга/мониторинга: отвечает, доступна ли БД.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  check() {
    let database = 'ok';
    try {
      this.database.connection.prepare('SELECT 1').get();
    } catch {
      database = 'error';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
