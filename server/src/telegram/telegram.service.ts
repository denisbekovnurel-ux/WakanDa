import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../database/settings.service';
import { logger } from '../observability/logger';
import { localDateParts, normalizeTimezoneOffset } from '../push/push.util';
import { RemindersService } from '../reminders/reminders.service';
import { formatReminderLocalDate, isReminderRequest } from '../reminders/reminders.util';
import { StateService } from '../state/state.service';
import {
  clipTelegramText,
  isTelegramStopCommand,
  nextUpdateOffset,
  normalizeBotUsername,
  normalizeChatId,
  normalizeTelegramUsername,
  parseTelegramCommand,
  parseTelegramStart,
  resolveTelegramWebhookUrl,
  TELEGRAM_BOT_COMMANDS,
  TELEGRAM_LINK_TTL_MS,
} from './telegram.util';
import {
  connectHint,
  HELP_TEXT,
  mainMenuKeyboard,
  remindersText,
  startText,
  statusText,
  tasksText,
  todayText,
  type TelegramKeyboard,
} from './telegram.views';

type TelegramLinkRow = {
  user_id: string;
  chat_id: string;
  username: string | null;
  timezone_offset: number;
  linked_at: string;
  status: string;
};

type TelegramCodeRow = {
  user_id: string;
  timezone_offset: number;
  expires_at: string;
  status: string;
};

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: unknown;
    chat?: { id?: unknown; username?: unknown };
    from?: { username?: unknown };
  };
  callback_query?: {
    id?: string;
    data?: unknown;
    message?: {
      message_id?: number;
      text?: unknown;
      chat?: { id?: unknown };
    };
  };
};

type TelegramApiEnvelope<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

type BotIdentity = { id?: number; username?: string };

export type TelegramStatus = {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  telegramUsername: string | null;
  linkedAt: string | null;
  /** Бот принимает сообщения из Telegram (вебхук или опрос). */
  webhookReady: boolean;
};

export type TelegramLink = {
  code: string;
  deepLink: string;
  botUsername: string;
  expiresAt: string;
};

const TELEGRAM_API_TIMEOUT_MS = 6_000;
const MAX_MESSAGE_LENGTH = 4096;
// Long polling: держим соединение открытым и добавляем запас на задержку сети.
const TELEGRAM_POLL_TIMEOUT_S = 25;
const TELEGRAM_POLL_REQUEST_TIMEOUT_MS = (TELEGRAM_POLL_TIMEOUT_S + 10) * 1000;
const TELEGRAM_POLL_BACKOFF_MS = 5_000;

/** Как бот получает сообщения: вебхук, опрос или никак. */
type DeliveryMode = 'none' | 'webhook' | 'polling';

/**
 * Ожидание с возможностью отменить: без этого остановка сервиса ждала бы
 * завершения долгого таймера поллинга.
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly db: Database.Database;
  private readonly settings: SettingsService;
  private readonly token: string;
  private readonly apiBase: string;
  private readonly webhookSecret: string;
  private readonly webhookUrl: string;
  private readonly updateStateKey: string;
  private botUsername: string;
  private delivery: DeliveryMode = 'none';
  private polling = false;
  private pollAbort: AbortController | null = null;
  private updateOffset = 0;
  private lastUpdateId = 0;
  private readonly processingUpdates = new Set<number>();

  constructor(
    @Inject(DatabaseService) database: DatabaseService,
    // Необязательны только для тестов, где TelegramService создаётся напрямую.
    @Optional() @Inject(RemindersService) private readonly reminders: RemindersService | null = null,
    @Optional() @Inject(StateService) private readonly state: StateService | null = null,
    @Optional() @Inject(SettingsService) settings?: SettingsService | null,
  ) {
    this.db = database.connection;
    this.settings = settings ?? new SettingsService(database);
    this.token = (process.env.WAKANDA_TELEGRAM_BOT_TOKEN || '').trim();
    this.apiBase = (process.env.WAKANDA_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
    this.webhookSecret = (process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET || '').trim();
    // Допускаем и полный URL вебхука, и базовый адрес сайта.
    this.webhookUrl = resolveTelegramWebhookUrl(process.env.WAKANDA_TELEGRAM_WEBHOOK_URL || '');
    this.botUsername = normalizeBotUsername(process.env.WAKANDA_TELEGRAM_BOT_USERNAME || '');
    // Offset последнего обработанного update храним в settings. Ключ привязан
    // к токену бота: при смене токена Telegram начинает нумерацию заново, и
    // старый offset не должен «съесть» первые сообщения нового бота.
    this.updateStateKey = `telegram_last_update_${createHash('sha256')
      .update(this.token || 'none')
      .digest('hex')
      .slice(0, 16)}`;
    this.lastUpdateId = this.readUpdateId();
    this.updateOffset = this.lastUpdateId > 0 ? this.lastUpdateId + 1 : 0;
  }

  onModuleInit() {
    if (!this.token) return;
    // Не блокируем старт приложения, если Telegram временно недоступен.
    // Если username задан в env, он уже пригоден для deep link.
    void this.startReceiving().catch((error) => logger.error({ err: error }, 'telegram startup failed'));
  }

  onModuleDestroy() {
    this.polling = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
    if (this.delivery === 'polling') this.delivery = 'none';
  }

  /**
   * Регистрация вебхука обязательна: без неё Telegram не присылает `/start`,
   * и привязка аккаунта невозможна. Без публичного https-адреса (или без
   * секрета, который подтверждает подлинность запроса) используем long polling —
   * тогда бот работает и на локальной машине без домена.
   */
  private async startReceiving() {
    await this.resolveBotIdentity();
    await this.registerCommands();
    if (this.webhookUrl && this.webhookSecret) {
      const registered = await this.callApi<boolean>('setWebhook', {
        url: this.webhookUrl,
        secret_token: this.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
      if (registered) {
        this.delivery = 'webhook';
        logger.info({ url: this.webhookUrl }, 'telegram webhook registered');
        return;
      }
      logger.warn('telegram setWebhook failed; falling back to long polling');
    } else if (this.webhookUrl) {
      // Вебхук без секрета позволил бы любому сфальсифицировать привязку,
      // поэтому лучше опрос, чем открытое webhook-сообщество.
      logger.warn('WAKANDA_TELEGRAM_WEBHOOK_URL set without WAKANDA_TELEGRAM_WEBHOOK_SECRET; using long polling');
    }
    await this.startPolling();
  }

  private async startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.delivery = 'polling';
    const abort = new AbortController();
    this.pollAbort = abort;
    logger.info({ timeout: TELEGRAM_POLL_TIMEOUT_S }, 'telegram long polling started');

    while (this.polling) {
      try {
        const updates = await this.callApi<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this.updateOffset,
            timeout: TELEGRAM_POLL_TIMEOUT_S,
            limit: 100,
            allowed_updates: ['message', 'callback_query'],
          },
          TELEGRAM_POLL_REQUEST_TIMEOUT_MS,
          abort.signal,
        );
        if (!this.polling) break;
        if (!updates) {
          await delay(TELEGRAM_POLL_BACKOFF_MS, abort.signal);
          continue;
        }
        for (const update of updates) {
          if (update.message || update.callback_query) await this.handleUpdate(update);
        }
        this.updateOffset = nextUpdateOffset(
          updates.map((update) => update.update_id),
          this.updateOffset,
        );
      } catch (error) {
        logger.error({ err: error }, 'telegram polling iteration failed');
        await delay(TELEGRAM_POLL_BACKOFF_MS, abort.signal);
      }
    }
  }

  get configured(): boolean {
    return Boolean(this.token && this.botUsername);
  }

  /** Статус для текущего пользователя. chat_id наружу не отдаём. */
  status(userId: string): TelegramStatus {
    const row = this.linkForUser(userId);
    return {
      configured: this.configured,
      botUsername: this.botUsername || null,
      linked: Boolean(row),
      telegramUsername: row?.username ?? null,
      linkedAt: row?.linked_at ?? null,
      webhookReady: this.delivery !== 'none',
    };
  }

  private readSetting(key: string): string | undefined {
    return this.settings.get(key);
  }

  private saveSetting(key: string, value: string): void {
    this.settings.set(key, value);
  }

  private readUpdateId(): number {
    const value = Number(this.readSetting(this.updateStateKey));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  private rememberUpdate(updateId: number | undefined): void {
    if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId <= this.lastUpdateId) return;
    this.lastUpdateId = updateId;
    if (this.updateOffset <= updateId) this.updateOffset = updateId + 1;
    try {
      this.saveSetting(this.updateStateKey, String(updateId));
    } catch (error) {
      // Не роняем обработку сообщения из-за журнала: в памяти offset уже
      // сдвинут, а после перезапуска Telegram просто повторит последний update.
      logger.warn({ err: error }, 'failed to persist telegram update offset');
    }
  }

  /**
   * Создаёт одноразовый код и deep link на бота. Привязка произойдёт только
   * после того, как пользователь нажмёт Start в Telegram — это подтверждение
   * владения чатом, а не просто ввод чужого username.
   */
  createLink(userId: string, timezoneOffset: unknown): TelegramLink {
    if (!this.configured) {
      throw new BadRequestException('Telegram-бот не настроен на сервере');
    }
    this.cleanExpiredCodes();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_TTL_MS).toISOString();
    const code = randomBytes(12).toString('base64url');
    const offset = normalizeTimezoneOffset(timezoneOffset);

    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?').run(userId);
      this.db
        .prepare(
          `INSERT INTO telegram_link_codes (code, user_id, timezone_offset, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(code, userId, offset, now.toISOString(), expiresAt);
    });
    write();

    return {
      code,
      deepLink: `https://t.me/${this.botUsername}?start=${code}`,
      botUsername: this.botUsername,
      expiresAt,
    };
  }

  unlink(userId: string) {
    const removed = this.db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?').run(userId);
    return { ok: true, removed: removed.changes };
  }

  async sendTest(userId: string): Promise<{ sent: true }> {
    if (!this.configured) throw new BadRequestException('Telegram-бот не настроен на сервере');
    const link = this.linkForUser(userId);
    if (!link) throw new BadRequestException('Сначала подключи Telegram');
    if (link.status !== 'approved') throw new ForbiddenException('Доступ к WakanDa заблокирован');
    const sent = await this.sendMessage(link.chat_id, 'WakanDa: тестовое уведомление. Связь работает.');
    if (!sent) throw new BadRequestException('Не удалось отправить сообщение в Telegram');
    return { sent: true };
  }

  /** Используется планировщиком напоминаний; не бросает ошибку наружу. */
  async sendToUser(userId: string, text: string, keyboard?: TelegramKeyboard): Promise<boolean> {
    if (!this.configured) return false;
    const link = this.linkForUser(userId);
    if (!link || link.status !== 'approved') return false;
    return this.sendMessage(link.chat_id, text, keyboard ?? mainMenuKeyboard());
  }

  /**
   * Webhook Telegram. Секрет проверяем по заголовку, который Telegram
   * присылает, если при setWebhook был задан secret_token.
   */
  async handleWebhook(secret: unknown, update: unknown): Promise<{ ok: true }> {
    if (!this.webhookSecret || typeof secret !== 'string') {
      throw new ForbiddenException('Telegram webhook не настроен');
    }
    const actual = Buffer.from(secret);
    const expected = Buffer.from(this.webhookSecret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ForbiddenException('Неверный секрет Telegram webhook');
    }
    if (update && typeof update === 'object') {
      await this.handleUpdate(update as TelegramUpdate);
    }
    return { ok: true };
  }

  private async handleUpdate(update: TelegramUpdate) {
    const updateId =
      typeof update.update_id === 'number' && Number.isSafeInteger(update.update_id) && update.update_id > 0
        ? update.update_id
        : undefined;
    // Telegram повторяет webhook, если не получил 200, и может вернуть пачку
    // updates после перезапуска. Один update обрабатываем ровно один раз.
    // Set защищает и от параллельных повторов, пока первый ещё выполняется.
    if (updateId !== undefined) {
      if (updateId <= this.lastUpdateId || this.processingUpdates.has(updateId)) return;
      this.processingUpdates.add(updateId);
    }
    try {
      await this.processUpdate(update);
      this.rememberUpdate(updateId);
    } finally {
      if (updateId !== undefined) this.processingUpdates.delete(updateId);
    }
  }

  private async processUpdate(update: TelegramUpdate) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message) return;
    const chatId = normalizeChatId(message.chat?.id);
    if (!chatId) return;
    const text = clipTelegramText(message.text, MAX_MESSAGE_LENGTH);
    if (!text) return;

    if (isTelegramStopCommand(text)) {
      const removed = this.db.prepare('DELETE FROM telegram_links WHERE chat_id = ?').run(chatId);
      await this.sendMessage(
        chatId,
        removed.changes
          ? 'Уведомления WakanDa отключены. Включить снова можно в настройках сайта.'
          : 'Этот чат ещё не подключён к WakanDa.',
      );
      return;
    }

    // /stop выше работает всегда, чтобы заблокированный пользователь мог
    // отказаться от уведомлений. Остальные команды — только для approved.
    const chatLink = this.linkForChat(chatId);
    if (chatLink && chatLink.status !== 'approved') {
      await this.sendMessage(chatId, 'Доступ к WakanDa заблокирован администратором. Отключить уведомления: /stop');
      return;
    }

    const start = parseTelegramStart(text);
    if (start !== null) {
      await this.handleStart(chatId, start, message);
      return;
    }

    const command = parseTelegramCommand(text);
    if (command) {
      switch (command.name) {
        case 'start':
          await this.handleStart(chatId, '', message);
          return;
        case 'stop':
          await this.sendMessage(chatId, 'Чтобы отключить уведомления, отправь /stop без текста.', mainMenuKeyboard());
          return;
        case 'help':
          await this.sendMessage(chatId, HELP_TEXT, mainMenuKeyboard());
          return;
        case 'today':
          await this.handleToday(chatId);
          return;
        case 'tasks':
          await this.handleTasks(chatId);
          return;
        case 'status':
          await this.handleStatus(chatId);
          return;
        case 'reminders':
          await this.handleReminderList(chatId, command.args);
          return;
        case 'remind':
          await this.handleReminderCreate(chatId, text);
          return;
        default:
          await this.sendMessage(
            chatId,
            `Не знаю команду /${command.name}. Открой /help — там всё, что я умею.`,
            mainMenuKeyboard(),
          );
          return;
      }
    }

    if (isReminderRequest(text)) {
      await this.handleReminderCreate(chatId, text);
      return;
    }

    // Неподключённому чату не отвечаем молчанием: показываем, как подключиться.
    if (!this.linkForChat(chatId)) {
      await this.sendMessage(chatId, startText(false), mainMenuKeyboard());
    }
  }

  private async handleStart(
    chatId: string,
    code: string,
    message: NonNullable<TelegramUpdate['message']>,
  ) {
    if (!code) {
      await this.sendMessage(chatId, startText(Boolean(this.linkForChat(chatId))), mainMenuKeyboard());
      return;
    }

    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT c.user_id, c.timezone_offset, c.expires_at, u.status
         FROM telegram_link_codes c
         JOIN users u ON u.id = c.user_id
         WHERE c.code = ?`,
      )
      .get(code) as TelegramCodeRow | undefined;
    if (!row || row.expires_at <= now) {
      if (row) this.db.prepare('DELETE FROM telegram_link_codes WHERE code = ?').run(code);
      await this.sendMessage(chatId, 'Ссылка устарела. Создай новую в настройках WakanDa.');
      return;
    }
    if (row.status !== 'approved') {
      this.db.prepare('DELETE FROM telegram_link_codes WHERE code = ?').run(code);
      await this.sendMessage(chatId, 'Доступ к WakanDa заблокирован администратором.');
      return;
    }

    const owner = this.db
      .prepare('SELECT user_id FROM telegram_links WHERE chat_id = ?')
      .get(chatId) as { user_id: string } | undefined;
    if (owner && owner.user_id !== row.user_id) {
      await this.sendMessage(chatId, 'Этот Telegram уже привязан к другому аккаунту WakanDa.');
      return;
    }

    const username = normalizeTelegramUsername(message.from?.username ?? message.chat?.username);
    const write = this.db.transaction(() => {
      // Один пользователь — один Telegram: при переподключении старый чат
      // отвязывается, чтобы уведомления не уходили в два места.
      this.db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(row.user_id);
      this.db
        .prepare(
          `INSERT INTO telegram_links (user_id, chat_id, username, timezone_offset, linked_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             chat_id = excluded.chat_id,
             username = excluded.username,
             timezone_offset = excluded.timezone_offset,
             linked_at = excluded.linked_at`,
        )
        .run(row.user_id, chatId, username, row.timezone_offset, now);
      this.db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?').run(row.user_id);
      this.db.prepare('DELETE FROM telegram_link_codes WHERE code = ?').run(code);
    });
    write();

    await this.sendMessage(
      chatId,
      `Готово! Telegram подключён к WakanDa.\n\n${startText(true)}`,
      mainMenuKeyboard(),
    );
  }

  private async handleToday(chatId: string) {
    const link = this.linkForChat(chatId);
    if (!link) {
      await this.sendMessage(chatId, connectHint());
      return;
    }
    if (!this.state) {
      await this.sendMessage(chatId, 'Данные привычек пока недоступны. Попробуй позже.');
      return;
    }
    const state = this.state.loadForUser(link.user_id);
    const { dateKey } = localDateParts(new Date(), link.timezone_offset);
    await this.sendMessage(chatId, todayText(state, dateKey, link.timezone_offset), mainMenuKeyboard());
  }

  private async handleTasks(chatId: string) {
    const link = this.linkForChat(chatId);
    if (!link) {
      await this.sendMessage(chatId, connectHint());
      return;
    }
    if (!this.state) {
      await this.sendMessage(chatId, 'Данные задач пока недоступны. Попробуй позже.');
      return;
    }
    const state = this.state.loadForUser(link.user_id);
    const { dateKey } = localDateParts(new Date(), link.timezone_offset);
    await this.sendMessage(chatId, tasksText(state, dateKey, link.timezone_offset), mainMenuKeyboard());
  }

  private async handleStatus(chatId: string) {
    const link = this.linkForChat(chatId);
    if (!link) {
      await this.sendMessage(chatId, connectHint());
      return;
    }
    const { dateKey } = localDateParts(new Date(), link.timezone_offset);
    const items = this.reminders?.list(link.user_id) ?? [];
    await this.sendMessage(
      chatId,
      statusText({
        username: link.username,
        offsetMinutes: link.timezone_offset,
        state: this.state?.loadForUser(link.user_id) ?? null,
        reminders: items.length,
        dateKey,
      }),
      mainMenuKeyboard(),
    );
  }

  private async handleCallbackQuery(callback: NonNullable<TelegramUpdate['callback_query']>) {
    const chatId = normalizeChatId(callback.message?.chat?.id);
    const data = typeof callback.data === 'string' ? callback.data : '';
    if (!chatId) {
      await this.answerCallbackQuery(callback.id);
      return;
    }

    const link = this.linkForChat(chatId);

    if (link && link.status !== 'approved') {
      await this.answerCallbackQuery(callback.id, 'Доступ к WakanDa заблокирован');
      await this.sendMessage(chatId, 'Доступ к WakanDa заблокирован администратором. Отключить уведомления: /stop');
      return;
    }

    if (data.startsWith('menu:')) {
      await this.answerCallbackQuery(callback.id);
      await this.handleMenu(chatId, data.slice('menu:'.length));
      return;
    }

    if (data.startsWith('rem:snooze:')) {
      if (!link) {
        await this.answerCallbackQuery(callback.id, 'Сначала подключи Telegram');
        await this.sendMessage(chatId, connectHint());
        return;
      }
      if (!this.reminders) {
        await this.answerCallbackQuery(callback.id, 'Напоминания недоступны');
        return;
      }
      const id = data.slice('rem:snooze:'.length).trim();
      const reminder = id ? this.reminders.snooze(link.user_id, id, 10) : null;
      await this.answerCallbackQuery(callback.id, reminder ? 'Напомню через 10 минут' : 'Напоминание уже удалено');
      const messageId = callback.message?.message_id;
      const original = clipTelegramText(callback.message?.text, MAX_MESSAGE_LENGTH);
      if (reminder && messageId && original) {
        await this.editMessageText(chatId, messageId, `${original}\n\n⏰ Отложено на 10 минут`, {
          inline_keyboard: [],
        });
      }
      return;
    }

    if (data.startsWith('rem:del:')) {
      if (!link) {
        await this.answerCallbackQuery(callback.id, 'Сначала подключи Telegram');
        await this.sendMessage(chatId, connectHint());
        return;
      }
      if (!this.reminders) {
        await this.answerCallbackQuery(callback.id, 'Напоминания недоступны');
        return;
      }
      const id = data.slice('rem:del:'.length).trim();
      const removed = id ? this.reminders.remove(link.user_id, id) : { removed: 0 };
      await this.answerCallbackQuery(callback.id, removed.removed ? 'Напоминание удалено' : 'Уже удалено');
      const view = remindersText(this.reminders.list(link.user_id), link.timezone_offset);
      const messageId = callback.message?.message_id;
      if (messageId) await this.editMessageText(chatId, messageId, view.text, view.keyboard);
      else await this.sendMessage(chatId, view.text, view.keyboard);
      return;
    }

    await this.answerCallbackQuery(callback.id);
  }

  private async handleMenu(chatId: string, view: string) {
    switch (view) {
      case 'home':
        await this.sendMessage(chatId, startText(Boolean(this.linkForChat(chatId))), mainMenuKeyboard());
        return;
      case 'help':
        await this.sendMessage(chatId, HELP_TEXT, mainMenuKeyboard());
        return;
      case 'today':
        await this.handleToday(chatId);
        return;
      case 'tasks':
        await this.handleTasks(chatId);
        return;
      case 'status':
        await this.handleStatus(chatId);
        return;
      case 'reminders':
        await this.handleReminderList(chatId, '');
        return;
      default:
        await this.sendMessage(chatId, 'Кнопка устарела. Открой /help.', mainMenuKeyboard());
    }
  }

  private async handleReminderCreate(chatId: string, text: string) {
    const link = this.linkForChat(chatId);
    if (!link) {
      await this.sendMessage(chatId, 'Сначала подключи Telegram в настройках WakanDa — тогда я смогу создавать напоминания.');
      return;
    }
    if (!this.reminders) {
      await this.sendMessage(chatId, 'Напоминания на сервере пока недоступны.');
      return;
    }
    try {
      const reminder = this.reminders.createFromText(link.user_id, text, link.timezone_offset);
      await this.sendMessage(
        chatId,
        `Напоминание создано: ${formatReminderLocalDate(reminder.dueAt, reminder.timezoneOffset)}\n${reminder.text}\n\nСписок и удаление: /reminders`,
        mainMenuKeyboard(),
      );
    } catch (error) {
      const message = error instanceof BadRequestException ? error.message : 'Не удалось создать напоминание.';
      await this.sendMessage(chatId, message);
    }
  }

  private async handleReminderList(chatId: string, args: string) {
    const link = this.linkForChat(chatId);
    if (!link) {
      await this.sendMessage(chatId, connectHint());
      return;
    }
    if (!this.reminders) {
      await this.sendMessage(chatId, 'Напоминания на сервере пока недоступны.');
      return;
    }

    const items = this.reminders.list(link.user_id);
    const trimmed = args.trim();
    if (trimmed) {
      const match = /^(?:(?:delete|del|remove|удалить|удали)\s+)?(\d{1,3})$/i.exec(trimmed);
      const index = match ? Number(match[1]) - 1 : -1;
      const target = index >= 0 ? items[index] : undefined;
      if (!target) {
        await this.sendMessage(
          chatId,
          `Не нашёл напоминание «${clipTelegramText(trimmed, 30)}».\nПосмотри номера в /reminders и повтори, например: /reminders 2`,
        );
        return;
      }
      this.reminders.remove(link.user_id, target.id);
      const view = remindersText(this.reminders.list(link.user_id), link.timezone_offset);
      await this.sendMessage(
        chatId,
        `🗑 Удалено: ${formatReminderLocalDate(target.dueAt, target.timezoneOffset)} — ${target.text}\n\n${view.text}`,
        view.keyboard,
      );
      return;
    }

    const view = remindersText(items, link.timezone_offset);
    await this.sendMessage(chatId, view.text, view.keyboard);
  }

  private linkForUser(userId: string): TelegramLinkRow | undefined {
    return this.db
      .prepare(
        `SELECT tl.user_id, tl.chat_id, tl.username, tl.timezone_offset, tl.linked_at, u.status
         FROM telegram_links tl
         JOIN users u ON u.id = tl.user_id
         WHERE tl.user_id = ?`,
      )
      .get(userId) as TelegramLinkRow | undefined;
  }

  private linkForChat(chatId: string): TelegramLinkRow | undefined {
    return this.db
      .prepare(
        `SELECT tl.user_id, tl.chat_id, tl.username, tl.timezone_offset, tl.linked_at, u.status
         FROM telegram_links tl
         JOIN users u ON u.id = tl.user_id
         WHERE tl.chat_id = ?`,
      )
      .get(chatId) as TelegramLinkRow | undefined;
  }

  private cleanExpiredCodes() {
    this.db.prepare('DELETE FROM telegram_link_codes WHERE expires_at <= ?').run(new Date().toISOString());
  }

  private async resolveBotIdentity() {
    const me = await this.callApi<BotIdentity>('getMe');
    const resolved = normalizeBotUsername(me?.username);
    if (resolved) {
      this.botUsername = resolved;
      logger.info({ botUsername: resolved }, 'telegram bot ready');
    } else if (!this.botUsername) {
      logger.warn('telegram bot token is set, but getMe did not return a username');
    }
  }

  /** Меню команд в клиенте Telegram — бот становится понятнее без /help. */
  private async registerCommands() {
    const registered = await this.callApi<boolean>('setMyCommands', { commands: TELEGRAM_BOT_COMMANDS });
    if (!registered) logger.warn('telegram setMyCommands failed; commands menu may be stale');
  }

  private async sendMessage(
    chatId: string,
    text: string,
    keyboard?: TelegramKeyboard,
  ): Promise<boolean> {
    if (!this.configured) return false;
    const result = await this.callApi<{ message_id?: number }>('sendMessage', {
      chat_id: chatId,
      text: clipTelegramText(text, MAX_MESSAGE_LENGTH),
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    return Boolean(result);
  }

  private async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    keyboard?: TelegramKeyboard,
  ): Promise<void> {
    if (!this.configured) return;
    await this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: clipTelegramText(text, MAX_MESSAGE_LENGTH),
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  private async answerCallbackQuery(id: string | undefined, text = ''): Promise<void> {
    if (!id) return;
    await this.callApi('answerCallbackQuery', {
      callback_query_id: id,
      ...(text ? { text: clipTelegramText(text, 200) } : {}),
    });
  }

  private async callApi<T>(
    method: string,
    payload?: Record<string, unknown>,
    timeoutMs = TELEGRAM_API_TIMEOUT_MS,
    abort?: AbortSignal,
  ): Promise<T | null> {
    if (!this.token) return null;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
    try {
      const response = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal,
      });
      const data = (await response.json().catch(() => null)) as TelegramApiEnvelope<T> | null;
      if (!response.ok || !data?.ok) {
        // В URL есть токен, поэтому в лог пишем только метод и безопасное описание.
        logger.warn({ method, status: response.status, description: data?.description }, 'telegram api rejected request');
        return null;
      }
      return data.result ?? null;
    } catch (error) {
      logger.warn({ err: error, method }, 'telegram api request failed');
      return null;
    }
  }
}
