/**
 * Чистые решения синхронизации — вынесены из AppStore, чтобы их можно было
 * тестировать без React и без сети. Именно здесь исторически возникали баги
 * «правка пропала» и «привычка вернулась к старому состоянию»: неверная
 * ветка затирала либо локальные, либо серверные данные.
 */

export const SYNC_ACTION = Object.freeze({
  /** Ничего не делать: обе стороны пусты. */
  NOTHING: 'nothing',
  /** Отправить локальное состояние на сервер. */
  PUSH_LOCAL: 'push-local',
  /** Взять серверное состояние, локальных правок нет. */
  ADOPT_REMOTE: 'adopt-remote',
  /** Изменилось и локально, и на сервере — решает пользователь. */
  CONFLICT: 'conflict',
});

export interface InitialSyncInput {
  remoteIsEmpty: boolean;
  localIsEmpty: boolean;
  localDirty: boolean;
  serverChangedSinceSync: boolean;
}

/**
 * Что делать при первичной загрузке состояния.
 *
 * Правила:
 *  • на сервере пусто, локально есть данные → отправляем локальные (не теряем);
 *  • на сервере пусто и локально пусто → ничего;
 *  • локальных правок нет → сервер главнее;
 *  • локальные правки есть, сервер с последней синхронизации не менялся →
 *    отправляем локальные;
 *  • изменилось и там, и там → конфликт, спрашиваем пользователя.
 */
export function decideInitialSync({ remoteIsEmpty, localIsEmpty, localDirty, serverChangedSinceSync }: InitialSyncInput) {
  if (remoteIsEmpty) {
    return localIsEmpty ? SYNC_ACTION.NOTHING : SYNC_ACTION.PUSH_LOCAL;
  }
  if (!localDirty) return SYNC_ACTION.ADOPT_REMOTE;
  if (!serverChangedSinceSync) return SYNC_ACTION.PUSH_LOCAL;
  return SYNC_ACTION.CONFLICT;
}

export interface ServerChangedInput {
  revision: number;
  knownRevision: number | null | undefined;
  remoteUpdatedAt: string | null | undefined;
  lastSyncedAt: string | null | undefined;
}

/**
 * Менялся ли сервер с момента нашей последней успешной синхронизации.
 *
 * Revision — основной сигнал; время нужно для старых записей без revision и
 * для серверов, которые обновлялись мимо счётчика. Допуск в секунду гасит
 * расхождение часов и округление ISO-строк.
 */
export function hasServerChanged({ revision, knownRevision, remoteUpdatedAt, lastSyncedAt }: ServerChangedInput): boolean {
  const remoteAt = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : 0;
  const syncedAt = lastSyncedAt ? Date.parse(lastSyncedAt) : 0;
  if (Number.isFinite(revision) && revision > (knownRevision ?? 0)) return true;
  if (!Number.isFinite(remoteAt) || !Number.isFinite(syncedAt)) return false;
  return remoteAt > syncedAt + 1000;
}
