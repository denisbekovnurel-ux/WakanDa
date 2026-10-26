import { BadRequestException, ConflictException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Database from 'better-sqlite3';
import webpush from 'web-push';
import { DatabaseService } from '../database/database.service';
import { dueReminderDateKey, normalizeTimezoneOffset, ReminderSettings } from './push.util';

// Раз в минуту проверяем, у кого наступило время напоминания.
const CHECK_INTERVAL_MS = 60_000;
// Журнал отправок нужен только для защиты от дублей — старое убираем.
const PRUNE_INTERVAL_MS = 60 * 60_000;
const PUSH_LOG_RETENTION_DAYS = 30;
const MAX_SUBSCRIPTIONS_PER_USER = 10;
const PUSH_TIMEOUT_MS = 5_000;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_P256DH_LENGTH = 512;
const MAX_AUTH_LENGTH = 128;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

// Реальные push-сервисы браузеров. WAKANDA_PUSH_HOSTS добавляет свои хосты
// (через запятую), если используется другой провайдер.
const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
  'push.microsoft.com',
];

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
  private remindersRunning = false;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
    this.loadVapidKeys();
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      this.runReminders().catch((error) => console.error('Push: напоминания не отработали:', error));
    }, CHECK_INTERVAL_MS);
    this.pruneTimer = setInterval(() => {
      try {
        this.prunePushLog();
      } catch (error) {
        console.error('Push: не удалось почистить журнал отправок:', error);
      }
    }, PRUNE_INTERVAL_MS);
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
    return this.ready ? this.vapidPublic : '';
  }

  private hostAllowed(hostname: string): boolean {
    const extra = (process.env.WAKANDA_PUSH_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
    return [...DEFAULT_PUSH_HOSTS, ...extra].some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
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
    if (Boolean(envPublic) !== Boolean(envPrivate)) {
      // Один ключ без второго — почти наверняка ошибка конфигурации. Не
      // подменяем половину пары сгенерированным ключом: старые подписки молча
      // перестанут работать, а причина будет неочевидной.
      console.error('Push: WAKANDA_VAPID_PUBLIC и WAKANDA_VAPID_PRIVATE нужно задавать вместе. Уведомления отключены.');
      this.ready = false;
      return;
    }
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

  subscribe(userId: string, input: unknown, timezoneOffset: unknown, deviceId: unknown) {
    if (!this.ready) throw new BadRequestException('Уведомления на сервере не настроены');
    const subscription = this.validateSubscription(input);
    const offset = normalizeTimezoneOffset(timezoneOffset);
    const device = this.readDeviceId(deviceId);
    const existing = this.db
      .prepare('SELECT id, user_id, device_id FROM push_subscriptions WHERE endpoint = ?')
      .get(subscription.endpoint) as { id: number; user_id: string; device_id: string | null } | undefined;

    if (existing && existing.user_id !== userId) {
      // Один и тот же браузер при смене аккаунта может переоформить подписку,
      // но чужой endpoint нельзя «увести» на себя без совпадения device id.
      if (!device || existing.device_id !== device) {
        throw new ConflictException('Эта push-подписка уже привязана к другому аккаунту');
      }
    }
    if (!existing && this.countForUser(userId) >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw new BadRequestException('Слишком много устройств для уведомлений');
    }

    this.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, timezone_offset, device_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           timezone_offset = excluded.timezone_offset,
           device_id = COALESCE(excluded.device_id, push_subscriptions.device_id)`,
      )
      .run(
        userId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        offset,
        device || null,
        new Date().toISOString(),
      );
    return { ok: true };
  }

  unsubscribe(userId: string, endpoint: unknown) {
    if (typeof endpoint !== 'string' || !endpoint.trim()) throw new BadRequestException('Не указан адрес подписки');
    const normalized = endpoint.trim().slice(0, MAX_ENDPOINT_LENGTH);
    const removed = this.db
      .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, normalized);
    return { ok: true, removed: removed.changes };
  }

  private readDeviceId(value: unknown): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !DEVICE_ID_RE.test(value.trim())) {
      throw new BadRequestException('Некорректный идентификатор устройства');
    }
    return value.trim();
  }

  private validateSubscription(input: unknown): { endpoint: string; p256dh: string; auth: string } {
    if (!input || typeof input !== 'object') throw new BadRequestException('Некорректная подписка');
    const record = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = record.endpoint;
    const keys = record.keys;
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) {
      throw new BadRequestException('Некорректный адрес подписки');
    }
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new BadRequestException('Некорректный адрес подписки');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new BadRequestException('Адрес подписки должен быть HTTPS');
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!this.hostAllowed(url.hostname) && !(process.env.NODE_ENV !== 'production' && loopback)) {
      throw new BadRequestException('Этот push-сервис не разрешён');
    }
    if (
      !keys ||
      typeof keys !== 'object' ||
      typeof keys.p256dh !== 'string' ||
      !keys.p256dh ||
      keys.p256dh.length > MAX_P256DH_LENGTH ||
      typeof keys.auth !== 'string' ||
      !keys.auth ||
      keys.auth.length > MAX_AUTH_LENGTH
    ) {
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
          { TTL: 3600, timeout: PUSH_TIMEOUT_MS },
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
    if (!this.ready || this.remindersRunning) return;
    this.remindersRunning = true;
    try {
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
        const alreadySent = this.db
          .prepare('SELECT 1 FROM push_log WHERE user_id = ? AND date_key = ?')
          .get(row.user_id, dateKey);
        if (alreadySent) continue;
        const result = await this.sendToUser(row.user_id, {
          title: 'WakanDa — время свериться',
          body: 'Пора отметить привычки за сегодня и закрыть день.',
          url: '/#daily',
        });
        // Если не ушло ни одно уведомление (сеть/сервис), не считаем день
        // закрытым: следующий тик попробует снова в пределах grace-окна.
        if (result.sent > 0) {
          this.db
            .prepare('INSERT OR IGNORE INTO push_log (user_id, date_key, sent_at) VALUES (?, ?, ?)')
            .run(row.user_id, dateKey, now.toISOString());
        }
      }
    } finally {
      this.remindersRunning = false;
    }
  }
}
