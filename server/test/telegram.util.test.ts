import { describe, expect, it } from 'vitest';
import {
  nextUpdateOffset,
  parseTelegramCommand,
  resolveTelegramWebhookUrl,
  TELEGRAM_BOT_COMMANDS,
} from '../src/telegram/telegram.util';

describe('resolveTelegramWebhookUrl', () => {
  it('дополняет базовый адрес сайта путём вебхука', () => {
    expect(resolveTelegramWebhookUrl('https://wakanda.example.com')).toBe(
      'https://wakanda.example.com/api/telegram/webhook',
    );
    expect(resolveTelegramWebhookUrl('wakanda.example.com/')).toBe(
      'https://wakanda.example.com/api/telegram/webhook',
    );
  });

  it('принимает готовый URL вебхука, в том числе на поддомене пути', () => {
    expect(resolveTelegramWebhookUrl('https://wakanda.example.com/api/telegram/webhook')).toBe(
      'https://wakanda.example.com/api/telegram/webhook',
    );
    expect(resolveTelegramWebhookUrl('https://wakanda.example.com/base/api/telegram/webhook/')).toBe(
      'https://wakanda.example.com/base/api/telegram/webhook',
    );
  });

  it('отбраковывает адреса, с которыми Telegram не зарегистрирует вебхук', () => {
    expect(resolveTelegramWebhookUrl('http://wakanda.example.com')).toBe('');
    expect(resolveTelegramWebhookUrl('https://user:pass@wakanda.example.com')).toBe('');
    expect(resolveTelegramWebhookUrl('not a url')).toBe('');
    expect(resolveTelegramWebhookUrl('   ')).toBe('');
    expect(resolveTelegramWebhookUrl(undefined)).toBe('');
  });

  it('сохраняет порт — локальный проксированный домен тоже рабочий', () => {
    expect(resolveTelegramWebhookUrl('https://127.0.0.1:8443')).toBe('https://127.0.0.1:8443/api/telegram/webhook');
  });
});

describe('nextUpdateOffset', () => {
  it('возвращает id последнего апдейта плюс один', () => {
    expect(nextUpdateOffset([5, 7, 6], 1)).toBe(8);
  });

  it('не откатывает offset при пустом или мусорном ответе', () => {
    expect(nextUpdateOffset([], 42)).toBe(42);
    const garbage = [undefined, '12', Number.NaN] as unknown as (number | undefined)[];
    expect(nextUpdateOffset(garbage, 42)).toBe(42);
  });
});

describe('parseTelegramCommand', () => {
  it('разбирает команду, имя бота и аргументы', () => {
    expect(parseTelegramCommand('/today')).toEqual({ name: 'today', args: '' });
    expect(parseTelegramCommand('/reminders@wakanda_bot 2')).toEqual({ name: 'reminders', args: '2' });
    expect(parseTelegramCommand('/remind 21:00 проверить почту')).toEqual({
      name: 'remind',
      args: '21:00 проверить почту',
    });
  });

  it('не считает командой обычную фразу', () => {
    expect(parseTelegramCommand('Напомни мне позвонить маме')).toBeNull();
    expect(parseTelegramCommand('')).toBeNull();
    expect(parseTelegramCommand(undefined)).toBeNull();
  });

  it('отдаёт непустое меню команд для Telegram', () => {
    expect(TELEGRAM_BOT_COMMANDS.length).toBeGreaterThan(5);
    expect(TELEGRAM_BOT_COMMANDS[0].command).toBe('start');
  });
});
