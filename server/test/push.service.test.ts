import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { PushService } from '../src/push/push.service';

const opened: Array<{ database: DatabaseService; dir: string }> = [];

function makeService(): PushService {
  const dir = mkdtempSync(join(tmpdir(), 'wakanda-push-'));
  process.env.WAKANDA_DATA_DIR = dir;
  const database = new DatabaseService();
  opened.push({ database, dir });
  // push_subscriptions ссылается на users(id) — создаём пользователей заранее.
  for (const id of ['user-1', 'user-2']) {
    database.connection
      .prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, id, 'hash', 'user', 'approved', new Date().toISOString());
  }
  return new PushService(database);
}

afterEach(() => {
  delete process.env.WAKANDA_VAPID_PUBLIC;
  delete process.env.WAKANDA_VAPID_PRIVATE;
  delete process.env.WAKANDA_PUSH_HOSTS;
  for (const entry of opened.splice(0)) {
    entry.database.onModuleDestroy();
    rmSync(entry.dir, { recursive: true, force: true });
  }
});

const KEYS = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(32) };

function endpoint(path: string) {
  return `https://127.0.0.1:443/push/${path}`;
}

describe('publicKey', () => {
  it('после старта отдаёт непустой VAPID-ключ', () => {
    const service = makeService();
    expect(service.publicKey().length).toBeGreaterThan(10);
  });

  it('неполная пара VAPID-переменных отключает push, а не подменяет половину ключей', () => {
    process.env.WAKANDA_VAPID_PUBLIC = 'только-публичный';
    const service = makeService();
    expect(service.publicKey()).toBe('');
    expect(() => service.subscribe('user-1', { endpoint: endpoint('x'), keys: KEYS }, 180, 'device-A1')).toThrow(BadRequestException);
  });
});

describe('subscribe: валидация адреса', () => {
  it('принимает https-подписку известного push-сервиса', () => {
    const service = makeService();
    const result = service.subscribe('user-1', { endpoint: 'https://fcm.googleapis.com/wpc/push/x', keys: KEYS }, 180, 'device-A1');
    expect(result).toEqual({ ok: true });
    expect(service.countForUser('user-1')).toBe(1);
  });

  it('отклоняет http:// и произвольные хосты (SSRF/подделка подписки)', () => {
    const service = makeService();
    expect(() => service.subscribe('user-1', { endpoint: 'http://fcm.googleapis.com/x', keys: KEYS }, 180, 'device-A1')).toThrow(BadRequestException);
    expect(() => service.subscribe('user-1', { endpoint: 'https://evil.example.com/x', keys: KEYS }, 180, 'device-A1')).toThrow(/не разрешён/i);
    expect(service.countForUser('user-1')).toBe(0);
  });

  it('разрешённые через WAKANDA_PUSH_HOSTS хосты проходят', () => {
    process.env.WAKANDA_PUSH_HOSTS = 'push.my-provider.ru';
    const service = makeService();
    expect(() => service.subscribe('user-1', { endpoint: 'https://push.my-provider.ru/x', keys: KEYS }, 180, 'device-A1')).not.toThrow();
  });

  it('отклоняет неподходящие ключи и device id', () => {
    const service = makeService();
    expect(() => service.subscribe('user-1', { endpoint: endpoint('k1'), keys: { ...KEYS, p256dh: 'C'.repeat(513) } }, 180, 'device-A1')).toThrow(/ключ/i);
    expect(() => service.subscribe('user-1', { endpoint: endpoint('k2'), keys: { p256dh: '', auth: '' } }, 180, 'device-A1')).toThrow(/ключ/i);
    expect(() => service.subscribe('user-1', { endpoint: endpoint('k3'), keys: KEYS }, 180, 'плохой id!')).toThrow(/устройства/i);
    expect(service.countForUser('user-1')).toBe(0);
  });
});

describe('subscribe: лимиты и защита чужих подписок', () => {
  it('лимит — не больше 10 подписок на пользователя', () => {
    const service = makeService();
    for (let index = 0; index < 10; index += 1) {
      service.subscribe('user-1', { endpoint: endpoint(`lim-${index}`), keys: KEYS }, 180, 'device-A1');
    }
    expect(() => service.subscribe('user-1', { endpoint: endpoint('lim-overflow'), keys: KEYS }, 180, 'device-A1')).toThrow(/слишком много устройств/i);
    expect(service.countForUser('user-1')).toBe(10);
  });

  it('чужую подписку нельзя увести: нужен тот же device id', () => {
    const service = makeService();
    service.subscribe('user-1', { endpoint: endpoint('shared'), keys: KEYS }, 180, 'device-A1');

    expect(() => service.subscribe('user-2', { endpoint: endpoint('shared'), keys: KEYS }, 180, undefined)).toThrow(ConflictException);
    expect(() => service.subscribe('user-2', { endpoint: endpoint('shared'), keys: KEYS }, 180, 'device-B2')).toThrow(ConflictException);
    expect(service.countForUser('user-1')).toBe(1);
    expect(service.countForUser('user-2')).toBe(0);
  });

  it('тот же device id (смена аккаунта в браузере) переподписывает корректно', () => {
    const service = makeService();
    service.subscribe('user-1', { endpoint: endpoint('takeover'), keys: KEYS }, 180, 'device-A1');

    service.subscribe('user-2', { endpoint: endpoint('takeover'), keys: KEYS }, 60, 'device-A1');

    expect(service.countForUser('user-2')).toBe(1);
    expect(service.countForUser('user-1')).toBe(0);
  });

  it('повторная подписка того же пользователя обновляет строку, а не плодит дубли', () => {
    const service = makeService();
    service.subscribe('user-1', { endpoint: endpoint('same'), keys: KEYS }, 180, 'device-A1');
    service.subscribe('user-1', { endpoint: endpoint('same'), keys: KEYS }, -300, 'device-A1');
    expect(service.countForUser('user-1')).toBe(1);
  });
});
