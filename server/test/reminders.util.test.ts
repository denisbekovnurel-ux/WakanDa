import { describe, expect, it } from 'vitest';
import {
  formatReminderLocalDate,
  isReminderListCommand,
  isReminderRequest,
  parseReminderText,
  resolveReminderParts,
} from '../src/reminders/reminders.util';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const OFFSET = 180; // UTC+3

describe('parseReminderText', () => {
  it('разбирает фразу «Напомни мне … 01.10 в 21:00»', () => {
    const result = parseReminderText('Напомни мне позвонить маме в 01.10 в 21:00', NOW, OFFSET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('позвонить маме');
    // 1 октября уже прошло, поэтому без года берём ближайший будущий год.
    expect(result.value.dueAt.toISOString()).toBe('2027-10-01T18:00:00.000Z');
    expect(result.value.time).toBe('21:00');
  });

  it('не путает дату 01.10 со временем 01:10', () => {
    const result = parseReminderText('напомни 01.10 в 21:00 проверить отчёт', NOW, OFFSET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dueAt.toISOString()).toBe('2027-10-01T18:00:00.000Z');
    expect(result.value.text).toBe('проверить отчёт');
  });

  it('понимает относительные даты и команду /remind', () => {
    const tomorrow = parseReminderText('напомни завтра в 09:30 купить хлеб', NOW, OFFSET);
    expect(tomorrow.ok).toBe(true);
    if (tomorrow.ok) {
      expect(tomorrow.value.dueAt.toISOString()).toBe('2026-11-02T06:30:00.000Z');
      expect(tomorrow.value.text).toBe('купить хлеб');
    }

    const command = parseReminderText('/remind 25.12 18:00 подготовить отчёт', NOW, OFFSET);
    expect(command.ok).toBe(true);
    if (command.ok) {
      expect(command.value.dueAt.toISOString()).toBe('2026-12-25T15:00:00.000Z');
      expect(command.value.text).toBe('подготовить отчёт');
    }
  });

  it('понимает месяц словом и явный год', () => {
    const result = parseReminderText('напомни 1 октября 2027 в 09:00 годовщина', NOW, OFFSET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dueAt.toISOString()).toBe('2027-10-01T06:00:00.000Z');
    expect(result.value.text).toBe('годовщина');
  });

  it('объясняет ошибку, если не хватает времени, даты или дата не существует', () => {
    expect(parseReminderText('напомни 01.10', NOW, OFFSET)).toMatchObject({ ok: false, error: expect.stringMatching(/время/i) });
    expect(parseReminderText('напомни 31.02.2027 в 21:00', NOW, OFFSET)).toMatchObject({ ok: false, error: expect.stringMatching(/даты/i) });
    expect(parseReminderText('напомни позвонить маме', NOW, OFFSET)).toMatchObject({ ok: false, error: expect.stringMatching(/дату/i) });
  });

  it('понимает время без даты — сегодня или завтра', () => {
    const today = parseReminderText('напомни в 21:00 проверить почту', NOW, OFFSET);
    expect(today.ok).toBe(true);
    if (today.ok) {
      expect(today.value.dueAt.toISOString()).toBe('2026-11-01T18:00:00.000Z');
      expect(today.value.text).toBe('проверить почту');
    }

    // 09:00 в UTC+3 уже прошло (сейчас 15:00) — переносим на завтра.
    const tomorrow = parseReminderText('напомни в 09:00 зарядка', NOW, OFFSET);
    expect(tomorrow.ok).toBe(true);
    if (tomorrow.ok) {
      expect(tomorrow.value.dueAt.toISOString()).toBe('2026-11-02T06:00:00.000Z');
      expect(tomorrow.value.dateKey).toBe('2026-11-02');
    }
  });

  it('понимает «через 30 минут», «через час» и «через полчаса»', () => {
    const minutes = parseReminderText('напомни через 30 минут позвонить маме', NOW, OFFSET);
    expect(minutes.ok).toBe(true);
    if (minutes.ok) {
      expect(minutes.value.dueAt.toISOString()).toBe('2026-11-01T12:30:00.000Z');
      expect(minutes.value.text).toBe('позвонить маме');
    }

    const hour = parseReminderText('напомни через час выпить воду', NOW, OFFSET);
    expect(hour.ok).toBe(true);
    if (hour.ok) expect(hour.value.dueAt.toISOString()).toBe('2026-11-01T13:00:00.000Z');

    const half = parseReminderText('напомни через полчаса размяться', NOW, OFFSET);
    expect(half.ok).toBe(true);
    if (half.ok) expect(half.value.dueAt.toISOString()).toBe('2026-11-01T12:30:00.000Z');

    // Относительная дата + явное время: «через 2 дня в 10:00».
    const days = parseReminderText('напомни через 2 дня в 10:00 проверить отчёт', NOW, OFFSET);
    expect(days.ok).toBe(true);
    if (days.ok) {
      expect(days.value.dueAt.toISOString()).toBe('2026-11-03T07:00:00.000Z');
      expect(days.value.text).toBe('проверить отчёт');
    }
  });

  it('не создаёт напоминание на прошедшее время с явным годом', () => {
    const result = parseReminderText('напомни 01.10.2026 в 21:00 прошлое', NOW, OFFSET);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/прошло/i) });
  });
});

describe('resolveReminderParts', () => {
  it('переводит локальные дату и время в UTC', () => {
    const result = resolveReminderParts('2026-12-25', '18:00', NOW, OFFSET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dueAt.toISOString()).toBe('2026-12-25T15:00:00.000Z');
  });

  it('отклоняет прошедшее время и некорректные части', () => {
    expect(resolveReminderParts('2026-10-01', '18:00', NOW, OFFSET)).toMatchObject({ ok: false });
    expect(resolveReminderParts('2026-13-01', '18:00', NOW, OFFSET)).toMatchObject({ ok: false });
    expect(resolveReminderParts('2026-12-25', '25:00', NOW, OFFSET)).toMatchObject({ ok: false });
  });
});

describe('вспомогательные команды', () => {
  it('узнаёт запрос напоминания и команду списка', () => {
    expect(isReminderRequest('Напомни мне … 01.10 в 21:00')).toBe(true);
    expect(isReminderRequest('/remind@wakanda_bot 01.10 21:00')).toBe(true);
    expect(isReminderRequest('/reminders')).toBe(false);
    expect(isReminderListCommand('/reminders')).toBe(true);
    expect(isReminderListCommand('/reminders@wakanda_bot')).toBe(true);
  });

  it('форматирует дату в локальном времени пользователя', () => {
    expect(formatReminderLocalDate('2027-10-01T18:00:00.000Z', OFFSET)).toBe('01.10.2027 в 21:00');
  });
});
