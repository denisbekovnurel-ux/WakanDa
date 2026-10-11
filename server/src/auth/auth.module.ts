import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AuthService } from './auth.service';
import { AdminGuard, AuthGuard } from './auth.guard';

@Module({
  // Ограничение частоты запросов против брутфорса пароля. Базовый лимит мягкий
  // (heartbeat ходит раз в 45 секунд), а login/register ужесточаются точечно.
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AuthGuard, AdminGuard],
  exports: [AuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
