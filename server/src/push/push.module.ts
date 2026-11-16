import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { AuthModule } from '../auth/auth.module';
import { RemindersModule } from '../reminders/reminders.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [AuthModule, TelegramModule, RemindersModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
