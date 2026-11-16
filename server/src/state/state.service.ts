import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../database/settings.service';
import { AppState, DEFAULT_STATE, HabitStatus, StateValidationError, sanitizeAppState } from './state.schema';
import { logger } from '../observability/logger';

export type { AppState } from './state.schema';

// Сколько последних серверных снимков храним на пользователя (ротация).
const HISTORY_LIMIT = 40;
// Автоснимок состояния делается не чаще, чем раз в 10 минут, чтобы не расти в БД.
// Явные снимки (перед импортом/откатом, по кнопке) создаются всегда.
const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

export type SnapshotReason = 'auto' | 'manual' | 'import' | 'restore';

export type StateMeta = {
  updatedAt: string | null;
  revision: number;
};

export type SnapshotMeta = {
  id: number;
  reason: SnapshotReason;
  createdAt: string;
  size: number;
};

@Injectable()
export class StateService {
  private readonly db: Database.Database;
  private readonly settings: SettingsService;

  constructor(
    @Inject(DatabaseService) database: DatabaseService,
    @Optional() @Inject(SettingsService) settings?: SettingsService | null,
  ) {
    this.db = database.connection;
    this.settings = settings ?? new SettingsService(database);
  }

  // ─── Данные конкретного пользователя (JSON-снимок состояния) ───

  loadForUser(userId: string, migrateLegacy = false): AppState {
    const row = this.db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId) as
      | { data: string }
      | undefined;
    if (row) return this.parseState(row.data);
    // Первый вход администратора: переносим старые общие данные в его аккаунт.
    if (migrateLegacy) {
      const legacy = this.load();
      if (!this.isEmptyState(legacy)) {
        try {
          return this.saveForUser(userId, legacy);
        } catch (error) {
          logger.error({ err: error, userId }, 'failed to migrate legacy state to admin account');
        }
      }
    }
    return this.emptyState();
  }

  metaForUser(userId: string): StateMeta {
    const row = this.db.prepare('SELECT updated_at, revision FROM user_state WHERE user_id = ?').get(userId) as
      | { updated_at: string; revision: number }
      | undefined;
    return { updatedAt: row?.updated_at ?? null, revision: row?.revision ?? 0 };
  }

  // Сохраняет состояние, предварительно строго его проверив, и делает снимок
  // предыдущей версии (с ротацией), чтобы данные можно было откатить.
  //
  // baseRevision — версия, которую клиент последний раз видел. Если на сервере
  // уже новее (другая вкладка/устройство), возвращаем 409 с актуальными данными,
  // а не молча затираем чужие правки.
  saveForUser(userId: string, input: unknown, baseRevision?: number | null): AppState {
    const state = this.sanitize(input);
    const previous = this.db.prepare('SELECT data, updated_at, revision FROM user_state WHERE user_id = ?').get(userId) as
      | { data: string; updated_at: string; revision: number }
      | undefined;
    const currentRevision = previous?.revision ?? 0;
    if (baseRevision !== undefined && baseRevision !== null && baseRevision !== currentRevision) {
      throw new ConflictException({
        message: 'Данные уже изменились на другом устройстве',
        state: previous?.data ? this.parseState(previous.data) : this.emptyState(),
        updatedAt: previous?.updated_at ?? null,
        revision: currentRevision,
      });
    }
    const write = this.db.transaction(() => {
      if (previous?.data) this.snapshot(userId, previous.data, 'auto');
      this.writeUserState(userId, state);
    });
    write();
    return state;
  }

  private writeUserState(userId: string, state: AppState) {
    this.db
      .prepare(
        `INSERT INTO user_state (user_id, data, updated_at, revision) VALUES (?, ?, ?, 1)
         ON CONFLICT(user_id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at,
           revision = user_state.revision + 1`,
      )
      .run(userId, JSON.stringify(state), new Date().toISOString());
  }

  private emptyState(): AppState {
    return { ...DEFAULT_STATE, tasks: [], oneOffTasks: [], notes: {} };
  }

  private sanitize(input: unknown): AppState {
    try {
      return sanitizeAppState(input);
    } catch (error) {
      if (error instanceof StateValidationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private parseState(data: string): AppState {
    try {
      return sanitizeAppState(JSON.parse(data));
    } catch {
      return this.emptyState();
    }
  }

  // ─── История серверных снимков ───

  // Делает снимок переданных данных. Автоснимки ограничены по частоте,
  // явные — нет. Одинаковые подряд снимки не дублируются.
  private snapshot(userId: string, data: string, reason: SnapshotReason) {
    if (!data) return;
    const newest = this.db
      .prepare('SELECT data, created_at FROM user_state_history WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(userId) as { data: string; created_at: string } | undefined;
    if (newest) {
      if (newest.data === data) return;
      if (reason === 'auto' && Date.now() - new Date(newest.created_at).getTime() < AUTO_SNAPSHOT_INTERVAL_MS) return;
    }
    this.db
      .prepare('INSERT INTO user_state_history (user_id, data, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, data, reason, new Date().toISOString());
    this.rotateHistory(userId);
  }

  private rotateHistory(userId: string) {
    this.db
      .prepare(
        `DELETE FROM user_state_history
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id FROM user_state_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
           )`,
      )
      .run(userId, userId, HISTORY_LIMIT);
  }

  // Принудительный снимок текущего состояния (перед импортом/откатом, по кнопке).
  snapshotNow(userId: string, reason: SnapshotReason = 'manual'): { ok: true; created: boolean } {
    const row = this.db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId) as
      | { data: string }
      | undefined;
    if (!row?.data) return { ok: true, created: false };
    const before = this.db
      .prepare('SELECT MAX(id) AS id FROM user_state_history WHERE user_id = ?')
      .get(userId) as { id: number | null };
    this.snapshot(userId, row.data, reason);
    const after = this.db
      .prepare('SELECT MAX(id) AS id FROM user_state_history WHERE user_id = ?')
      .get(userId) as { id: number | null };
    return { ok: true, created: (after.id ?? 0) !== (before.id ?? 0) };
  }

  listHistory(userId: string): SnapshotMeta[] {
    const rows = this.db
      .prepare(
        `SELECT id, reason, created_at, length(data) AS size
         FROM user_state_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, HISTORY_LIMIT) as Array<{ id: number; reason: string; created_at: string; size: number }>;
    return rows.map((row) => ({
      id: row.id,
      reason: this.normalizeReason(row.reason),
      createdAt: row.created_at,
      size: row.size,
    }));
  }

  getHistory(userId: string, id: number): SnapshotMeta & { state: AppState } {
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('Некорректный номер снимка');
    const row = this.db
      .prepare('SELECT id, data, reason, created_at FROM user_state_history WHERE id = ? AND user_id = ?')
      .get(id, userId) as { id: number; data: string; reason: string; created_at: string } | undefined;
    if (!row) throw new NotFoundException('Снимок не найден');
    return {
      id: row.id,
      reason: this.normalizeReason(row.reason),
      createdAt: row.created_at,
      size: row.data.length,
      state: this.parseState(row.data),
    };
  }

  restoreHistory(userId: string, id: number): AppState {
    const entry = this.getHistory(userId, id);
    const current = this.db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId) as
      | { data: string }
      | undefined;
    const restore = this.db.transaction(() => {
      if (current?.data) this.snapshot(userId, current.data, 'restore');
      this.writeUserState(userId, entry.state);
    });
    restore();
    return entry.state;
  }

  private normalizeReason(reason: string): SnapshotReason {
    return reason === 'import' || reason === 'restore' || reason === 'manual' ? reason : 'auto';
  }

  private isEmptyState(state: AppState): boolean {
    return (
      !state.tasks.length &&
      !state.oneOffTasks.length &&
      Object.keys(state.notes).length === 0
    );
  }

  // ─── Старые общие данные (нужны только для разовой миграции админу) ───

  load(): AppState {
    const habits = this.db.prepare('SELECT * FROM habits ORDER BY sort_order, title').all() as Array<{
      id: string; title: string; created_at: string | null; schedule: string | null; archived: number;
    }>;
    const historyRows = this.db.prepare('SELECT habit_id, date_key, status FROM habit_history').all() as Array<{
      habit_id: string; date_key: string; status: string;
    }>;
    const historyByHabit = new Map<string, Record<string, HabitStatus>>();
    for (const row of historyRows) {
      const bucket = historyByHabit.get(row.habit_id) ?? {};
      bucket[row.date_key] = row.status as HabitStatus;
      historyByHabit.set(row.habit_id, bucket);
    }

    const oneOffTasks = this.db.prepare('SELECT * FROM one_off_tasks ORDER BY sort_order, created_at').all() as Array<{
      id: string; title: string; done: number; created_at: string | null; deadline: string | null; priority: string;
    }>;
    const noteRows = this.db.prepare('SELECT date_key, text FROM notes').all() as Array<{ date_key: string; text: string }>;
    const notes: Record<string, string> = {};
    for (const row of noteRows) notes[row.date_key] = row.text;

    const setting = (key: string) => this.settings.get(key);

    const reminderTime = setting('reminderTime') || DEFAULT_STATE.reminderTime;
    return {
      version: Number(setting('version')) || DEFAULT_STATE.version,
      tasks: habits.map((habit) => ({
        id: habit.id,
        title: habit.title,
        history: historyByHabit.get(habit.id) ?? {},
        createdAt: habit.created_at ?? undefined,
        schedule: habit.schedule ? habit.schedule.split(',').map(Number).filter((day) => Number.isInteger(day)).filter((day) => day >= 0 && day <= 6) : undefined,
        archived: Boolean(habit.archived),
      })),
      oneOffTasks: oneOffTasks.map((task) => ({
        id: task.id,
        title: task.title,
        done: Boolean(task.done),
        createdAt: task.created_at ?? undefined,
        deadline: task.deadline ?? '',
        priority: task.priority || 'normal',
      })),
      notes,
      theme: setting('theme') === 'light' || setting('theme') === 'dark' ? setting('theme')! : 'dark',
      reminderTimes: [reminderTime],
      reminderTime,
      reminderEnabled: setting('reminderEnabled') === '1',
      lastAutoBackupAt: Number(setting('lastAutoBackupAt')) || 0,
    };
  }
}
