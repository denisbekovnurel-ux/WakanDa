import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { FIXED_ADMIN_USERNAME } from './admin.config';

const PASSWORD_ROTATED_SETTING = 'admin_password_rotated';

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
export class AuthService implements OnModuleInit, OnModuleDestroy {
  // touch() больше не пишет в SQLite на каждый запрос: сессия и так живёт долго,
  // а «онлайн» определяется окном в две минуты. Обновляем статус не чаще 30 секунд.
  private static readonly TOUCH_INTERVAL_MS = 30 * 1000;
  private readonly lastTouchAt = new Map<string, number>();
  private readonly db: Database.Database;
  private readonly dataDir: string;
  private cleanupTimer: NodeJS.Timeout | null = null;
  // Хэш-заглушка для несуществующего логина: вход отвечает за то же время,
  // что и неверный пароль, и не выдаёт существование аккаунта по таймингу.
  private readonly dummyPasswordHash = this.hashPassword(randomBytes(18).toString('base64url'));

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
    this.dataDir = database.dataDir;
  }

  onModuleInit() {
    this.cleanExpiredSessions();
    this.ensureAdmin();
    // Периодическая уборка истёкших сессий (не держит процесс живым).
    this.cleanupTimer = setInterval(() => this.cleanExpiredSessions(), 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  // ─────────────────────────── Администратор ───────────────────────────

  // Гарантирует РОВНО ОДИН аккаунт администратора с фиксированными данными.
  // Админ не меняется и не дублируется:
  //   • нет админа — создать;
  //   • статус/роль разошлись — починить (пароль — только если задан env);
  //   • появился второй админ — понизить его до обычного пользователя.
  private ensureAdmin() {
    const username = (process.env.WAKANDA_ADMIN_USER || '').trim() || FIXED_ADMIN_USERNAME;
    const envPassword = (process.env.WAKANDA_ADMIN_PASS || '').trim();
    const usingEnvPassword = Boolean(envPassword);
    const isProduction = process.env.NODE_ENV === 'production';
    const now = new Date().toISOString();

    if (usingEnvPassword && envPassword.length < 6) {
      throw new Error('WAKANDA_ADMIN_PASS должен быть не короче 6 символов');
    }

    const admins = this.db
      .prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at")
      .all() as UserRow[];

    let target = admins.find((admin) => admin.username.toLowerCase() === username.toLowerCase());
    const repaired: string[] = [];
    let generatedPassword: string | null = null;
    // В старых версиях у админа был публичный пароль по умолчанию. Отличить его
    // от пользовательского без знания пароля нельзя, поэтому для баз без метки
    // делаем однократную ротацию: пароль становится случайным и попадает в
    // admin-credentials.txt. Метка в settings не даёт повторять это при каждом запуске.
    let passwordRotated = Boolean(
      this.db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSWORD_ROTATED_SETTING),
    );

    if (!target) {
      const usernameOwner = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (usernameOwner) {
        throw new Error(`Логин администратора «${username}» уже занят обычным пользователем. Задайте другой WAKANDA_ADMIN_USER.`);
      }
      if (admins.length && !usingEnvPassword) {
        throw new Error(
          `Администратор уже существует под другим логином. Задайте WAKANDA_ADMIN_USER или WAKANDA_ADMIN_PASS, чтобы создать нового.`,
        );
      }
      if (!usingEnvPassword && isProduction) {
        throw new Error('В production задайте WAKANDA_ADMIN_PASS — пароль администратора не будет создан случайно.');
      }

      const initialPassword = usingEnvPassword ? envPassword : this.generateAdminPassword();
      if (!usingEnvPassword) generatedPassword = initialPassword;
      target = this.createUserRow(username, initialPassword, 'admin', 'approved');
      repaired.push(generatedPassword ? 'создан со случайным паролем' : 'создан');
      passwordRotated = true;
    } else {
      // Пароль, изменённый пользователем/админом, больше НЕ откатывается к
      // значению из репозитория при каждом запуске. Явно заданный env-пароль
      // применяется осознанно; без env старый публичный пароль заменяется один раз.
      if (usingEnvPassword) {
        if (!this.verifyPassword(envPassword, target.password_hash)) {
          this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(this.hashPassword(envPassword), target.id);
          repaired.push('пароль из WAKANDA_ADMIN_PASS');
        }
        passwordRotated = true;
      } else if (!passwordRotated) {
        generatedPassword = this.generateAdminPassword();
        this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(this.hashPassword(generatedPassword), target.id);
        repaired.push('устаревший пароль заменён случайным');
        passwordRotated = true;
      }
      if (target.status !== 'approved') {
        this.db
          .prepare('UPDATE users SET status = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?')
          .run('approved', now, target.id);
        repaired.push('статус');
      }
    }

    if (passwordRotated) {
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(PASSWORD_ROTATED_SETTING, '1');
    }

    target = this.db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as UserRow;
    if (repaired.length) {
      console.log(`WakanDa: аккаунт администратора приведён в порядок (${repaired.join(', ')})`);
    }

    // Никаких вторых администраторов.
    for (const admin of admins) {
      if (admin.id === target.id) continue;
      this.db.prepare("UPDATE users SET role = 'user', status = 'approved' WHERE id = ?").run(admin.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
      console.log(`WakanDa: у аккаунта «${admin.username}» сняты права администратора`);
    }

    const credentialsFile = join(this.dataDir, 'admin-credentials.txt');
    const passwordLine = generatedPassword
      ? `Пароль: ${generatedPassword}\n        Сохраните его и смените через раздел «Пароль».\n`
      : usingEnvPassword
        ? 'Пароль: задан переменной WAKANDA_ADMIN_PASS (в файл не записывается).\n'
        : 'Пароль: не хранится в открытом виде. Задайте WAKANDA_ADMIN_PASS, чтобы сменить его.\n';
    const content =
      'WakanDa — доступ администратора\n' +
      `Логин:  ${username}\n` +
      passwordLine +
      `Проверочный хэш (scrypt): ${target.password_hash}\n\n` +
      'Это ЕДИНСТВЕННЫЙ администратор. Он создаётся автоматически и не может быть\n' +
      'удалён, заблокирован или продублирован (регистрация всегда создаёт обычных\n' +
      'пользователей, а лишние «админы» понижаются при запуске сервера).\n\n' +
      'Сменить пароль можно в разделе «Пароль» или задав WAKANDA_ADMIN_PASS в server/.env.\n' +
      'Без WAKANDA_ADMIN_PASS сервер НЕ сбрасывает изменённый пароль при перезапуске.\n';
    try {
      writeFileSync(credentialsFile, content, { mode: 0o600 });
    } catch (error) {
      console.error('Не удалось сохранить файл с данными администратора:', error);
      if (generatedPassword) {
        console.error(`WakanDa: сохраните сгенерированный пароль администратора вручную: ${generatedPassword}`);
      }
    }

    if (process.platform === 'win32') {
      console.warn('WakanDa: на Windows права файла admin-credentials.txt (0600) не действуют — считайте файл обычным секретом.');
    }
    console.log('\n============================================');
    console.log('  WakanDa: аккаунт администратора (единственный)');
    console.log(`  Логин:  ${username}`);
    if (generatedPassword) {
      console.log(isProduction
        ? `  Пароль: сгенерирован и записан в ${credentialsFile}`
        : `  Пароль: ${generatedPassword}`);
    } else if (usingEnvPassword) {
      console.log('  Пароль: задан переменной WAKANDA_ADMIN_PASS (в лог не выводится)');
    } else {
      console.log('  Пароль: не изменялся; в открытом виде не хранится');
    }
    console.log(`  Файл:   ${credentialsFile}`);
    console.log('============================================\n');
  }

  private generateAdminPassword(): string {
    return randomBytes(18).toString('base64url');
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
    // Для несуществующего логина всё равно считаем scrypt, чтобы время ответа
    // не подсказывало, зарегистрирован аккаунт или нет.
    const passwordOk = this.verifyPassword(password, row?.password_hash ?? this.dummyPasswordHash);
    if (!row || !passwordOk) {
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
    this.deleteOtherSessions(userId, sessionToken);
    return { ok: true };
  }

  logoutEverywhere(userId: string, exceptToken?: string) {
    const removed = exceptToken
      ? this.deleteOtherSessions(userId, exceptToken)
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
    // В БД лежит только SHA-256 токена: утечка базы не даёт готовых сессий.
    this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(this.hashToken(token), userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    return token;
  }

  getSession(token: string): PublicUser | null {
    if (!token) return null;
    const tokenHash = this.hashToken(token);
    let storedToken = tokenHash;
    const select = this.db.prepare(
      'SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    );
    let row = select.get(tokenHash) as (UserRow & { session_expires: string }) | undefined;

    // Совместимость с сессиями, созданными до перехода на хэши: находим старый
    // raw-токен и сразу перезаписываем его хэшем.
    if (!row) {
      row = select.get(token) as (UserRow & { session_expires: string }) | undefined;
      if (row) {
        this.db.prepare('UPDATE sessions SET token = ? WHERE token = ?').run(tokenHash, token);
        storedToken = tokenHash;
      }
    }
    if (!row) return null;

    const expiresAt = new Date(row.session_expires).getTime();
    if (expiresAt < Date.now()) {
      this.deleteSession(storedToken);
      return null;
    }
    // Скользящий срок: активная сессия продлевается по мере использования.
    if (expiresAt - Date.now() < SLIDING_THRESHOLD_MS) {
      this.db
        .prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
        .run(new Date(Date.now() + SESSION_TTL_MS).toISOString(), storedToken);
    }
    // Заблокированного пользователя выкидываем в тот же момент.
    if (row.status === 'blocked') {
      this.deleteSession(storedToken);
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

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token IN (?, ?)').run(token, this.hashToken(token));
  }

  private deleteOtherSessions(userId: string, keepToken: string) {
    const keepHash = this.hashToken(keepToken);
    return this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token NOT IN (?, ?)')
      .run(userId, keepToken, keepHash);
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
    const remove = this.db.transaction(() => {
      // push_log не имеет FK на users, поэтому чистим его вручную; остальные
      // таблицы удаляем явно, чтобы не зависеть от настроек foreign_keys.
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      this.db.prepare('DELETE FROM user_state WHERE user_id = ?').run(row.id);
      this.db.prepare('DELETE FROM user_state_history WHERE user_id = ?').run(row.id);
      this.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(row.id);
      this.db.prepare('DELETE FROM push_log WHERE user_id = ?').run(row.id);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    });
    remove();
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
