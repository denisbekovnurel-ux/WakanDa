import { describe, expect, it } from 'vitest';
import { decideInitialSync, hasServerChanged, SYNC_ACTION } from './syncDecision';

describe('decideInitialSync', () => {
  it('обе стороны пусты — ничего не делаем', () => {
    expect(decideInitialSync({
      remoteIsEmpty: true,
      localIsEmpty: true,
      localDirty: false,
      serverChangedSinceSync: false,
    })).toBe(SYNC_ACTION.NOTHING);
  });

  it('сервер пуст, локально есть данные — отправляем локальные наверх', () => {
    expect(decideInitialSync({
      remoteIsEmpty: true,
      localIsEmpty: false,
      localDirty: false,
      serverChangedSinceSync: false,
    })).toBe(SYNC_ACTION.PUSH_LOCAL);
  });

  it('сервер пуст, но есть оффлайн-правки — тоже отправляем локальные', () => {
    expect(decideInitialSync({
      remoteIsEmpty: true,
      localIsEmpty: false,
      localDirty: true,
      serverChangedSinceSync: true,
    })).toBe(SYNC_ACTION.PUSH_LOCAL);
  });

  it('локальных правок нет — берём серверную версию', () => {
    expect(decideInitialSync({
      remoteIsEmpty: false,
      localIsEmpty: false,
      localDirty: false,
      serverChangedSinceSync: true,
    })).toBe(SYNC_ACTION.ADOPT_REMOTE);
  });

  it('локальные правки есть, сервер не менялся — отправляем локальные', () => {
    expect(decideInitialSync({
      remoteIsEmpty: false,
      localIsEmpty: false,
      localDirty: true,
      serverChangedSinceSync: false,
    })).toBe(SYNC_ACTION.PUSH_LOCAL);
  });

  it('локальные правки есть и сервер менялся — спрашиваем пользователя', () => {
    expect(decideInitialSync({
      remoteIsEmpty: false,
      localIsEmpty: false,
      localDirty: true,
      serverChangedSinceSync: true,
    })).toBe(SYNC_ACTION.CONFLICT);
  });

  it('пустое локальное состояние не блокирует принятие серверного', () => {
    expect(decideInitialSync({
      remoteIsEmpty: false,
      localIsEmpty: true,
      localDirty: false,
      serverChangedSinceSync: true,
    })).toBe(SYNC_ACTION.ADOPT_REMOTE);
  });
});

describe('hasServerChanged', () => {
  const syncedAt = '2026-10-21T10:00:00.000Z';

  it('ревизия на сервере больше — сервер менялся', () => {
    expect(hasServerChanged({
      revision: 8,
      knownRevision: 7,
      remoteUpdatedAt: syncedAt,
      lastSyncedAt: syncedAt,
    })).toBe(true);
  });

  it('та же ревизия, время то же — сервер не менялся', () => {
    expect(hasServerChanged({
      revision: 7,
      knownRevision: 7,
      remoteUpdatedAt: syncedAt,
      lastSyncedAt: syncedAt,
    })).toBe(false);
  });

  it('время отличается меньше чем на секунду — это округление, не изменение', () => {
    expect(hasServerChanged({
      revision: 7,
      knownRevision: 7,
      remoteUpdatedAt: '2026-10-21T10:00:00.500Z',
      lastSyncedAt: syncedAt,
    })).toBe(false);
  });

  it('время сервера заметно новее — сервер менялся', () => {
    expect(hasServerChanged({
      revision: 7,
      knownRevision: 7,
      remoteUpdatedAt: '2026-10-21T10:00:02.000Z',
      lastSyncedAt: syncedAt,
    })).toBe(true);
  });

  it('ревизия сервера меньше, а время старое — не считаем изменением', () => {
    expect(hasServerChanged({
      revision: 3,
      knownRevision: 7,
      remoteUpdatedAt: '2026-10-21T09:00:00.000Z',
      lastSyncedAt: syncedAt,
    })).toBe(false);
  });

  it('без дат ориентируется только на ревизию', () => {
    expect(hasServerChanged({ revision: 2, knownRevision: 1, remoteUpdatedAt: null, lastSyncedAt: null })).toBe(true);
    expect(hasServerChanged({ revision: 1, knownRevision: 1, remoteUpdatedAt: null, lastSyncedAt: null })).toBe(false);
  });

  it('битые даты не роняют решение', () => {
    expect(hasServerChanged({
      revision: 1,
      knownRevision: 1,
      remoteUpdatedAt: 'не дата',
      lastSyncedAt: 'тоже не дата',
    })).toBe(false);
  });

  it('первый запуск без сохранённых метаданных: ревизия 1 — это изменение', () => {
    expect(hasServerChanged({
      revision: 1,
      knownRevision: null,
      remoteUpdatedAt: syncedAt,
      lastSyncedAt: null,
    })).toBe(true);
  });
});
