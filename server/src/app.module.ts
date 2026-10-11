import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { StateModule } from './state/state.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, StateModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
