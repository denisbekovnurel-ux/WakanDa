import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { DatabaseService } from '../src/database/database.service';

// AuthService — самая чувствительная к безопасности часть сервера: сессии,
// пароли, единственный администратор. Здесь проверяем реальную SQLite во
// временной папке, без моков базы.

type Entry = { auth: AuthService; database: DatabaseService; dir: string };
type AdminEnv = { user?: string; pass?: string; production?: boolean };

const opened: Entry[] = [];
const dirs: string[] = [];
const originalEnv = {
  dataDir: process.env.WAKANDA_DATA_DIR,
  adminUser: process.env.WAKANDA_ADMIN_USER,
  adminPass: process.env.WAKANDA_ADMIN_PASS,
  nodeEnv: process.env.NODE_ENV,
};

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wakanda-auth-'));
  dirs.push(dir);
  return dir;
}

function applyEnv({ user, pass, production }: AdminEnv) {
  delete process.env.WAKANDA_ADMIN_USER;
  delete process.env.WAKANDA_ADMIN_PASS;
  if (user) process.env.WAKANDA_ADMIN_USER = user;
  if (pass) process.env.WAKANDA_ADMIN_PASS = pass;
  if (production) process.env.NODE_ENV = 'production';
  else process.env.NODE_ENV = 'test';
}

function make(dir: string, env: AdminEnv = {}, initialize = true): Entry {
  process.env.WAKANDA_DATA_DIR = dir;
  applyEnv(env);
  const database = new DatabaseService();
  const auth = new AuthService(database);
  if (initialize) auth.onModuleInit();
  const entry = { auth, database, dir };
  opened.push(entry);
  return entry;
}

function close(entry: Entry) {
  entry.auth.onModuleDestroy();
  entry.database.onModuleDestroy();
  const index = opened.indexOf(entry);
  if (index >= 0) opened.splice(index, 1);
}

function adminRow(database: DatabaseService) {
  return database.connection.prepare("SELECT * FROM users WHERE role = 'admin'").get() as
    | { id: string; username: string; password_hash: string; status: string }
    | undefined;
}

function sessionCount(database: DatabaseService, userId: string): number {
  return (database.connection.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId) as { count: number }).count;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // ensureAdmin намеренно печатает данные администратора в консоль — в тестах
  // это шум, а сами сообщения проверяем через файл admin-credentials.txt.
  consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const entry of opened.splice(0)) {
    entry.auth.onModuleDestroy();
    entry.database.onModuleDestroy();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  consoleLog.mockRestore();
  consoleWarn.mockRestore();
  process.env.WAKANDA_DATA_DIR = originalEnv.dataDir;
  process.env.WAKANDA_ADMIN_USER = originalEnv.adminUser;
  process.env.WAKANDA_ADMIN_PASS = originalEnv.adminPass;
  process.env.NODE_ENV = originalEnv.nodeEnv;
});

describe('регистрация', () => {
  it('создаёт обычного пользователя в статусе pending и рабочую сессию', () => {
    const { auth } = make(tempDir());

    const { token, user } = auth.register('alice', 'secret123');

    expect(user).toMatchObject({ username: 'alice', role: 'user', status: 'pending' });
    expect(auth.getSession(token)).toMatchObject({ id: user.id, status: 'pending' });
  });

  it('отклоняет короткий логин, короткий пароль и занятый логин в другом регистре', () => {
    const { auth } = make(tempDir());
    auth.register('alice', 'secret123');

    expect(() => auth.register('ab', 'secret123')).toThrow(BadRequestException);
    expect(() => auth.register('борис', '123')).toThrow(BadRequestException);
    expect(() => auth.register('ALICE', 'secret123')).toThrow(ConflictException);
  });

  it('не отдаёт наружу хэш пароля', () => {
    const { auth } = make(tempDir());
    auth.register('alice', 'secret123');

    const [user] = auth.listUsers();

    expect(user).not.toHaveProperty('password_hash');
  });
});

describe('вход', () => {
  it('неверный пароль и несуществующий логин дают одинаковый 401', () => {
    const { auth } = make(tempDir());
    auth.register('alice', 'secret123');

    expect(() => auth.login('alice', 'wrong-pass')).toThrow(UnauthorizedException);
    expect(() => auth.login('nobody', 'secret123')).toThrow(UnauthorizedException);
  });

  it('пустые поля — 400', () => {
    const { auth } = make(tempDir());

    expect(() => auth.login('', '')).toThrow(BadRequestException);
  });

  it('заблокированный пользователь не может войти', () => {
    const { auth } = make(tempDir());
    const { user } = auth.register('alice', 'secret123');
    auth.setStatus(user.id, 'blocked');

    expect(() => auth.login('alice', 'secret123')).toThrow(ForbiddenException);
  });
});

describe('хранение сессий', () => {
  it('в базе лежит только SHA-256 токена', () => {
    const { auth, database } = make(tempDir());

    const { token, user } = auth.register('alice', 'secret123');
    const rows = database.connection.prepare('SELECT token FROM sessions WHERE user_id = ?').all(user.id) as Array<{ token: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].token).not.toBe(token);
    expect(rows[0].token).toBe(sha256(token));
  });

  it('старый «сырой» токен принимается один раз и сразу перезаписывается хэшем', () => {
    const { auth, database } = make(tempDir());
    const { user } = auth.register('alice', 'secret123');
    const raw = 'legacy-raw-token';
    const now = Date.now();
    database.connection
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(raw, user.id, new Date(now).toISOString(), new Date(now + 86_400_000).toISOString());

    expect(auth.getSession(raw)?.id).toBe(user.id);
    expect((database.connection.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?').get(raw) as { count: number }).count).toBe(0);
    expect((database.connection.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?').get(sha256(raw)) as { count: number }).count).toBe(1);
  });

  it('истёкшая сессия не проходит и удаляется', () => {
    const { auth, database } = make(tempDir());
    const { user } = auth.register('alice', 'secret123');
    const expired = 'expired-token';
    database.connection
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(expired), user.id, new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() - 1000).toISOString());

    const before = sessionCount(database, user.id);
    expect(auth.getSession(expired)).toBeNull();
    expect(sessionCount(database, user.id)).toBe(before - 1);
  });

  it('logout убивает только текущую сессию, logoutEverywhere — все остальные', () => {
    const { auth } = make(tempDir());
    const first = auth.register('alice', 'secret123');
    const second = auth.login('alice', 'secret123');

    auth.logout(second.token);
    expect(auth.getSession(second.token)).toBeNull();
    expect(auth.getSession(first.token)?.id).toBe(first.user.id);

    auth.logoutEverywhere(first.user.id, first.token);
    expect(auth.getSession(first.token)?.id).toBe(first.user.id);

    auth.logoutEverywhere(first.user.id);
    expect(auth.getSession(first.token)).toBeNull();
  });

  it('блокировка выкидывает активную сессию сразу', () => {
    const { auth } = make(tempDir());
    const { token, user } = auth.register('alice', 'secret123');

    auth.setStatus(user.id, 'blocked');

    expect(auth.getSession(token)).toBeNull();
  });
});

describe('смена пароля', () => {
  it('требует текущий пароль', () => {
    const { auth } = make(tempDir());
    const { token, user } = auth.register('alice', 'secret123');

    expect(() => auth.changePassword(user.id, token, 'wrong-pass', 'newsecret456')).toThrow(BadRequestException);
    expect(() => auth.changePassword(user.id, token, 'secret123', '123')).toThrow(BadRequestException);
  });

  it('меняет пароль и оставляет только текущую сессию', () => {
    const { auth } = make(tempDir());
    const current = auth.register('alice', 'secret123');
    const other = auth.login('alice', 'secret123');

    auth.changePassword(current.user.id, current.token, 'secret123', 'newsecret456');

    expect(() => auth.login('alice', 'secret123')).toThrow(UnauthorizedException);
    expect(auth.login('alice', 'newsecret456').user.id).toBe(current.user.id);
    expect(auth.getSession(current.token)?.id).toBe(current.user.id);
    expect(auth.getSession(other.token)).toBeNull();
  });

  it('сброс пароля админом разрывает все сессии пользователя', () => {
    const { auth } = make(tempDir());
    const { token, user } = auth.register('alice', 'secret123');
    auth.setStatus(user.id, 'approved');

    auth.resetPassword(user.id, 'resetpass789');

    expect(auth.getSession(token)).toBeNull();
    expect(auth.login('alice', 'resetpass789').user.id).toBe(user.id);
  });

  it('админом управлять нельзя', () => {
    const { auth, database } = make(tempDir());
    const admin = adminRow(database);
    expect(admin).toBeTruthy();

    expect(() => auth.setStatus(admin!.id, 'blocked')).toThrow(ForbiddenException);
    expect(() => auth.resetPassword(admin!.id, 'newsecret456')).toThrow(ForbiddenException);
    expect(() => auth.deleteUser(admin!.id)).toThrow(ForbiddenException);
  });

  it('удаление пользователя чистит сессии, состояние, историю и push-данные', () => {
    const { auth, database } = make(tempDir());
    const { user } = auth.register('alice', 'secret123');
    const now = new Date().toISOString();
    database.connection.prepare('INSERT INTO user_state (user_id, data, updated_at, revision) VALUES (?, ?, ?, ?)').run(user.id, '{}', now, 1);
    database.connection
      .prepare('INSERT INTO user_state_history (user_id, data, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, '{}', 'test', now);
    database.connection
      .prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, 'https://push.example/1', 'key', 'secret', now);
    database.connection.prepare('INSERT INTO push_log (user_id, date_key, sent_at) VALUES (?, ?, ?)').run(user.id, '2026-01-01', now);

    auth.deleteUser(user.id);

    const tables: Array<{ table: string; column: string }> = [
      { table: 'users', column: 'id' },
      { table: 'sessions', column: 'user_id' },
      { table: 'user_state', column: 'user_id' },
      { table: 'user_state_history', column: 'user_id' },
      { table: 'push_subscriptions', column: 'user_id' },
      { table: 'push_log', column: 'user_id' },
    ];
    for (const { table, column } of tables) {
      const count = (database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(user.id) as { count: number }).count;
      expect(count, `остались строки в ${table}`).toBe(0);
    }
  });
});

describe('единственный администратор', () => {
  it('создаётся один одобренный админ и файл с доступом', () => {
    const dir = tempDir();
    const { database } = make(dir);

    const admin = adminRow(database);
    expect(admin).toMatchObject({ username: 'waka_admin', status: 'approved' });
    expect(admin!.password_hash.startsWith('scrypt:')).toBe(true);
    const credentials = readFileSync(join(dir, 'admin-credentials.txt'), 'utf8');
    expect(credentials).toContain('Логин:  waka_admin');
    expect(credentials).not.toContain('Пароль: задан переменной');
  });

  it('пароль из WAKANDA_ADMIN_PASS применяется и переживает перезапуск', () => {
    const dir = tempDir();
    make(dir, { pass: 'first-pass-123' });
    close(opened[0]);

    const second = make(dir, { pass: 'second-pass-456' });
    expect(() => second.auth.login('waka_admin', 'first-pass-123')).toThrow(UnauthorizedException);
    expect(second.auth.login('waka_admin', 'second-pass-456').user).toMatchObject({ role: 'admin', status: 'approved' });
  });

  it('без env пароль не меняется при перезапуске', () => {
    const dir = tempDir();
    const first = make(dir, { pass: 'keep-this-pass-1' });
    const hashBefore = adminRow(first.database)!.password_hash;
    close(first);

    const second = make(dir);
    expect(adminRow(second.database)!.password_hash).toBe(hashBefore);
    expect(second.auth.login('waka_admin', 'keep-this-pass-1').user.role).toBe('admin');
  });

  it('старая база без метки ротации один раз получает случайный пароль', () => {
    const dir = tempDir();
    const first = make(dir, { pass: 'legacy-pass-123' });
    first.database.connection.prepare('DELETE FROM settings WHERE key = ?').run('admin_password_rotated');
    const hashBefore = adminRow(first.database)!.password_hash;
    close(first);

    const second = make(dir);

    expect(adminRow(second.database)!.password_hash).not.toBe(hashBefore);
    expect(() => second.auth.login('waka_admin', 'legacy-pass-123')).toThrow(UnauthorizedException);
    const generated = /Пароль:\s*(\S+)/.exec(readFileSync(join(dir, 'admin-credentials.txt'), 'utf8'))?.[1];
    expect(generated).toBeTruthy();
    expect(second.auth.login('waka_admin', generated!).user.role).toBe('admin');
    // Повторный запуск уже ничего не ротирует.
    const hashAfter = adminRow(second.database)!.password_hash;
    close(second);
    const third = make(dir);
    expect(adminRow(third.database)!.password_hash).toBe(hashAfter);
    expect(third.auth.login('waka_admin', generated!).user.role).toBe('admin');
  });

  it('в production без WAKANDA_ADMIN_PASS не создаёт админа со случайным паролем', () => {
    const dir = tempDir();
    const entry = make(dir, { production: true }, false);

    expect(() => entry.auth.onModuleInit()).toThrow(/WAKANDA_ADMIN_PASS/);
    expect(adminRow(entry.database)).toBeUndefined();
  });

  it('не создаёт админа, если логин занят обычным пользователем', () => {
    const dir = tempDir();
    const entry = make(dir, {}, false);
    entry.auth.register('waka_admin', 'secret123');

    expect(() => entry.auth.onModuleInit()).toThrow(/уже занят/);
    expect(adminRow(entry.database)).toBeUndefined();
  });

  it('лишние администраторы понижаются при запуске', () => {
    const dir = tempDir();
    const first = make(dir);
    const now = new Date().toISOString();
    first.database.connection
      .prepare("INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, 'admin', 'approved', ?)")
      .run('extra-admin', 'extra-admin', 'scrypt:00:00', now);
    close(first);

    const second = make(dir);

    const extra = second.database.connection.prepare("SELECT role, status FROM users WHERE username = 'extra-admin'").get() as { role: string; status: string };
    expect(extra).toEqual({ role: 'user', status: 'approved' });
    expect((second.database.connection.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as { count: number }).count).toBe(1);
  });
});
