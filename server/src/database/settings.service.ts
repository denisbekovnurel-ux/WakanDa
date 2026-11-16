import { Inject, Injectable } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DatabaseService } from './database.service';

/**
 * Единственный владелец таблицы `settings`.
 *
 * Раньше auth/push/telegram/state читали и писали её напрямую своим SQL. Из-за
 * этого формат ключей и SQL дублировались, а изменение схемы лежало в пяти
 * местах. Теперь доменные сервисы просят значение через get/set, а SQL живёт
 * только здесь.
 */
@Injectable()
export class SettingsService {
  private readonly db: Database.Database;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
  }

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  getBoolean(key: string): boolean {
    return this.get(key) === '1';
  }

  getNumber(key: string, fallback = 0): number {
    const value = Number(this.get(key));
    return Number.isFinite(value) ? value : fallback;
  }
}
