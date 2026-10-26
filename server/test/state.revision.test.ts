import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { StateService } from '../src/state/state.service';

// Сервисы самодостаточны: создаём реальную SQLite в временной папке
// (WAKANDA_DATA_DIR читается конструктором DatabaseService).
const opened: Array<{ database: DatabaseService; dir: string }> = [];
const USER = 'user-revision-test';

function makeService(): { service: StateService; database: DatabaseService } {
  const dir = mkdtempSync(join(tmpdir(), 'wakanda-state-'));
  process.env.WAKANDA_DATA_DIR = dir;
  const database = new DatabaseService();
  opened.push({ database, dir });
  // user_state_history ссылается на users(id) — создаём реального пользователя.
  database.connection
    .prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(USER, USER, 'hash', 'user', 'approved', new Date().toISOString());
  return { service: new StateService(database), database };
}

afterEach(() => {
  for (const entry of opened.splice(0)) {
    entry.database.onModuleDestroy();
    rmSync(entry.dir, { recursive: true, force: true });
  }
});

function stateWith(tasks: Array<{ id: string; title: string }>) {
  return { version: 2, tasks, oneOffTasks: [], notes: {} };
}

function catchConflict(run: () => unknown): ConflictException {
  try {
    run();
  } catch (error) {
    if (error instanceof ConflictException) return error;
    throw error;
  }
  throw new Error('ожидался ConflictException');
}

describe('контракт revision (защита от затирания вкладок)', () => {
  it('новый пользователь начинает с revision 0 и без updatedAt', () => {
    const { service } = makeService();
    expect(service.metaForUser(USER)).toEqual({ updatedAt: null, revision: 0 });
  });

  it('каждая запись увеличивает revision и запоминает updatedAt', () => {
    const { service } = makeService();
    service.saveForUser(USER, stateWith([]), 0);
    expect(service.metaForUser(USER).revision).toBe(1);
    expect(service.metaForUser(USER).updatedAt).toBeTruthy();

    service.saveForUser(USER, stateWith([]), 1);
    expect(service.metaForUser(USER).revision).toBe(2);
  });

  it('запись без baseRevision (старый клиент) не роняет контракт', () => {
    const { service } = makeService();
    service.saveForUser(USER, stateWith([]));
    expect(service.metaForUser(USER).revision).toBe(1);
  });

  it('устаревшая baseRevision даёт 409 с актуальными данными и revision', () => {
    const { service } = makeService();
    service.saveForUser(USER, stateWith([{ id: 'a', title: 'Первая' }]), 0);

    const error = catchConflict(() => service.saveForUser(USER, stateWith([{ id: 'b', title: 'Чужая' }]), 0));

    const body = error.getResponse() as { state: { tasks: Array<{ id: string }> }; updatedAt: string | null; revision: number };
    expect(body.revision).toBe(1);
    expect(body.state.tasks).toEqual([expect.objectContaining({ id: 'a' })]);
    expect(body.updatedAt).toBeTruthy();
    // Конфликт ничего не пишет: revision остаётся прежним.
    expect(service.metaForUser(USER).revision).toBe(1);
    expect(service.loadForUser(USER).tasks[0].id).toBe('a');
  });

  it('невалидное состояние не двигает revision', () => {
    const { service } = makeService();
    service.saveForUser(USER, stateWith([]), 0);
    expect(() => service.saveForUser(USER, { tasks: [{ title: '  ' }] }, 1)).toThrow(BadRequestException);
    expect(service.metaForUser(USER).revision).toBe(1);
  });
});

describe('история снимков', () => {
  it('восстановление пишет версию сервером и увеличивает revision', () => {
    const { service } = makeService();
    service.saveForUser(USER, stateWith([{ id: 'a', title: 'Первая' }]), 0);
    service.saveForUser(USER, stateWith([{ id: 'b', title: 'Вторая' }]), 1);

    const history = service.listHistory(USER);
    expect(history.length).toBeGreaterThanOrEqual(1);

    const restored = service.restoreHistory(USER, history[0].id);
    expect(restored.tasks[0].id).toBe('a');
    expect(service.loadForUser(USER).tasks[0].id).toBe('a');
    expect(service.metaForUser(USER).revision).toBe(3);
  });

  it('чужой или несуществующий снимок недоступен', () => {
    const { service } = makeService();
    service.saveForUser(USER, stateWith([]), 0);
    expect(() => service.getHistory('другой-user', 1)).toThrow(NotFoundException);
    expect(() => service.getHistory(USER, 999999)).toThrow(NotFoundException);
    expect(() => service.getHistory(USER, -5)).toThrow(BadRequestException);
  });
});
