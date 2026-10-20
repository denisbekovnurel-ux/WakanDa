import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { StateModule } from './state/state.module';
import { AuthModule } from './auth/auth.module';
import { PushModule } from './push/push.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Throttler нужен не только auth: лимиты на запись состояния и push живут
    // в других модулях, поэтому регистрируем его глобально (хранилище одно).
    { ...ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]), global: true },
    DatabaseModule,
    StateModule,
    AuthModule,
    PushModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
