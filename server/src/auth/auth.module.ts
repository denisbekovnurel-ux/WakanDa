import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AuthService } from './auth.service';
import { AdminGuard, AuthGuard } from './auth.guard';

@Module({
  // Базовый лимит ThrottlerModule задаётся глобально в AppModule; здесь login и
  // register ужесточаются точечно через @Throttle.
  controllers: [AuthController, AdminController],
  providers: [AuthService, AuthGuard, AdminGuard],
  exports: [AuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
