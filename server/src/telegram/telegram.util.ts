// Чистые помощники Telegram-интеграции: их удобно тестировать отдельно от
// Nest, базы и сетевых вызовов.

export const TELEGRAM_LINK_TTL_MS = 10 * 60 * 1000;
export const TELEGRAM_CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const BOT_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const CHAT_ID_RE = /^-?\d{1,20}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Приводит имя бота к виду без @, t.me/ и https://t.me/.
 * Некорректное значение превращается в пустую строку: тогда интеграция
 * считается ненастроенной, а не пытается собирать опасную ссылку.
 */
export function normalizeBotUsername(value: unknown): string {
  if (typeof value !== 'string') return '';
  let username = value.trim();
  username = username.replace(/^https?:\/\/t(?:elegram)?\.me\//i, '');
  username = username.replace(/^t\.me\//i, '');
  username = username.replace(/^@/, '');
  return BOT_USERNAME_RE.test(username) ? username : '';
}

/** Telegram присылает chat.id числом; для БД храним строкой. */
export function normalizeChatId(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return CHAT_ID_RE.test(raw) ? raw : null;
}

/** Имя пользователя Telegram без @; хранится только для показа в настройках. */
export function normalizeTelegramUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim().replace(/^@/, '');
  return USERNAME_RE.test(username) ? username : null;
}

/**
 * Разбирает команду `/start <code>` (в том числе `/start@my_bot <code>`).
 * null — это не /start, пустая строка — /start без кода.
 */
export function parseTelegramStart(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const match = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/i.exec(text.trim());
  if (!match) return null;
  const code = (match[1] || '').trim();
  if (!code) return '';
  return code.length <= 64 ? code : code.slice(0, 64);
}

/** Команда отключения уведомлений из чата. */
export function isTelegramStopCommand(text: unknown): boolean {
  return typeof text === 'string' && /^\/stop(?:@[A-Za-z0-9_]+)?\s*$/i.test(text.trim());
}

export type ParsedTelegramCommand = {
  name: string;
  args: string;
};

/**
 * Разбирает `/today`, `/reminders@my_bot 2` и подобные команды.
 * null — обычный текст или фраза «Напомни мне …».
 */
export function parseTelegramCommand(text: unknown): ParsedTelegramCommand | null {
  if (typeof text !== 'string') return null;
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

/** Меню команд, которое Telegram показывает по кнопке «/». */
export const TELEGRAM_BOT_COMMANDS = [
  { command: 'start', description: 'Открыть меню WakanDa' },
  { command: 'today', description: 'Что осталось на сегодня' },
  { command: 'tasks', description: 'Активные разовые задачи' },
  { command: 'reminders', description: 'Мои напоминания и удаление' },
  { command: 'remind', description: 'Создать напоминание' },
  { command: 'status', description: 'Статус подключения и настройки' },
  { command: 'help', description: 'Все команды и примеры' },
  { command: 'stop', description: 'Отключить уведомления' },
] as const;

export const TELEGRAM_WEBHOOK_PATH = '/api/telegram/webhook';

/**
 * Собирает URL вебхука из настройки: принимаем и готовый URL вебхука, и базовый
 * адрес сайта (`https://example.com` или просто `example.com`).
 *
 * Telegram принимает только https без учётных данных в адресе, поэтому при
 * любом другом значении возвращаем пустую строку — тогда сервер работает через
 * long polling вместо того, чтобы молча не получать команды привязки.
 */
export function resolveTelegramWebhookUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return '';
  const path = url.pathname.replace(/\/+$/, '');
  const suffix = path.toLowerCase().endsWith(TELEGRAM_WEBHOOK_PATH) ? '' : TELEGRAM_WEBHOOK_PATH;
  return `https://${url.host}${path}${suffix}`;
}

/**
 * Следующий offset для getUpdates: Telegram отдаёт каждое событие один раз и
 * ждёт от нас id последнего обработанного апдейта + 1.
 */
export function nextUpdateOffset(updateIds: readonly (number | undefined)[], current: number): number {
  let max = current;
  for (const id of updateIds) {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id + 1 > max) max = id + 1;
  }
  return max;
}

/** Безопасно обрезает пользовательский текст для сообщения бота. */
export function clipTelegramText(value: unknown, limit = 4096): string {
  if (typeof value !== 'string') return '';
  // Контрольные символы вырезаются намеренно: они портят сообщение в чате.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, limit);
}
