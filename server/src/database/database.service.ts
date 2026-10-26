import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrations';

/**
 * Единственное подключение к SQLite для всего приложения.
 * Раньше AuthService и StateService открывали одно и то же файл-соединение
 * по отдельности — теперь оно общее, а схема поднимается миграциями
 * (см. ./migrations.ts) при старте.
 *
 * Каталог данных можно переопределить через WAKANDA_DATA_DIR (нужно для тестов,
 * чтобы e2e не трогал рабочую базу).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly dataDir: string;
  private readonly db: Database.Database;

  constructor() {
    const override = (process.env.WAKANDA_DATA_DIR || '').trim();
    this.dataDir = override ? resolve(override) : join(dirname(fileURLToPath(import.meta.url)), '../../data');
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const dbPath = join(this.dataDir, 'wakanda.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const applied = runMigrations(this.db);
    if (applied.length) {
      console.log(`WakanDa: применены миграции базы (${applied.join(', ')})`);
    }
    // На POSIX база — это личные данные пользователей. На Windows chmod
    // фактически не меняет ACL, но и не мешает запуску.
    try {
      chmodSync(this.dataDir, 0o700);
      chmodSync(dbPath, 0o600);
    } catch {
      // Правами могут управлять ОС/контейнер — не роняем приложение из-за этого.
    }
  }

  get connection(): Database.Database {
    return this.db;
  }

  onModuleDestroy() {
    try {
      this.db.close();
    } catch {
      // Соединение уже могло быть закрыто — не мешаем завершению процесса.
    }
  }
}
