import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { FIXED_ADMIN_PASSWORD, FIXED_ADMIN_USERNAME } from './admin.config';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export type PublicUser = {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastSeenAt: string | null;
};

export type UserView = PublicUser & { online: boolean };

export type AuthResult = { token: string; user: PublicUser };

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
};

// Сессия живёт 30 дней без входа.
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
// Активной сессии продлеваем срок, когда до конца осталось меньше недели
// (скользящая сессия: не заставляем заходить заново, пока пользуешься).
const SLIDING_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7;
// Человек считается «в сети», если он был активен последние 2 минуты.
const ONLINE_WINDOW_MS = 1000 * 120;
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;

@Injectable()
export class AuthService implements OnModuleInit {
  // touch() больше не пишет в SQLite на каждый запрос: сессия и так живёт долго,
  // а «онлайн» определяется окном в две минуты. Обновляем статус не чаще 30 секунд.
  private static readonly TOUCH_INTERVAL_MS = 30 * 1000;
  private readonly lastTouchAt = new Map<string, number>();
  private readonly db: Database.Database;
  private readonly dataDir: string;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
    this.dataDir = database.dataDir;
  }

  onModuleInit() {
    this.cleanExpiredSessions();
    this.ensureAdmin();
    // Периодическая уборка истёкших сессий (не держит процесс живым).
    setInterval(() => this.cleanExpiredSessions(), 60 * 60 * 1000).unref();
  }

  // ─────────────────────────── Администратор ───────────────────────────

  // Гарантирует РОВНО ОДИН аккаунт администратора с фиксированными данными.
  // Админ не меняется и не дублируется:
  //   • нет админа — создать;
  //   • пароль/статус/роль разошлись — починить;
  //   • появился второй админ — понизить его до обычного пользователя.
  private ensureAdmin() {
    const username = (process.env.WAKANDA_ADMIN_USER || '').trim() || FIXED_ADMIN_USERNAME;
    const password = process.env.WAKANDA_ADMIN_PASS || FIXED_ADMIN_PASSWORD;
    const usingDefaultPassword = !process.env.WAKANDA_ADMIN_PASS;
    const now = new Date().toISOString();

    const admins = this.db
      .prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at")
      .all() as UserRow[];

    let target = admins.find((admin) => admin.username.toLowerCase() === username.toLowerCase());

    if (!target) {
      target = this.createUserRow(username, password, 'admin', 'approved');
    } else {
      const repaired: string[] = [];
      if (!this.verifyPassword(password, target.password_hash)) {
        this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(this.hashPassword(password), target.id);
        repaired.push('пароль');
      }
      if (target.status !== 'approved') {
        this.db
          .prepare('UPDATE users SET status = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?')
          .run('approved', now, target.id);
        repaired.push('статус');
      }
      target = this.db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as UserRow;
      if (repaired.length) {
        console.log(`WakanDa: аккаунт администратора приведён в порядок (${repaired.join(', ')})`);
      }
    }

    // Никаких вторых администраторов.
    for (const admin of admins) {
      if (admin.id === target.id) continue;
      this.db.prepare("UPDATE users SET role = 'user', status = 'approved' WHERE id = ?").run(admin.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
      console.log(`WakanDa: у аккаунта «${admin.username}» сняты права администратора`);
    }

    const credentialsFile = join(this.dataDir, 'admin-credentials.txt');
    const content =
      'WakanDa — доступ администратора\n' +
      `Логин:  ${username}\n` +
      `Пароль: ${password}\n\n` +
      'Это ЕДИНСТВЕННЫЙ администратор. Он создаётся автоматически и не может быть\n' +
      'удалён, заблокирован или продублирован (регистрация всегда создаёт обычных\n' +
      'пользователей, а лишние «админы» понижаются при запуске сервера).\n\n' +
      'Сменить пароль осознанно: задайте WAKANDA_ADMIN_PASS в server/.env и перезапустите сервер.\n';
    try {
      writeFileSync(credentialsFile, content, { mode: 0o600 });
    } catch (error) {
      console.error('Не удалось сохранить файл с данными администратора:', error);
    }
    if (usingDefaultPassword) {
      const isProduction = process.env.NODE_ENV === 'production';
      console.warn(
        isProduction
          ? 'WakanDa: ВНИМАНИЕ! Пароль администратора не задан (используется значение по умолчанию из репозитория). Перед выходом в интернет задайте WAKANDA_ADMIN_PASS в server/.env!'
          : 'WakanDa: администратор использует пароль по умолчанию (WAKANDA_ADMIN_PASS не задан). Для продакшена это небезопасно.',
      );
    }
    if (process.platform === 'win32') {
      console.warn('WakanDa: на Windows права файла admin-credentials.txt (0600) не действуют — храните его как обычный секрет.');
    }
    console.log('\n============================================');
    console.log('  WakanDa: аккаунт администратора (единственный)');
    console.log(`  Логин:  ${username}`);
    console.log(`  Пароль: ${password}`);
    console.log(`  (файл: ${credentialsFile})`);
    console.log('============================================\n');
  }

  // ─────────────────────────── Пароли ───────────────────────────

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [scheme, salt, hash] = stored.split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  // ─────────────────────────── Пользователи ───────────────────────────

  register(usernameRaw: unknown, passwordRaw: unknown): AuthResult {
    const username = String(usernameRaw ?? '').trim();
    const password = String(passwordRaw ?? '');
    this.validateCredentials(username, password);

    const taken = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (taken) throw new ConflictException('Такой логин уже занят');

    const user = this.createUserRow(username, password, 'user', 'pending');
    const token = this.createSession(user.id);
    this.touch(user.id);
    return { token, user: this.toPublic(user) };
  }

  login(usernameRaw: unknown, passwordRaw: unknown): AuthResult {
    const username = String(usernameRaw ?? '').trim();
    const password = String(passwordRaw ?? '');
    if (!username || !password) throw new BadRequestException('Введите логин и пароль');

    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!row || !this.verifyPassword(password, row.password_hash)) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }
    if (row.status === 'blocked') {
      throw new ForbiddenException('Доступ заблокирован администратором');
    }
    const token = this.createSession(row.id);
    this.touch(row.id);
    return { token, user: this.toPublic(row) };
  }

  private validatePassword(password: string) {
    if (password.length < 6) {
      throw new BadRequestException('Пароль должен быть не короче 6 символов');
    }
    if (password.length > 200) {
      throw new BadRequestException('Пароль слишком длинный');
    }
  }

  private validateCredentials(username: string, password: string) {
    if (!USERNAME_RE.test(username)) {
      throw new BadRequestException('Логин: 3–24 символа, буквы, цифры, точка, дефис или подчёркивание');
    }
    this.validatePassword(password);
  }

  /**
   * Смена пароля самим пользователем. Требует текущий пароль; после смены
   * остаются действующими только текущая сессия.
   */
  changePassword(userId: string, sessionToken: string, currentPasswordRaw: unknown, newPasswordRaw: unknown) {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row) throw new UnauthorizedException('Пользователь не найден');
    const currentPassword = String(currentPasswordRaw ?? '');
    const newPassword = String(newPasswordRaw ?? '');
    if (!currentPassword || !this.verifyPassword(currentPassword, row.password_hash)) {
      throw new BadRequestException('Текущий пароль указан неверно');
    }
    this.validatePassword(newPassword);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(this.hashPassword(newPassword), userId);
    // Все остальные сессии этого пользователя больше недействительны.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, sessionToken);
    return { ok: true };
  }

  logoutEverywhere(userId: string, exceptToken?: string) {
    const removed = exceptToken
      ? this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken)
      : this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return { ok: true, sessionsRemoved: removed.changes };
  }

  private createUserRow(username: string, password: string, role: UserRole, status: UserStatus): UserRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, role, status, created_at, approved_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
      )
      .run(id, username, this.hashPassword(password), role, status, now, status === 'approved' ? now : null);
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  }

  private toPublic(row: UserRow): PublicUser {
    return {
      id: row.id,
      username: row.username,
      role: row.role === 'admin' ? 'admin' : 'user',
      status: row.status === 'approved' || row.status === 'blocked' ? row.status : 'pending',
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  // ─────────────────────────── Сессии ───────────────────────────

  private createSession(userId: string): string {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    return token;
  }

  getSession(token: string): PublicUser | null {
    if (!token) return null;
    const row = this.db
      .prepare('SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
      .get(token) as (UserRow & { session_expires: string }) | undefined;
    if (!row) return null;
    const expiresAt = new Date(row.session_expires).getTime();
    if (expiresAt < Date.now()) {
      this.deleteSession(token);
      return null;
    }
    // Скользящий срок: активная сессия продлевается по мере использования.
    if (expiresAt - Date.now() < SLIDING_THRESHOLD_MS) {
      this.db
        .prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
        .run(new Date(Date.now() + SESSION_TTL_MS).toISOString(), token);
    }
    // Заблокированного пользователя выкидываем в тот же момент.
    if (row.status === 'blocked') {
      this.deleteSession(token);
      return null;
    }
    return this.toPublic(row);
  }

  touch(userId: string) {
    const now = Date.now();
    const last = this.lastTouchAt.get(userId) ?? 0;
    if (now - last < AuthService.TOUCH_INTERVAL_MS) return;
    this.lastTouchAt.set(userId, now);
    this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
  }

  logout(token: string) {
    this.deleteSession(token);
  }

  private deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  private cleanExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  }

  // ─────────────────────────── Администрирование ───────────────────────────

  private requireManageableUser(id: string): UserRow {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!row) throw new BadRequestException('Пользователь не найден');
    if (row.role === 'admin') throw new ForbiddenException('Нельзя управлять аккаунтом администратора');
    return row;
  }

  setStatus(id: string, status: Extract<UserStatus, 'approved' | 'blocked'>) {
    const row = this.requireManageableUser(id);
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET status = ?, approved_at = CASE WHEN ? = ? THEN COALESCE(approved_at, ?) ELSE approved_at END WHERE id = ?')
      .run(status, status, 'approved', now, id);
    if (status === 'blocked') this.deleteUserSessions(row.id);
    return this.toPublic(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow);
  }

  kick(id: string) {
    const row = this.requireManageableUser(id);
    const removed = this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    return { ok: true, sessionsRemoved: removed.changes };
  }

  /**
   * Сброс пароля администратором: новый пароль задаётся напрямую,
   * все сессии пользователя разрываются (вход заново).
   */
  resetPassword(id: string, passwordRaw: unknown) {
    const row = this.requireManageableUser(id);
    const password = String(passwordRaw ?? '');
    this.validatePassword(password);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(this.hashPassword(password), row.id);
    this.deleteUserSessions(row.id);
    return { ok: true };
  }

  deleteUser(id: string) {
    const row = this.requireManageableUser(id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    this.db.prepare('DELETE FROM user_state WHERE user_id = ?').run(row.id);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    this.lastTouchAt.delete(row.id);
    return { ok: true };
  }

  private deleteUserSessions(userId: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  listUsers(): UserView[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
    const onlineAfter = Date.now() - ONLINE_WINDOW_MS;
    return rows.map((row) => {
      const view = this.toPublic(row);
      const online = Boolean(row.last_seen_at) && new Date(row.last_seen_at as string).getTime() >= onlineAfter;
      return { ...view, online };
    });
  }

  stats() {
    const rows = this.db.prepare('SELECT status, role, last_seen_at FROM users').all() as Array<{
      status: string;
      role: string;
      last_seen_at: string | null;
    }>;
    const onlineAfter = Date.now() - ONLINE_WINDOW_MS;
    let approved = 0;
    let pending = 0;
    let blocked = 0;
    let online = 0;
    for (const row of rows) {
      if (row.status === 'approved') approved += 1;
      else if (row.status === 'blocked') blocked += 1;
      else pending += 1;
      if (row.last_seen_at && new Date(row.last_seen_at).getTime() >= onlineAfter) online += 1;
    }
    return { total: rows.length, approved, pending, blocked, online };
  }
}
