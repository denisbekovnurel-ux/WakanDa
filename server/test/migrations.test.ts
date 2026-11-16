import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { MIGRATIONS, MIGRATIONS_TABLE, runMigrations, type Migration } from '../src/database/migrations';

// Схема должна подниматься одинаково и на пустой базе, и на базе прошлой
// версии, и не применяться дважды. Эти тесты гоняют реальную SQLite.

const opened: DatabaseService[] = [];
const rawDbs: Database.Database[] = [];
const dirs: string[] = [];
const originalDataDir = process.env.WAKANDA_DATA_DIR;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wakanda-migrations-'));
  dirs.push(dir);
  return dir;
}

function open(dir: string): DatabaseService {
  process.env.WAKANDA_DATA_DIR = dir;
  const service = new DatabaseService();
  opened.push(service);
  return service;
}

function raw(dir: string): Database.Database {
  const db = new Database(join(dir, 'wakanda.db'));
  rawDbs.push(db);
  return db;
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((entry) => entry.name);
}

function appliedVersions(db: Database.Database): number[] {
  return (db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`).all() as Array<{ version: number }>).map((row) => row.version);
}

let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  for (const db of rawDbs.splice(0)) db.close();
  for (const service of opened.splice(0)) service.onModuleDestroy();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  consoleLog.mockRestore();
  process.env.WAKANDA_DATA_DIR = originalDataDir;
});

describe('миграции на новой базе', () => {
  it('применяет все версии по порядку и создаёт таблицы', () => {
    const service = open(tempDir());
    const db = service.connection;

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(columns(db, 'user_state')).toContain('revision');
    expect(columns(db, 'push_subscriptions')).toContain('device_id');
    expect(columns(db, 'push_log')).toContain('slot');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
    for (const table of [
      'users',
      'sessions',
      'settings',
      'user_state',
      'user_state_history',
      'push_subscriptions',
      'push_log',
      'telegram_links',
      'telegram_link_codes',
      'reminders',
    ]) {
      expect(tables, `нет таблицы ${table}`).toContain(table);
    }
  });

  it('повторный запуск не применяет миграции заново и не трогает данные', () => {
    const dir = tempDir();
    const first = open(dir);
    first.connection
      .prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('u1', 'alice', 'hash', 'user', 'approved', new Date().toISOString());
    first.connection.prepare('INSERT INTO user_state (user_id, data, updated_at, revision) VALUES (?, ?, ?, ?)').run('u1', '{"tasks":[]}', '2026-01-01T00:00:00.000Z', 5);
    const appliedAt = (first.connection.prepare(`SELECT version, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`).all() as Array<{ version: number; applied_at: string }>);
    first.onModuleDestroy();
    opened.splice(opened.indexOf(first), 1);

    const second = open(dir);

    expect(appliedVersions(second.connection)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(second.connection.prepare(`SELECT version, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version`).all()).toEqual(appliedAt);
    expect(second.connection.prepare('SELECT username FROM users WHERE id = ?').get('u1')).toEqual({ username: 'alice' });
    expect(second.connection.prepare('SELECT revision FROM user_state WHERE user_id = ?').get('u1')).toEqual({ revision: 5 });
  });

  it('делает резервную копию перед применением отложенной миграции', () => {
    const dir = tempDir();
    const first = open(dir);
    first.connection
      .prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('u1', 'alice', 'hash', 'user', 'approved', new Date().toISOString());
    // Имитируем базу, на которую пришла новая миграция.
    first.connection.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = 6`).run();
    first.onModuleDestroy();
    opened.splice(opened.indexOf(first), 1);

    const second = open(dir);
    const backups = readdirSync(join(dir, 'backups'));

    expect(backups.some((name) => name.startsWith('pre-migration-') && name.endsWith('.db'))).toBe(true);
    expect(second.connection.prepare('SELECT username FROM users WHERE id = ?').get('u1')).toEqual({ username: 'alice' });
    expect(appliedVersions(second.connection)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('миграции на базе прошлой версии', () => {
  it('добавляет новые колонки, сохраняет данные и отмечает применённые версии', () => {
    const dir = tempDir();
    const legacy = raw(dir);
    // Схема «до миграций»: без schema_migrations и без новых колонок.
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        approved_at TEXT,
        last_seen_at TEXT
      );
      CREATE TABLE user_state (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        timezone_offset INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    legacy.prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('u1', 'alice', 'hash', 'user', 'approved', '2026-01-01T00:00:00.000Z');
    legacy.prepare('INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, ?)').run('u1', '{"tasks":[]}', '2026-01-02T00:00:00.000Z');
    legacy.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 'https://push.example/1', 'key', 'secret', '2026-01-03T00:00:00.000Z');
    legacy.close();
    rawDbs.splice(rawDbs.indexOf(legacy), 1);

    const service = open(dir);

    expect(columns(service.connection, 'user_state')).toContain('revision');
    expect(columns(service.connection, 'push_subscriptions')).toContain('device_id');
    expect(columns(service.connection, 'push_log')).toContain('slot');
    expect(service.connection.prepare('SELECT revision, data FROM user_state WHERE user_id = ?').get('u1')).toEqual({ revision: 0, data: '{"tasks":[]}' });
    expect(service.connection.prepare('SELECT device_id FROM push_subscriptions WHERE user_id = ?').get('u1')).toEqual({ device_id: null });
    expect(service.connection.prepare('SELECT username FROM users WHERE id = ?').get('u1')).toEqual({ username: 'alice' });
    // Telegram-таблицы появляются и на старой базе: привязка — часть схемы.
    const tables = (service.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toContain('telegram_links');
    expect(tables).toContain('telegram_link_codes');
    expect(tables).toContain('reminders');
    expect(appliedVersions(service.connection)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('раннер миграций', () => {
  function memoryDb(): Database.Database {
    const db = new Database(':memory:');
    rawDbs.push(db);
    return db;
  }

  it('неудачная миграция откатывается и не отмечается как применённая', () => {
    const db = memoryDb();
    const bad: Migration = {
      version: 1,
      name: 'bad',
      up: (connection) => {
        connection.exec('CREATE TABLE should_rollback (id INTEGER)');
        throw new Error('boom');
      },
    };

    expect(() => runMigrations(db, [bad])).toThrow('boom');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).not.toContain('should_rollback');
    expect(appliedVersions(db)).toEqual([]);
  });

  it('после отката следующая попытка применяет исправленную миграцию', () => {
    const db = memoryDb();
    const bad: Migration = { version: 1, name: 'bad', up: () => { throw new Error('boom'); } };
    expect(() => runMigrations(db, [bad])).toThrow('boom');

    const good: Migration = { version: 1, name: 'good', up: (connection) => connection.exec('CREATE TABLE fixed (id INTEGER)') };
    expect(runMigrations(db, [good])).toEqual([1]);
    expect(appliedVersions(db)).toEqual([1]);
    expect(runMigrations(db, [good])).toEqual([]);
  });

  it('применяет версии по возрастанию, даже если в списке они перепутаны', () => {
    const db = memoryDb();
    const make = (version: number): Migration => ({
      version,
      name: `v${version}`,
      up: (connection) => connection.exec(`CREATE TABLE t${version} (id INTEGER)`),
    });

    expect(runMigrations(db, [make(3), make(1), make(2)])).toEqual([1, 2, 3]);
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
  });

  it('докатывает только новые версии', () => {
    const db = memoryDb();
    const make = (version: number): Migration => ({ version, name: `v${version}`, up: (connection) => connection.exec(`CREATE TABLE x${version} (id INTEGER)`) });

    runMigrations(db, [make(1), make(2)]);
    expect(runMigrations(db, [make(1), make(2), make(3), make(4)])).toEqual([3, 4]);
  });

  it('не принимает дубликаты и некорректные номера', () => {
    const db = memoryDb();
    const make = (version: number): Migration => ({ version, name: `v${version}`, up: () => {} });

    expect(() => runMigrations(db, [make(1), make(1)])).toThrow(/Дубликат/);
    expect(() => runMigrations(db, [make(0)])).toThrow(/Некорректная версия/);
    expect(() => runMigrations(db, [{ ...make(1), version: 1.5 }])).toThrow(/Некорректная версия/);
    expect(appliedVersions(db)).toEqual([]);
  });

  it('боевой список миграций корректен и уникален', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort((left, right) => left - right));
    expect(versions[0]).toBe(1);
  });
});
