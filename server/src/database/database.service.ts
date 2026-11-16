import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pendingMigrations, runMigrations } from './migrations';
import { logger } from '../observability/logger';

const BACKUP_RETENTION = 5;
const BACKUP_DIR = 'backups';

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
    const pending = pendingMigrations(this.db);
    if (pending.length) this.backupBeforeMigrations(pending);
    const applied = runMigrations(this.db);
    if (applied.length) {
      logger.info({ migrations: applied }, 'database migrations applied');
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

  /** Проверка готовности БД для health-эндпоинта без утечки SQL наружу. */
  ping(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Перед изменением схемы сохраняем снимок старой базы. Миграции и так
   * транзакционные, но backup страхует от логической ошибки в SQL: откатить
   * файл проще, чем восстанавливать данные вручную.
   *
   * VACUUM INTO умеет делать консистентную копию при включённом WAL; обычное
   * копирование файла без -wal могло бы дать битую базу.
   */
  private backupBeforeMigrations(pending: readonly { version: number }[]) {
    const hasSchema = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get();
    if (!hasSchema) return; // новая база: сохранять пока нечего

    const dir = join(this.dataDir, BACKUP_DIR);
    const file = join(
      dir,
      `pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.db`,
    );
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.db.prepare('VACUUM INTO ?').run(file);
      try {
        chmodSync(file, 0o600);
      } catch {
        // На Windows ACL всё равно managed ОС.
      }
      this.pruneBackups(dir);
      logger.info(
        { file, migrations: pending.map((migration) => migration.version) },
        'database backup created before migrations',
      );
    } catch (error) {
      // Не блокируем старт: миграции транзакционные, а бэкап мог не пройти
      // из-за прав/места. В логе останется явная причина.
      logger.error({ err: error, file }, 'failed to create pre-migration database backup');
    }
  }

  private pruneBackups(dir: string) {
    try {
      const files = readdirSync(dir)
        .filter((name) => name.startsWith('pre-migration-') && name.endsWith('.db'))
        .map((name) => {
          const path = join(dir, name);
          return { path, mtime: statSync(path).mtimeMs };
        })
        .sort((left, right) => right.mtime - left.mtime);
      for (const stale of files.slice(BACKUP_RETENTION)) {
        unlinkSync(stale.path);
      }
    } catch (error) {
      logger.warn({ err: error, dir }, 'failed to prune database backups');
    }
  }

  onModuleDestroy() {
    try {
      this.db.close();
    } catch {
      // Соединение уже могло быть закрыто — не мешаем завершению процесса.
    }
  }
}
