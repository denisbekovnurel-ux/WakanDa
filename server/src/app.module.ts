import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { StateModule } from './state/state.module';
import { AuthModule } from './auth/auth.module';
import { PushModule } from './push/push.module';
import { RemindersModule } from './reminders/reminders.module';
import { HealthController } from './health.controller';
import { ClientErrorsController } from './observability/client-errors.controller';

@Module({
  imports: [
    // Throttler нужен не только auth: лимиты на запись состояния и push живут
    // в других модулях, поэтому регистрируем его глобально (хранилище одно).
    { ...ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]), global: true },
    DatabaseModule,
    StateModule,
    AuthModule,
    PushModule,
    RemindersModule,
  ],
  controllers: [HealthController, ClientErrorsController],
})
export class AppModule {}
