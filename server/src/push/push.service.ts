import { BadRequestException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Database from 'better-sqlite3';
import webpush from 'web-push';
import { DatabaseService } from '../database/database.service';
import { dueReminderDateKey, normalizeTimezoneOffset, ReminderSettings } from './push.util';

// Раз в минуту проверяем, у кого наступило время напоминания.
const CHECK_INTERVAL_MS = 60_000;
// Журнал отправок нужен только для защиты от дублей — старое убираем.
const PRUNE_INTERVAL_MS = 60 * 60_000;
const PUSH_LOG_RETENTION_DAYS = 30;

export type PushPayload = { title: string; body: string; url?: string };

type SubscriptionRow = {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone_offset: number;
};

type ReminderRow = { user_id: string; data: string; tz: number | null };

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly db: Database.Database;
  private timer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private vapidPublic = '';
  private vapidPrivate = '';
  private ready = false;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
    this.loadVapidKeys();
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      this.runReminders().catch((error) => console.error('Push: напоминания не отработали:', error));
    }, CHECK_INTERVAL_MS);
    this.pruneTimer = setInterval(() => this.prunePushLog(), PRUNE_INTERVAL_MS);
    // Не держим процесс живым только из-за таймеров напоминаний.
    this.timer.unref?.();
    this.pruneTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.timer = null;
    this.pruneTimer = null;
  }

  private prunePushLog() {
    const cutoff = new Date(Date.now() - PUSH_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    this.db.prepare('DELETE FROM push_log WHERE date_key < ?').run(cutoff);
  }

  /** Публичный VAPID-ключ — его отдаём клиенту, чтобы тот оформил подписку. */
  publicKey(): string {
    return this.vapidPublic;
  }

  private readSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private saveSetting(key: string, value: string) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // Ключи VAPID: сначала из окружения, иначе из БД, иначе генерируем и сохраняем.
  // Пара ключей неизменна между перезапусками — иначе старые подписки станут недействительными.
  private loadVapidKeys() {
    const envPublic = (process.env.WAKANDA_VAPID_PUBLIC || '').trim();
    const envPrivate = (process.env.WAKANDA_VAPID_PRIVATE || '').trim();
    let publicKey = envPublic || this.readSetting('vapid_public') || '';
    let privateKey = envPrivate || this.readSetting('vapid_private') || '';
    if (!publicKey || !privateKey) {
      const generated = webpush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
    }
    if (!envPublic) this.saveSetting('vapid_public', publicKey);
    if (!envPrivate) this.saveSetting('vapid_private', privateKey);
    this.vapidPublic = publicKey;
    this.vapidPrivate = privateKey;
    const subject = (process.env.WAKANDA_VAPID_SUBJECT || 'mailto:admin@wakanda.local').trim();
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.ready = true;
    } catch (error) {
      console.error('Push: некорректные VAPID-ключи, уведомления отключены:', error);
      this.ready = false;
    }
  }

  // ─── Подписки ───

  subscribe(userId: string, input: unknown, timezoneOffset: unknown) {
    const subscription = this.validateSubscription(input);
    const offset = normalizeTimezoneOffset(timezoneOffset);
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, timezone_offset, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           timezone_offset = excluded.timezone_offset`,
      )
      .run(userId, subscription.endpoint, subscription.p256dh, subscription.auth, offset, new Date().toISOString());
    return { ok: true };
  }

  unsubscribe(userId: string, endpoint: unknown) {
    if (typeof endpoint !== 'string' || !endpoint) throw new BadRequestException('Не указан адрес подписки');
    const removed = this.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
    return { ok: true, removed: removed.changes };
  }

  private validateSubscription(input: unknown): { endpoint: string; p256dh: string; auth: string } {
    if (!input || typeof input !== 'object') throw new BadRequestException('Некорректная подписка');
    const record = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = record.endpoint;
    const keys = record.keys;
    if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) {
      throw new BadRequestException('Некорректный адрес подписки');
    }
    if (!keys || typeof keys !== 'object' || typeof keys.p256dh !== 'string' || !keys.p256dh || typeof keys.auth !== 'string' || !keys.auth) {
      throw new BadRequestException('Некорректные ключи подписки');
    }
    return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
  }

  private subscriptionsForUser(userId: string): SubscriptionRow[] {
    return this.db
      .prepare('SELECT id, user_id, endpoint, p256dh, auth, timezone_offset FROM push_subscriptions WHERE user_id = ?')
      .all(userId) as SubscriptionRow[];
  }

  countForUser(userId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?').get(userId) as { count: number };
    return row.count;
  }

  // ─── Отправка ───

  // Возвращает, сколько пушей ушло, сколько «мёртвых» подписок удалено и
  // сколько раз отправка не удалась (проблемы сети/сервиса — не удаляем подписку).
  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number; failed: number }> {
    if (!this.ready) return { sent: 0, removed: 0, failed: 0 };
    const rows = this.subscriptionsForUser(userId);
    let sent = 0;
    let removed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
          { TTL: 3600 },
        );
        sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
          removed += 1;
        } else {
          failed += 1;
        }
      }
    }
    return { sent, removed, failed };
  }

  sendTest(userId: string) {
    return this.sendToUser(userId, { title: 'WakanDa', body: 'Тестовое уведомление — push настроен.', url: '/#home' });
  }

  // ─── Планировщик напоминаний ───

  private async runReminders() {
    if (!this.ready) return;
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, us.data AS data,
           (SELECT timezone_offset FROM push_subscriptions WHERE user_id = u.id ORDER BY id DESC LIMIT 1) AS tz
         FROM users u
         JOIN user_state us ON us.user_id = u.id
         WHERE u.status = 'approved'
           AND EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = u.id)`,
      )
      .all() as ReminderRow[];
    if (!rows.length) return;
    const now = new Date();
    for (const row of rows) {
      let settings: ReminderSettings = {};
      try {
        settings = JSON.parse(row.data) as ReminderSettings;
      } catch {
        continue;
      }
      const dateKey = dueReminderDateKey(settings, now, row.tz ?? 0);
      if (!dateKey) continue;
      const alreadySent = this.db.prepare('SELECT 1 FROM push_log WHERE user_id = ? AND date_key = ?').get(row.user_id, dateKey);
      if (alreadySent) continue;
      // Помечаем до отправки: иначе при нескольких тиках подряд возможен дубль.
      this.db
        .prepare('INSERT OR IGNORE INTO push_log (user_id, date_key, sent_at) VALUES (?, ?, ?)')
        .run(row.user_id, dateKey, now.toISOString());
      await this.sendToUser(row.user_id, {
        title: 'WakanDa — время свериться',
        body: 'Пора отметить привычки за сегодня и закрыть день.',
        url: '/#daily',
      });
    }
  }
}
