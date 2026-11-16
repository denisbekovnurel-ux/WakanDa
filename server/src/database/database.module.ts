import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [DatabaseService, SettingsService],
  exports: [DatabaseService, SettingsService],
})
export class DatabaseModule {}
