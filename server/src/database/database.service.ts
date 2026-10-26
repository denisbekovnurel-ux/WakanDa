import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Единственное подключение к SQLite для всего приложения.
 * Раньше AuthService и StateService открывали одно и то же файл-соединение
 * по отдельности — теперь оно общее, а таблицы создаются в одном месте.
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
    this.createTables();
    this.migrateColumns();
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

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        approved_at TEXT,
        last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT,
        schedule TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS habit_history (
        habit_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (habit_id, date_key),
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_habit_history_habit ON habit_history(habit_id);
      CREATE TABLE IF NOT EXISTS one_off_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        deadline TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS notes (
        date_key TEXT PRIMARY KEY,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_state (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        timezone_offset INTEGER NOT NULL DEFAULT 0,
        device_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
      CREATE TABLE IF NOT EXISTS push_log (
        user_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (user_id, date_key)
      );
      CREATE TABLE IF NOT EXISTS user_state_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        data TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_state_history_user ON user_state_history(user_id, id);
    `);
  }

  /** Добавляет колонки, появившиеся после первого релиза, не теряя данные. */
  private migrateColumns() {
    const addColumn = (table: string, column: string, definition: string) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (columns.some((entry) => entry.name === column)) return;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn('user_state', 'revision', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('push_subscriptions', 'device_id', 'TEXT');
  }
}
