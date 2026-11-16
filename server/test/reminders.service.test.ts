import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { RemindersService } from '../src/reminders/reminders.service';

const opened: Array<{ database: DatabaseService; dir: string }> = [];

function makeService(): { service: RemindersService; database: DatabaseService } {
  const dir = mkdtempSync(join(tmpdir(), 'wakanda-reminders-'));
  process.env.WAKANDA_DATA_DIR = dir;
  const database = new DatabaseService();
  opened.push({ database, dir });
  database.connection
    .prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('user-1', 'user-1', 'hash', 'user', 'approved', new Date().toISOString());
  return { service: new RemindersService(database), database };
}

afterEach(() => {
  for (const entry of opened.splice(0)) {
    entry.database.onModuleDestroy();
    rmSync(entry.dir, { recursive: true, force: true });
  }
});

describe('RemindersService', () => {
  it('создаёт несколько напоминаний и возвращает их по времени', () => {
    const { service } = makeService();

    const later = service.create('user-1', {
      text: 'позвонить маме',
      date: '2030-12-10',
      time: '21:00',
      timezoneOffset: 180,
    });
    const sooner = service.createFromText('user-1', 'Напомни мне купить хлеб 01.10 в 09:00', 180, new Date('2029-11-01T12:00:00.000Z'));

    expect(service.list('user-1').map((item) => item.id)).toEqual([sooner.id, later.id]);
    expect(service.list('user-1')).toHaveLength(2);
  });

  it('удаляет только своё напоминание', () => {
    const { service } = makeService();
    service.create('user-1', { text: 'раз', date: '2030-05-10', time: '21:00', timezoneOffset: 0 });
    service.create('user-1', { text: 'два', date: '2030-05-11', time: '21:00', timezoneOffset: 0 });
    const [first] = service.list('user-1');

    expect(service.remove('user-2', first.id)).toEqual({ ok: true, removed: 0 });
    expect(service.remove('user-1', first.id)).toEqual({ ok: true, removed: 1 });
    expect(service.list('user-1')).toHaveLength(1);
  });

  it('отдаёт наступившие напоминания и отмечает отправку', () => {
    const { service, database } = makeService();
    const reminder = service.create('user-1', {
      text: 'пора',
      date: '2030-05-10',
      time: '21:00',
      timezoneOffset: 0,
    });
    const dueAt = new Date(reminder.dueAt);

    expect(service.due(new Date(dueAt.getTime() - 60_000))).toEqual([]);
    expect(service.due(dueAt)).toEqual([{ id: reminder.id, userId: 'user-1', text: 'пора' }]);

    service.markSent(reminder.id, dueAt);
    expect(service.due(new Date(dueAt.getTime() + 60_000))).toEqual([]);
    expect(database.connection.prepare('SELECT sent_at FROM reminders WHERE id = ?').get(reminder.id)).toEqual({
      sent_at: dueAt.toISOString(),
    });
  });

  it('откладывает отправленное напоминание и снова делает его активным', () => {
    const { service } = makeService();
    const reminder = service.create('user-1', {
      text: 'перезвонить',
      date: '2030-05-10',
      time: '21:00',
      timezoneOffset: 0,
    });
    service.markSent(reminder.id, new Date('2030-05-10T21:00:00.000Z'));

    const snoozed = service.snooze('user-1', reminder.id, 10, new Date('2030-05-10T21:05:00.000Z'));
    expect(snoozed?.dueAt).toBe('2030-05-10T21:15:00.000Z');
    expect(service.due(new Date('2030-05-10T21:15:00.000Z'))).toEqual([
      { id: reminder.id, userId: 'user-1', text: 'перезвонить' },
    ]);
    expect(service.snooze('user-2', reminder.id, 10, new Date('2030-05-10T21:20:00.000Z'))).toBeNull();
  });

  it('отклоняет пустой текст и прошедшее время', () => {
    const { service } = makeService();

    expect(() => service.create('user-1', { text: '   ', date: '2030-05-10', time: '21:00' })).toThrow(BadRequestException);
    expect(() => service.create('user-1', { text: 'старое', date: '2020-05-10', time: '21:00' })).toThrow(/прошло/i);
  });
});
