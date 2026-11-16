import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RemindersService } from '../src/reminders/reminders.service';
import { StateService } from '../src/state/state.service';
import { TelegramService } from '../src/telegram/telegram.service';

type ApiCall = { method: string; payload?: Record<string, unknown> };

const opened: Array<{ database: DatabaseService; dir: string }> = [];

function makeDatabase(dir = mkdtempSync(join(tmpdir(), 'wakanda-telegram-'))): DatabaseService {
  process.env.WAKANDA_DATA_DIR = dir;
  const database = new DatabaseService();
  opened.push({ database, dir });
  database.connection
    .prepare('INSERT OR IGNORE INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('user-1', 'user-1', 'hash', 'user', 'approved', new Date().toISOString());
  return database;
}

/**
 * Подменяет api.telegram.org: ответы по методам задаются через results, а
 * getUpdates после первой отдачи возвращает ошибку — иначе цикл опроса не
 * останавливался бы и крутился бы до конца теста.
 */
function stubTelegramApi(results: Record<string, unknown> = {}): ApiCall[] {
  const calls: ApiCall[] = [];
  let pollRounds = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: { body?: string }) => {
      const url = String(input);
      const method = url.slice(url.lastIndexOf('/') + 1);
      const payload = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ method, payload });
      if (method === 'getUpdates' && pollRounds++ > 0) {
        return new Response(JSON.stringify({ ok: false, description: 'stopped for the test' }), { status: 409 });
      }
      const result = results[method] ?? true;
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }),
  );
  return calls;
}

function configuredEnv() {
  process.env.WAKANDA_TELEGRAM_BOT_TOKEN = '123456:TEST-TOKEN';
  process.env.WAKANDA_TELEGRAM_BOT_USERNAME = 'wakanda_bot';
  delete process.env.WAKANDA_TELEGRAM_WEBHOOK_URL;
  delete process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET;
}

async function linkChat(service: TelegramService, secret = 'test-secret', chatId = 4242): Promise<void> {
  const link = service.createLink('user-1', 180);
  await service.handleWebhook(secret, {
    update_id: 1,
    message: { text: `/start ${link.code}`, chat: { id: chatId }, from: { username: 'tester' } },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of [
    'WAKANDA_TELEGRAM_BOT_TOKEN',
    'WAKANDA_TELEGRAM_BOT_USERNAME',
    'WAKANDA_TELEGRAM_WEBHOOK_URL',
    'WAKANDA_TELEGRAM_WEBHOOK_SECRET',
  ]) {
    delete process.env[key];
  }
  for (const entry of opened.splice(0)) {
    entry.database.onModuleDestroy();
    rmSync(entry.dir, { recursive: true, force: true });
  }
});

describe('запуск бота', () => {
  it('регистрирует вебхук с секретом, когда задан публичный адрес', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_URL = 'https://wakanda.example.com';
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = 'test-secret';
    const service = new TelegramService(makeDatabase());
    const calls = stubTelegramApi({ getMe: { username: 'wakanda_bot' } });

    service.onModuleInit();
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'setWebhook')).toBe(true));

    const webhook = calls.find((call) => call.method === 'setWebhook');
    expect(webhook?.payload).toMatchObject({
      url: 'https://wakanda.example.com/api/telegram/webhook',
      secret_token: 'test-secret',
    });
    expect(calls.some((call) => call.method === 'getUpdates')).toBe(false);
    expect(calls.find((call) => call.method === 'setMyCommands')?.payload).toMatchObject({
      commands: expect.arrayContaining([expect.objectContaining({ command: 'today' })]),
    });
    expect(service.status('user-1').webhookReady).toBe(true);

    service.onModuleDestroy();
  });

  it('без публичного адреса опрашивает Telegram через getUpdates', async () => {
    configuredEnv();
    const service = new TelegramService(makeDatabase());
    const calls = stubTelegramApi({
      getMe: { username: 'wakanda_bot' },
      getUpdates: [
        { update_id: 7, message: { text: '/start', chat: { id: 111 }, from: { username: 'tester' } } },
        {
          update_id: 8,
          callback_query: {
            id: 'poll-callback',
            data: 'menu:help',
            message: { message_id: 5, chat: { id: 111 } },
          },
        },
      ],
    });

    service.onModuleInit();
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'getUpdates')).toBe(true));

    const poll = calls.find((call) => call.method === 'getUpdates');
    expect(poll?.payload).toMatchObject({ offset: 0, allowed_updates: ['message', 'callback_query'] });
    // Сообщение и callback обрабатываются, а offset передан дальше — повторной доставки не будет.
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'sendMessage')).toBe(true));
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === 'answerCallbackQuery')?.payload?.callback_query_id).toBe(
        'poll-callback',
      ),
    );
    expect(service.status('user-1').webhookReady).toBe(true);

    service.onModuleDestroy();
  });

  it('не включает вебхук без секрета, иначе привязку можно подделать', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_URL = 'https://wakanda.example.com';
    const service = new TelegramService(makeDatabase());
    const calls = stubTelegramApi({ getMe: { username: 'wakanda_bot' } });

    service.onModuleInit();
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'getUpdates')).toBe(true));

    expect(calls.some((call) => call.method === 'setWebhook')).toBe(false);

    service.onModuleDestroy();
  });
});

describe('привязка через /start <code>', () => {
  const secret = 'test-secret';

  it('связывает чат с пользователем и отвечает в чат', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const service = new TelegramService(makeDatabase());
    const calls = stubTelegramApi();

    const link = service.createLink('user-1', 180);
    expect(link.deepLink).toBe(`https://t.me/wakanda_bot?start=${link.code}`);

    await service.handleWebhook(secret, {
      update_id: 1,
      message: { text: `/start ${link.code}`, chat: { id: 4242 }, from: { username: 'tester' } },
    });

    expect(service.status('user-1')).toMatchObject({
      linked: true,
      telegramUsername: 'tester',
      botUsername: 'wakanda_bot',
    });
    const sent = calls.find((call) => call.method === 'sendMessage');
    expect(String(sent?.payload?.text)).toContain('Готово');
    expect(sent?.payload?.chat_id).toBe('4242');
  });

  it('отвязывает чат по команде /stop', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const service = new TelegramService(makeDatabase());
    stubTelegramApi();

    const link = service.createLink('user-1', 180);
    await service.handleWebhook(secret, {
      update_id: 1,
      message: { text: `/start ${link.code}`, chat: { id: 4242 }, from: { username: 'tester' } },
    });
    await service.handleWebhook(secret, { update_id: 2, message: { text: '/stop', chat: { id: 4242 } } });

    expect(service.status('user-1').linked).toBe(false);
  });

  it('не принимает запросы с чужим секретом', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const service = new TelegramService(makeDatabase());
    stubTelegramApi();

    await expect(service.handleWebhook('wrong-secret', { message: { text: '/start', chat: { id: 1 } } })).rejects.toThrow();
    expect(service.status('user-1').linked).toBe(false);
  });
});

describe('напоминания в чате', () => {
  const secret = 'test-secret';

  it('создаёт несколько напоминаний по фразе «Напомни мне …» и показывает их', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const service = new TelegramService(database, new RemindersService(database));
    const calls = stubTelegramApi();

    const link = service.createLink('user-1', 180);
    await service.handleWebhook(secret, {
      update_id: 1,
      message: { text: `/start ${link.code}`, chat: { id: 4242 }, from: { username: 'tester' } },
    });

    await service.handleWebhook(secret, {
      update_id: 2,
      message: { text: 'Напомни мне проверить отчёт 01.10 в 21:00', chat: { id: 4242 } },
    });
    await service.handleWebhook(secret, {
      update_id: 3,
      message: { text: '/remind 25.12 09:00 купить подарки', chat: { id: 4242 } },
    });

    const rows = database.connection
      .prepare('SELECT text FROM reminders WHERE user_id = ? ORDER BY due_at')
      .all('user-1') as Array<{ text: string }>;
    expect(rows.map((row) => row.text).sort()).toEqual(['купить подарки', 'проверить отчёт']);
    expect(calls.filter((call) => call.method === 'sendMessage').some((call) => String(call.payload?.text).includes('Напоминание создано'))).toBe(true);

    await service.handleWebhook(secret, { update_id: 4, message: { text: '/reminders', chat: { id: 4242 } } });
    const listReply = calls.filter((call) => call.method === 'sendMessage').at(-1);
    expect(String(listReply?.payload?.text)).toContain('проверить отчёт');
    expect(String(listReply?.payload?.text)).toContain('купить подарки');
  });

  it('подсказывает формат, если не хватает времени', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const service = new TelegramService(database, new RemindersService(database));
    const calls = stubTelegramApi();

    const link = service.createLink('user-1', 180);
    await service.handleWebhook(secret, {
      update_id: 1,
      message: { text: `/start ${link.code}`, chat: { id: 4242 }, from: { username: 'tester' } },
    });
    await service.handleWebhook(secret, {
      update_id: 2,
      message: { text: 'Напомни мне проверить отчёт 01.10', chat: { id: 4242 } },
    });

    const reply = calls.filter((call) => call.method === 'sendMessage').at(-1);
    expect(String(reply?.payload?.text)).toMatch(/время/i);
  });

  it('не создаёт дубль, если Telegram повторил webhook с тем же update_id', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const reminders = new RemindersService(database);
    const service = new TelegramService(database, reminders);
    stubTelegramApi();
    await linkChat(service);

    const update = {
      update_id: 2,
      message: { text: 'Напомни мне проверить отчёт 01.10.2030 в 21:00', chat: { id: 4242 } },
    };
    await service.handleWebhook(secret, update);
    await service.handleWebhook(secret, update);

    expect(reminders.list('user-1')).toHaveLength(1);
  });

  it('помнит последний update_id после перезапуска сервиса', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const dir = mkdtempSync(join(tmpdir(), 'wakanda-telegram-restart-'));
    const firstDb = makeDatabase(dir);
    const firstReminders = new RemindersService(firstDb);
    const first = new TelegramService(firstDb, firstReminders);
    stubTelegramApi();
    await linkChat(first);

    const update = {
      update_id: 2,
      message: { text: 'Напомни мне проверить отчёт 01.10.2030 в 21:00', chat: { id: 4242 } },
    };
    await first.handleWebhook(secret, update);
    expect(firstReminders.list('user-1')).toHaveLength(1);

    firstDb.onModuleDestroy();
    opened.splice(
      opened.findIndex((entry) => entry.database === firstDb),
      1,
    );

    const secondDb = makeDatabase(dir);
    const secondReminders = new RemindersService(secondDb);
    const second = new TelegramService(secondDb, secondReminders);
    stubTelegramApi();
    await second.handleWebhook(secret, update);

    expect(secondReminders.list('user-1')).toHaveLength(1);
  });
});

describe('доступ заблокированного пользователя', () => {
  const secret = 'test-secret';

  it('не даёт заблокированному чату создавать напоминания и отправлять уведомления', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const reminders = new RemindersService(database);
    const service = new TelegramService(database, reminders);
    const calls = stubTelegramApi();
    await linkChat(service);

    database.connection.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run('user-1');
    await service.handleWebhook(secret, {
      update_id: 2,
      message: { text: 'Напомни мне проверить отчёт 01.10.2030 в 21:00', chat: { id: 4242 } },
    });

    expect(reminders.list('user-1')).toHaveLength(0);
    const reply = String(calls.filter((call) => call.method === 'sendMessage').at(-1)?.payload?.text);
    expect(reply).toContain('заблокирован');
    await expect(service.sendToUser('user-1', 'не должно уйти')).resolves.toBe(false);
  });
});

describe('команды и меню бота', () => {
  const secret = 'test-secret';

  it('показывает сводку на сегодня, задачи и статус', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const state = new StateService(database);
    state.saveForUser('user-1', {
      tasks: [
        { id: 'h1', title: 'Зарядка', history: {} },
        { id: 'h2', title: 'Чтение', history: {} },
      ],
      oneOffTasks: [{ id: 'o1', title: 'Позвонить в банк', done: false, priority: 'high', deadline: '2030-01-01' }],
      reminderEnabled: true,
    });
    const service = new TelegramService(database, new RemindersService(database), state);
    const calls = stubTelegramApi();
    await linkChat(service);

    await service.handleWebhook(secret, { update_id: 2, message: { text: '/today', chat: { id: 4242 } } });
    const today = String(calls.filter((call) => call.method === 'sendMessage').at(-1)?.payload?.text);
    expect(today).toContain('Зарядка');
    expect(today).toContain('Чтение');
    expect(today).toContain('Позвонить в банк');

    await service.handleWebhook(secret, { update_id: 3, message: { text: '/tasks', chat: { id: 4242 } } });
    const tasks = String(calls.filter((call) => call.method === 'sendMessage').at(-1)?.payload?.text);
    expect(tasks).toContain('Позвонить в банк');
    expect(tasks).toContain('высокий приоритет');

    await service.handleWebhook(secret, { update_id: 4, message: { text: '/status', chat: { id: 4242 } } });
    const status = String(calls.filter((call) => call.method === 'sendMessage').at(-1)?.payload?.text);
    expect(status).toContain('UTC+03:00');
    expect(status).toContain('09:00');
  });

  it('показывает кнопки удаления и удаляет напоминание по номеру', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const reminders = new RemindersService(database);
    const service = new TelegramService(database, reminders, new StateService(database));
    const calls = stubTelegramApi();
    await linkChat(service);

    reminders.create('user-1', { text: 'первое', date: '2030-05-10', time: '21:00', timezoneOffset: 180 });
    reminders.create('user-1', { text: 'второе', date: '2030-05-11', time: '21:00', timezoneOffset: 180 });

    await service.handleWebhook(secret, { update_id: 2, message: { text: '/reminders', chat: { id: 4242 } } });
    const list = calls.filter((call) => call.method === 'sendMessage').at(-1);
    expect(String(list?.payload?.text)).toContain('первое');
    expect(String(list?.payload?.text)).toContain('второе');
    expect(list?.payload?.reply_markup).toMatchObject({ inline_keyboard: expect.any(Array) });

    await service.handleWebhook(secret, { update_id: 3, message: { text: '/reminders 1', chat: { id: 4242 } } });
    const afterDelete = calls.filter((call) => call.method === 'sendMessage').at(-1);
    expect(String(afterDelete?.payload?.text)).toContain('Удалено');
    expect(reminders.list('user-1').map((item) => item.text)).toEqual(['второе']);
  });

  it('удаляет напоминание по inline-кнопке и отвечает на callback', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const reminders = new RemindersService(database);
    const service = new TelegramService(database, reminders, new StateService(database));
    const calls = stubTelegramApi();
    await linkChat(service);
    const reminder = reminders.create('user-1', {
      text: 'удалить меня',
      date: '2030-05-10',
      time: '21:00',
      timezoneOffset: 180,
    });

    await service.handleWebhook(secret, {
      update_id: 2,
      callback_query: {
        id: 'callback-1',
        data: `rem:del:${reminder.id}`,
        message: { message_id: 77, chat: { id: 4242 } },
      },
    });

    expect(reminders.list('user-1')).toHaveLength(0);
    expect(calls.find((call) => call.method === 'answerCallbackQuery')?.payload?.text).toBe('Напоминание удалено');
    expect(calls.some((call) => call.method === 'editMessageText')).toBe(true);
  });

  it('откладывает напоминание по кнопке из уведомления', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const reminders = new RemindersService(database);
    const service = new TelegramService(database, reminders, new StateService(database));
    const calls = stubTelegramApi();
    await linkChat(service);
    const reminder = reminders.create('user-1', {
      text: 'перезвонить',
      date: '2030-05-10',
      time: '21:00',
      timezoneOffset: 180,
    });
    reminders.markSent(reminder.id, new Date('2030-05-10T18:00:00.000Z'));

    await service.handleWebhook(secret, {
      update_id: 2,
      callback_query: {
        id: 'callback-2',
        data: `rem:snooze:${reminder.id}`,
        message: {
          message_id: 78,
          text: 'WakanDa — напоминание\nперезвонить',
          chat: { id: 4242 },
        },
      },
    });

    const snoozed = reminders.list('user-1')[0];
    expect(Date.parse(snoozed.dueAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(snoozed.dueAt)).toBeLessThan(Date.parse(reminder.dueAt));
    expect(calls.find((call) => call.method === 'answerCallbackQuery')?.payload?.text).toBe(
      'Напомню через 10 минут',
    );
    expect(calls.find((call) => call.method === 'editMessageText')?.payload).toMatchObject({
      message_id: 78,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it('подсказывает помощь на неизвестную команду', async () => {
    configuredEnv();
    process.env.WAKANDA_TELEGRAM_WEBHOOK_SECRET = secret;
    const database = makeDatabase();
    const service = new TelegramService(database, new RemindersService(database), new StateService(database));
    const calls = stubTelegramApi();
    await linkChat(service);

    await service.handleWebhook(secret, { update_id: 2, message: { text: '/unknown', chat: { id: 4242 } } });
    const reply = String(calls.filter((call) => call.method === 'sendMessage').at(-1)?.payload?.text);
    expect(reply).toContain('Не знаю команду');
    expect(reply).toContain('/help');
  });
});
