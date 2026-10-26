import type Database from 'better-sqlite3';

/**
 * Версионируемые миграции схемы SQLite.
 *
 * Раньше схема правилась «на месте»: `CREATE TABLE IF NOT EXISTS` + проверки
 * `PRAGMA table_info` при каждом запуске. Пока колонок было две, это работало,
 * но не давало ни истории изменений, ни гарантии, что миграция применится
 * ровно один раз, ни возможности откатить неудачную.
 *
 * Теперь у каждой миграции есть номер и имя, а факт применения хранится в
 * таблице `schema_migrations`. Миграции выполняются по возрастанию версии,
 * каждая — в своей транзакции: если шаг упал, он не записывается как
 * применённый, и база остаётся в предыдущем состоянии.
 */

export const MIGRATIONS_TABLE = 'schema_migrations';

export type Migration = {
  /** Положительный целый номер. Порядок применения — по возрастанию. */
  version: number;
  /** Короткое описание для истории и логов. */
  name: string;
  up: (db: Database.Database) => void;
};

/**
 * Версия 1 — схема первого релиза. Она специально НЕ содержит колонок,
 * добавленных позже (`user_state.revision`, `push_subscriptions.device_id`):
 * так новая база проходит тот же путь миграций, что и старая, и этот путь
 * проверяется на каждом запуске.
 */
const BASELINE_SQL = `
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
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    timezone_offset INTEGER NOT NULL DEFAULT 0,
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
`;

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'baseline',
    up: (db) => {
      db.exec(BASELINE_SQL);
    },
  },
  {
    version: 2,
    name: 'user_state_revision',
    up: (db) => {
      addColumnIfMissing(db, 'user_state', 'revision', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 3,
    name: 'push_subscriptions_device_id',
    up: (db) => {
      addColumnIfMissing(db, 'push_subscriptions', 'device_id', 'TEXT');
    },
  },
];

/**
 * Применяет недостающие миграции и возвращает список применённых версий.
 * Идемпотентна: повторный вызов на той же базе ничего не делает.
 */
export function runMigrations(db: Database.Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const pending = preparePending(db, migrations);
  if (!pending.length) return [];

  const record = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`);
  const applied: number[] = [];

  for (const migration of pending) {
    // Миграция и отметка о ней должны попасть в базу вместе или не попасть вовсе.
    const apply = db.transaction(() => {
      migration.up(db);
      record.run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
    applied.push(migration.version);
  }

  return applied;
}

function preparePending(db: Database.Database, migrations: readonly Migration[]): Migration[] {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(`Некорректная версия миграции: ${migration.version}`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`Дубликат версии миграции: ${migration.version}`);
    }
    seen.add(migration.version);
  }

  const rows = db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE}`).all() as Array<{ version: number }>;
  const done = new Set(rows.map((row) => row.version));

  return [...migrations]
    .filter((migration) => !done.has(migration.version))
    .sort((left, right) => left.version - right.version);
}
