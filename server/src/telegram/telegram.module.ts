import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RemindersModule } from '../reminders/reminders.module';
import { StateModule } from '../state/state.module';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AuthModule, RemindersModule, StateModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
