import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { normalizeTimezoneOffset } from '../push/push.util';
import {
  MAX_ACTIVE_REMINDERS,
  MAX_REMINDER_TEXT_LENGTH,
  REMINDER_DELIVERY_GRACE_MS,
  parseReminderText,
  resolveReminderParts,
} from './reminders.util';

type ReminderRow = {
  id: string;
  user_id: string;
  text: string;
  due_at: string;
  timezone_offset: number;
  created_at: string;
  sent_at: string | null;
};

type DueReminderRow = {
  id: string;
  user_id: string;
  text: string;
};

export type Reminder = {
  id: string;
  text: string;
  dueAt: string;
  timezoneOffset: number;
  createdAt: string;
  sentAt: string | null;
};

export type CreateReminderInput = {
  text?: unknown;
  date?: unknown;
  time?: unknown;
  timezoneOffset?: unknown;
};

const MAX_LIST_LENGTH = 100;
const SENT_RETENTION_DAYS = 90;
const UNSENT_RETENTION_DAYS = 7;

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    text: row.text,
    dueAt: row.due_at,
    timezoneOffset: row.timezone_offset,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_REMINDER_TEXT_LENGTH);
}

/**
 * Пользовательские напоминания на конкретную дату и время.
 * Хранятся отдельно от ежедневной настройки «Время напоминания»: таких
 * напоминаний может быть сколько угодно (в пределах лимита), и каждое
 * отправляется один раз.
 */
@Injectable()
export class RemindersService {
  private readonly db: Database.Database;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
  }

  create(userId: string, input: CreateReminderInput): Reminder {
    const text = normalizeText(input?.text);
    if (!text) throw new BadRequestException('Напиши, о чём напомнить');

    const offset = normalizeTimezoneOffset(input?.timezoneOffset);
    const parsed = resolveReminderParts(input?.date, input?.time, new Date(), offset);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    return this.insert(userId, text, parsed.value.dueAt, offset);
  }

  createFromText(userId: string, rawText: string, timezoneOffset: unknown, now = new Date()): Reminder {
    const offset = normalizeTimezoneOffset(timezoneOffset);
    const parsed = parseReminderText(rawText, now, offset);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    return this.insert(userId, parsed.value.text, parsed.value.dueAt, offset);
  }

  list(userId: string): Reminder[] {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, text, due_at, timezone_offset, created_at, sent_at
         FROM reminders
         WHERE user_id = ? AND sent_at IS NULL
         ORDER BY due_at ASC
         LIMIT ?`,
      )
      .all(userId, MAX_LIST_LENGTH) as ReminderRow[];
    return rows.map(toReminder);
  }

  remove(userId: string, id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new BadRequestException('Не указано напоминание');
    const removed = this.db
      .prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?')
      .run(id.trim(), userId);
    return { ok: true, removed: removed.changes };
  }

  /** Напоминания, которым пора уходить. Старше grace-окна не догоняем. */
  due(now = new Date()): Array<{ id: string; userId: string; text: string }> {
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() - REMINDER_DELIVERY_GRACE_MS).toISOString();
    const rows = this.db
      .prepare(
        `SELECT r.id, r.user_id, r.text
         FROM reminders r
         JOIN users u ON u.id = r.user_id
         WHERE r.sent_at IS NULL
           AND u.status = 'approved'
           AND r.due_at <= ?
           AND r.due_at >= ?
         ORDER BY r.due_at ASC
         LIMIT 200`,
      )
      .all(nowIso, cutoff) as DueReminderRow[];
    return rows.map((row) => ({ id: row.id, userId: row.user_id, text: row.text }));
  }

  markSent(id: string, now = new Date()): void {
    this.db
      .prepare('UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL')
      .run(now.toISOString(), id);
  }

  /**
   * Отложить напоминание из Telegram. Двигаем срок и снимаем отметку отправки,
   * чтобы планировщик снова увидел его через указанное число минут.
   */
  snooze(userId: string, id: string, minutes = 10, now = new Date()): Reminder | null {
    if (typeof id !== 'string' || !id.trim()) return null;
    const delay = Number.isFinite(minutes) ? Math.min(Math.max(Math.round(minutes), 1), 24 * 60) : 10;
    const dueAt = new Date(now.getTime() + delay * 60_000).toISOString();
    const updated = this.db
      .prepare('UPDATE reminders SET due_at = ?, sent_at = NULL WHERE id = ? AND user_id = ?')
      .run(dueAt, id.trim(), userId);
    if (!updated.changes) return null;
    const row = this.db
      .prepare(
        `SELECT id, user_id, text, due_at, timezone_offset, created_at, sent_at
         FROM reminders WHERE id = ? AND user_id = ?`,
      )
      .get(id.trim(), userId) as ReminderRow | undefined;
    return row ? toReminder(row) : null;
  }

  prune(now = new Date()): void {
    const sentCutoff = new Date(now.getTime() - SENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const unsentCutoff = new Date(now.getTime() - UNSENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.db
      .prepare('DELETE FROM reminders WHERE sent_at IS NOT NULL AND sent_at < ?')
      .run(sentCutoff);
    this.db
      .prepare('DELETE FROM reminders WHERE sent_at IS NULL AND due_at < ?')
      .run(unsentCutoff);
  }

  private insert(userId: string, text: string, dueAt: Date, timezoneOffset: number): Reminder {
    const active = this.db
      .prepare('SELECT COUNT(*) AS count FROM reminders WHERE user_id = ? AND sent_at IS NULL')
      .get(userId) as { count: number };
    if (active.count >= MAX_ACTIVE_REMINDERS) {
      throw new BadRequestException(`Слишком много напоминаний — максимум ${MAX_ACTIVE_REMINDERS}`);
    }

    const row: ReminderRow = {
      id: randomUUID(),
      user_id: userId,
      text,
      due_at: dueAt.toISOString(),
      timezone_offset: timezoneOffset,
      created_at: new Date().toISOString(),
      sent_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO reminders (id, user_id, text, due_at, timezone_offset, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(row.id, row.user_id, row.text, row.due_at, row.timezone_offset, row.created_at);
    return toReminder(row);
  }
}
