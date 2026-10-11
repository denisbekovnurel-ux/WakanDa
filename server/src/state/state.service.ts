import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DatabaseService } from '../database/database.service';
import { AppState, DEFAULT_STATE, HabitStatus, StateValidationError, sanitizeAppState } from './state.schema';

export type { AppState } from './state.schema';

// Сколько последних серверных снимков храним на пользователя (ротация).
const HISTORY_LIMIT = 40;
// Автоснимок состояния делается не чаще, чем раз в 10 минут, чтобы не расти в БД.
// Явные снимки (перед импортом/откатом, по кнопке) создаются всегда.
const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

export type SnapshotReason = 'auto' | 'manual' | 'import' | 'restore';

export type SnapshotMeta = {
  id: number;
  reason: SnapshotReason;
  createdAt: string;
  size: number;
};

@Injectable()
export class StateService {
  private readonly db: Database.Database;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.connection;
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
          console.error('Не удалось перенести старые данные в аккаунт администратора:', error);
        }
      }
    }
    return { ...DEFAULT_STATE };
  }

  // Сохраняет состояние, предварительно строго его проверив, и делает снимок
  // предыдущей версии (с ротацией), чтобы данные можно было откатить.
  saveForUser(userId: string, input: unknown): AppState {
    const state = this.sanitize(input);
    const previous = this.db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId) as
      | { data: string }
      | undefined;
    if (previous?.data) this.snapshot(userId, previous.data, 'auto');
    this.writeUserState(userId, state);
    return state;
  }

  updatedAtForUser(userId: string): string | null {
    const row = this.db.prepare('SELECT updated_at FROM user_state WHERE user_id = ?').get(userId) as
      | { updated_at: string }
      | undefined;
    return row?.updated_at ?? null;
  }

  private writeUserState(userId: string, state: AppState) {
    this.db
      .prepare(
        `INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(state), new Date().toISOString());
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
      return { ...DEFAULT_STATE };
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
    if (current?.data) this.snapshot(userId, current.data, 'restore');
    this.writeUserState(userId, entry.state);
    return entry.state;
  }

  private normalizeReason(reason: string): SnapshotReason {
    return reason === 'import' || reason === 'restore' || reason === 'manual' ? reason : 'auto';
  }

  private isEmptyState(state: AppState): boolean {
    return (
      !state.tasks.length &&
      !state.oneOffTasks.length &&
      !state.goals.length &&
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
    const goals = this.db.prepare('SELECT * FROM goals ORDER BY sort_order, created_at').all() as Array<{
      id: string; title: string; unit: string; target: number; daily_rate: number; current: number; created_at: string | null;
    }>;
    const logRows = this.db.prepare('SELECT goal_id, date, amount FROM goal_log ORDER BY id').all() as Array<{
      goal_id: string; date: string; amount: number;
    }>;
    const logByGoal = new Map<string, Array<{ date: string; amount: number }>>();
    for (const row of logRows) {
      const bucket = logByGoal.get(row.goal_id) ?? [];
      bucket.push({ date: row.date, amount: row.amount });
      logByGoal.set(row.goal_id, bucket);
    }
    const noteRows = this.db.prepare('SELECT date_key, text FROM notes').all() as Array<{ date_key: string; text: string }>;
    const notes: Record<string, string> = {};
    for (const row of noteRows) notes[row.date_key] = row.text;

    const setting = (key: string) => {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value;
    };

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
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        unit: goal.unit,
        target: goal.target,
        dailyRate: goal.daily_rate,
        current: goal.current,
        log: logByGoal.get(goal.id) ?? [],
        createdAt: goal.created_at ?? undefined,
      })),
      notes,
      theme: setting('theme') === 'light' || setting('theme') === 'dark' ? setting('theme')! : 'system',
      reminderTime: setting('reminderTime') || '20:00',
      reminderEnabled: setting('reminderEnabled') === '1',
      lastAutoBackupAt: Number(setting('lastAutoBackupAt')) || 0,
    };
  }

  save(input: AppState) {
    const state = { ...DEFAULT_STATE, ...input };
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM habit_history;
        DELETE FROM goal_log;
        DELETE FROM habits;
        DELETE FROM one_off_tasks;
        DELETE FROM goals;
        DELETE FROM notes;
        DELETE FROM settings;
      `);

      const insertHabit = this.db.prepare(
        'INSERT INTO habits (id, title, created_at, schedule, archived, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const insertHistory = this.db.prepare(
        'INSERT INTO habit_history (habit_id, date_key, status) VALUES (?, ?, ?)',
      );
      (state.tasks || []).forEach((task, index) => {
        insertHabit.run(
          task.id,
          task.title,
          task.createdAt ?? null,
          Array.isArray(task.schedule) ? task.schedule.join(',') : null,
          task.archived ? 1 : 0,
          index,
        );
        for (const [dateKey, status] of Object.entries(task.history || {})) {
          insertHistory.run(task.id, dateKey, status);
        }
      });

      const insertOneOff = this.db.prepare(
        'INSERT INTO one_off_tasks (id, title, done, created_at, deadline, priority, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      (state.oneOffTasks || []).forEach((task, index) => {
        insertOneOff.run(task.id, task.title, task.done ? 1 : 0, task.createdAt ?? null, task.deadline || null, task.priority || 'normal', index);
      });

      const insertGoal = this.db.prepare(
        'INSERT INTO goals (id, title, unit, target, daily_rate, current, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insertLog = this.db.prepare('INSERT INTO goal_log (goal_id, date, amount) VALUES (?, ?, ?)');
      (state.goals || []).forEach((goal, index) => {
        insertGoal.run(goal.id, goal.title, goal.unit || 'шт', goal.target, goal.dailyRate, goal.current || 0, goal.createdAt ?? null, index);
        for (const entry of goal.log || []) {
          insertLog.run(goal.id, entry.date, entry.amount);
        }
      });

      const insertNote = this.db.prepare('INSERT INTO notes (date_key, text) VALUES (?, ?)');
      for (const [dateKey, text] of Object.entries(state.notes || {})) {
        if (text?.trim()) insertNote.run(dateKey, text);
      }

      const insertSetting = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      insertSetting.run('version', String(state.version ?? 2));
      insertSetting.run('theme', ['light', 'dark', 'system'].includes(state.theme) ? state.theme : 'system');
      insertSetting.run('reminderTime', state.reminderTime || '20:00');
      insertSetting.run('reminderEnabled', state.reminderEnabled ? '1' : '0');
      insertSetting.run('lastAutoBackupAt', String(state.lastAutoBackupAt || 0));
    });
    tx();
  }
}
