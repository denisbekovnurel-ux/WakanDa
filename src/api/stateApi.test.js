import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchServerState, isEmptyAppState, saveServerState } from './stateApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('saveServerState', () => {
  it('отправляет состояние в новом формате {state, baseRevision}', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ savedAt: '2026-10-21T10:00:00.000Z', revision: 7 }));
    vi.stubGlobal('fetch', fetchMock);
    const state = { tasks: [], oneOffTasks: [], notes: {} };

    const result = await saveServerState('token-1', state, 6);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/state');
    expect(options.method).toBe('PUT');
    expect(options.headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(options.body)).toEqual({ state, baseRevision: 6 });
    expect(result.revision).toBe(7);
  });

  it('null baseRevision уходит как есть — сервер не сверяет версии', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ savedAt: '2026-10-21T10:00:00.000Z', revision: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await saveServerState('token-1', { tasks: [] }, null);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).baseRevision).toBeNull();
  });

  it('ошибка 409 пробрасывает серверное состояние в error.data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      message: 'Данные уже изменились на другом устройстве',
      state: { tasks: [{ id: 'remote', title: 'С сервера' }] },
      updatedAt: '2026-10-21T09:00:00.000Z',
      revision: 9,
    }, 409)));

    await expect(saveServerState('token-1', {}, 1)).rejects.toMatchObject({
      status: 409,
      data: {
        revision: 9,
        updatedAt: '2026-10-21T09:00:00.000Z',
      },
    });
  });
});

describe('fetchServerState', () => {
  it('новый формат возвращает state, updatedAt и revision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      state: { tasks: [] },
      updatedAt: '2026-10-21T09:00:00.000Z',
      revision: 3,
    })));

    expect(await fetchServerState('token-1')).toEqual({
      state: { tasks: [] },
      updatedAt: '2026-10-21T09:00:00.000Z',
      revision: 3,
    });
  });

  it('старый формат («голое» состояние) получает revision 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ tasks: [] })));

    const data = await fetchServerState('token-1');

    expect(data.state).toEqual({ tasks: [] });
    expect(data.updatedAt).toBeNull();
    expect(data.revision).toBe(0);
  });
});

describe('isEmptyAppState', () => {
  const defaults = {
    tasks: [],
    oneOffTasks: [],
    notes: {},
    theme: 'dark',
    reminderTimes: ['09:00', '14:00', '20:00'],
    reminderEnabled: false,
    lastAutoBackupAt: 0,
  };

  it('состояние по умолчанию считается пустым', () => {
    expect(isEmptyAppState(defaults)).toBe(true);
  });

  it('настройки без данных — не «пусто», их нельзя затирать', () => {
    expect(isEmptyAppState({ ...defaults, theme: 'light' })).toBe(false);
    expect(isEmptyAppState({ ...defaults, reminderEnabled: true })).toBe(false);
    expect(isEmptyAppState({ ...defaults, reminderTimes: ['08:30', '14:00', '20:00'] })).toBe(false);
  });

  it('наличие любой записи делает состояние непустым', () => {
    expect(isEmptyAppState({ ...defaults, notes: { '2026-10-01': 'текст' } })).toBe(false);
    expect(isEmptyAppState({ ...defaults, oneOffTasks: [{ id: '1', title: 'Дело', done: false }] })).toBe(false);
  });
});
