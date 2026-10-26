import type { AppState, SyncMeta } from '../types';
import { normalizeState, SCHEMA_VERSION } from './schema';

const STORE_KEY = 'wakanda-state-v2';
const META_KEY = 'wakanda-sync-meta-v2';

const LEGACY_KEYS = {
  tasks: 'wakanda-daily-tasks',
  oneOffTasks: 'wakanda-one-off-tasks',
  theme: 'wakanda-theme',
  reminderTime: 'wakanda-reminder-time',
  reminderEnabled: 'wakanda-reminder-enabled',
} as const;

// Кэш и метаданные синхронизации храним отдельно для каждого пользователя:
// на одном браузере могут входить разные аккаунты, и они не должны видеть
// чужие локальные данные или чужой «грязный» флаг.
function stateKey(userId: string): string {
  return userId ? `${STORE_KEY}:${userId}` : STORE_KEY;
}

function syncKey(userId: string): string {
  return userId ? `${META_KEY}:${userId}` : META_KEY;
}

function readLegacyState(): Record<string, unknown> | null {
  const legacy: Record<string, unknown> = {};
  let found = false;
  for (const [field, key] of Object.entries(LEGACY_KEYS)) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    found = true;
    try {
      legacy[field] = JSON.parse(raw);
    } catch {
      legacy[field] = field === 'theme' || field === 'reminderTime' ? raw.replace(/^"|"$/g, '') : undefined;
    }
  }
  return found ? legacy : null;
}

/**
 * Загружает состояние приложения.
 * Если нового per-user ключа нет — пытается перенести старый единый кэш
 * (или данные из ключей v1) и чистит их, чтобы не отдать чужие данные другому аккаунту.
 */
export function loadState(userId = ''): AppState {
  try {
    const raw = localStorage.getItem(stateKey(userId));
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeState(parsed);
      if ((parsed as { version?: unknown } | null)?.version !== SCHEMA_VERSION) saveState(normalized, userId);
      return normalized;
    }
  } catch (error) {
    console.error('Не удалось прочитать состояние из localStorage:', error);
  }

  // Разовая миграция старого единого кэша (до появления аккаунтов).
  if (userId) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw !== null) {
        const normalized = normalizeState(JSON.parse(raw));
        // Удаляем старый ключ только после успешной записи per-user копии:
        // при переполнении localStorage иначе данные потерялись бы навсегда.
        if (saveState(normalized, userId)) localStorage.removeItem(STORE_KEY);
        return normalized;
      }
    } catch (error) {
      console.error('Не удалось перенести старый кэш состояния:', error);
    }
  }

  const legacy = readLegacyState();
  if (legacy) {
    const migrated = normalizeState(legacy);
    if (saveState(migrated, userId)) {
      for (const key of Object.values(LEGACY_KEYS)) localStorage.removeItem(key);
    }
    return migrated;
  }

  return normalizeState({});
}

export function saveState(state: AppState, userId = ''): boolean {
  try {
    localStorage.setItem(stateKey(userId), JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('Не удалось сохранить состояние:', error);
    return false;
  }
}

/**
 * Метаданные синхронизации с сервером. Нужны, чтобы не потерять правки,
 * сделанные оффлайн, и уметь отличить «локальное новее» от конфликта.
 *   dirty             — есть ли несинхронизированные локальные изменения;
 *   lastLocalChangeAt — когда пользователь последний раз менял данные;
 *   lastSyncedAt      — время последней успешной синхронизации с сервером;
 *   revision          — версия серверного состояния, на которой основаны правки.
 */
export function loadSyncMeta(userId = ''): SyncMeta {
  try {
    const raw = localStorage.getItem(syncKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown> | null;
      const revision = parsed?.revision;
      return {
        dirty: Boolean(parsed?.dirty),
        lastLocalChangeAt: typeof parsed?.lastLocalChangeAt === 'string' ? parsed.lastLocalChangeAt : null,
        lastSyncedAt: typeof parsed?.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        revision: typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0,
      };
    }
  } catch (error) {
    console.error('Не удалось прочитать метаданные синхронизации:', error);
  }
  return { dirty: false, lastLocalChangeAt: null, lastSyncedAt: null, revision: 0 };
}

export function saveSyncMeta(userId: string, meta: SyncMeta): void {
  try {
    localStorage.setItem(syncKey(userId), JSON.stringify(meta));
  } catch (error) {
    console.error('Не удалось сохранить метаданные синхронизации:', error);
  }
}

export { STORE_KEY };
