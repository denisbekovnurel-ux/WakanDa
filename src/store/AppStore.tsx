import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { fetchServerState, isEmptyAppState, saveServerState } from '../api/stateApi';
import type { SavedStateResponse } from '../api/stateApi';
import { loadState, loadSyncMeta, saveState, saveSyncMeta } from '../utils/migrations';
import { normalizeState } from '../utils/schema';
import { createTask } from '../utils/tasks';
import { useAuth } from '../auth/AuthContext';
import { decideInitialSync, hasServerChanged, SYNC_ACTION } from './syncDecision';
import { TIMINGS } from '../config/timings';
import type {
  AppActions,
  AppState,
  AppStoreValue,
  ConflictChoice,
  HabitStatus,
  OneOffPriority,
  PauseRange,
  SyncConflict,
  SyncMeta,
  SyncStatus,
  Theme,
} from '../types';
import { isApiError } from '../utils/errors';

const AppStoreContext = createContext<AppStoreValue | null>(null);

type AppAction =
  | { type: 'habit/add'; title: string; schedule: number[] }
  | { type: 'habit/setStatus'; id: string; dateKey: string; status: HabitStatus }
  | { type: 'habit/rename'; id: string; title: string }
  | { type: 'habit/archive'; id: string }
  | { type: 'habit/restore'; id: string }
  | { type: 'habit/delete'; id: string }
  | { type: 'habit/move'; from: number; to: number }
  | { type: 'habit/schedule'; id: string; day: number }
  | { type: 'habit/pause'; id: string; from: string; to: string }
  | { type: 'habit/unpause'; id: string; dateKey: string }
  | { type: 'oneoff/add'; title: string; deadline: string; priority: OneOffPriority; reminderAt?: string; todayKey: string }
  | { type: 'oneoff/toggle'; id: string }
  | { type: 'oneoff/delete'; id: string }
  | { type: 'oneoff/rename'; id: string; title: string }
  | { type: 'oneoff/reminder'; id: string; reminderAt: string }
  | { type: 'oneoff/move'; id: string; direction: -1 | 1 }
  | { type: 'notes/set'; dateKey: string; text: string }
  | { type: 'settings/theme'; value: Theme }
  | { type: 'settings/reminderTime'; index: number; value: string }
  | { type: 'settings/reminderEnabled'; value: boolean }
  | { type: 'settings/autoBackupAt'; value: number }
  | { type: 'state/adopt' | 'state/replace'; state: unknown };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'habit/add': {
      const { title, schedule } = action;
      return { ...state, tasks: [...state.tasks, { ...createTask(title), schedule }] };
    }
    case 'habit/setStatus': {
      const { id, dateKey, status } = action;
      return { ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, history: { ...task.history, [dateKey]: status } } : task)) };
    }
    case 'habit/rename':
      return { ...state, tasks: state.tasks.map((task) => (task.id === action.id && action.title.trim() ? { ...task, title: action.title.trim() } : task)) };
    case 'habit/archive':
      return { ...state, tasks: state.tasks.map((task) => (task.id === action.id ? { ...task, archived: true } : task)) };
    case 'habit/restore':
      return { ...state, tasks: state.tasks.map((task) => (task.id === action.id ? { ...task, archived: false } : task)) };
    case 'habit/delete':
      return { ...state, tasks: state.tasks.filter((task) => task.id !== action.id) };
    case 'habit/move': {
      const active = state.tasks.filter((task) => !task.archived);
      const archived = state.tasks.filter((task) => task.archived);
      const [moved] = active.splice(action.from, 1);
      if (!moved) return state;
      active.splice(action.to, 0, moved);
      return { ...state, tasks: [...active, ...archived] };
    }
    case 'habit/schedule': {
      return {
        ...state,
        tasks: state.tasks.map((task) => {
          if (task.id !== action.id) return task;
          const schedule = task.schedule || [0, 1, 2, 3, 4, 5, 6];
          if (schedule.includes(action.day) && schedule.length === 1) return task;
          return { ...task, schedule: schedule.includes(action.day) ? schedule.filter((value) => value !== action.day) : [...schedule, action.day] };
        }),
      };
    }
    case 'habit/pause': {
      const { id, from, to } = action;
      if (typeof from !== 'string' || typeof to !== 'string' || from > to) return state;
      return {
        ...state,
        tasks: state.tasks.map((task) => {
          if (task.id !== id) return task;
          const ranges = [...(task.pauseRanges || []).map((range) => ({ ...range })), { from, to }].sort((a, b) => a.from.localeCompare(b.from));
          // Схлопываем пересекающиеся периоды в непересекающиеся.
          const merged: PauseRange[] = [];
          for (const range of ranges) {
            const last = merged[merged.length - 1];
            if (last && range.from <= last.to) last.to = range.to > last.to ? range.to : last.to;
            else merged.push(range);
          }
          return { ...task, pauseRanges: merged };
        }),
      };
    }
    case 'habit/unpause': {
      const { id, dateKey } = action;
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === id
          ? { ...task, pauseRanges: (task.pauseRanges || []).filter((range) => !(dateKey >= range.from && dateKey <= range.to)) }
          : task)),
      };
    }
    case 'oneoff/add':
      return { ...state, oneOffTasks: [...state.oneOffTasks, { id: crypto.randomUUID(), title: action.title, done: false, createdAt: action.todayKey, deadline: action.deadline, priority: action.priority, reminderAt: action.reminderAt }] };
    case 'oneoff/toggle':
      return { ...state, oneOffTasks: state.oneOffTasks.map((task) => (task.id === action.id ? { ...task, done: !task.done } : task)) };
    case 'oneoff/delete':
      return { ...state, oneOffTasks: state.oneOffTasks.filter((task) => task.id !== action.id) };
    case 'oneoff/rename':
      return { ...state, oneOffTasks: state.oneOffTasks.map((task) => (task.id === action.id && action.title.trim() ? { ...task, title: action.title.trim() } : task)) };
    case 'oneoff/reminder':
      return { ...state, oneOffTasks: state.oneOffTasks.map((task) => (task.id === action.id ? { ...task, reminderAt: action.reminderAt || undefined } : task)) };
    case 'oneoff/move': {
      const activeIds = state.oneOffTasks.filter((task) => !task.done).map((task) => task.id);
      const index = activeIds.indexOf(action.id);
      const swapWith = activeIds[index + action.direction];
      if (index < 0 || !swapWith) return state;
      const list = [...state.oneOffTasks];
      const fromIndex = list.findIndex((task) => task.id === action.id);
      const toIndex = list.findIndex((task) => task.id === swapWith);
      const fromTask = list[fromIndex];
      const toTask = list[toIndex];
      if (!fromTask || !toTask) return state;
      list[fromIndex] = toTask;
      list[toIndex] = fromTask;
      return { ...state, oneOffTasks: list };
    }
    case 'notes/set': {
      const notes = { ...state.notes };
      if (action.text.trim()) notes[action.dateKey] = action.text;
      else delete notes[action.dateKey];
      return { ...state, notes };
    }
    case 'settings/theme':
      return { ...state, theme: action.value };
    case 'settings/reminderTime':
      return { ...state, reminderTimes: state.reminderTimes.map((value, index) => (index === action.index ? action.value : value)) };
    case 'settings/reminderEnabled':
      return { ...state, reminderEnabled: action.value };
    case 'settings/autoBackupAt':
      return { ...state, lastAutoBackupAt: action.value };
    // 'state/adopt' — серверная версия, не помечается как локальное изменение.
    // 'state/replace' — осознанный импорт пользователем, считается локальным изменением.
    case 'state/adopt':
    case 'state/replace':
      return normalizeState(action.state);
    default:
      return state;
  }
}

function useActions(dispatch: Dispatch<AppAction>): AppActions {
  return useMemo(() => ({
    addHabit: (title, schedule) => dispatch({ type: 'habit/add', title, schedule }),
    setHabitStatus: (id, dateKey, status) => dispatch({ type: 'habit/setStatus', id, dateKey, status }),
    renameHabit: (id, title) => dispatch({ type: 'habit/rename', id, title }),
    archiveHabit: (id) => dispatch({ type: 'habit/archive', id }),
    restoreHabit: (id) => dispatch({ type: 'habit/restore', id }),
    deleteHabit: (id) => dispatch({ type: 'habit/delete', id }),
    moveHabit: (from, to) => dispatch({ type: 'habit/move', from, to }),
    changeHabitSchedule: (id, day) => dispatch({ type: 'habit/schedule', id, day }),
    pauseHabit: (id, from, to) => dispatch({ type: 'habit/pause', id, from, to }),
    unpauseHabit: (id, dateKey) => dispatch({ type: 'habit/unpause', id, dateKey }),
    addOneOff: (title, options, todayKey) => dispatch({ type: 'oneoff/add', title, deadline: options.deadline, priority: options.priority, reminderAt: options.reminderAt, todayKey }),
    toggleOneOff: (id) => dispatch({ type: 'oneoff/toggle', id }),
    deleteOneOff: (id) => dispatch({ type: 'oneoff/delete', id }),
    renameOneOff: (id, title) => dispatch({ type: 'oneoff/rename', id, title }),
    setOneOffReminder: (id, reminderAt) => dispatch({ type: 'oneoff/reminder', id, reminderAt }),
    moveOneOff: (id, direction) => dispatch({ type: 'oneoff/move', id, direction }),
    setNote: (dateKey, text) => dispatch({ type: 'notes/set', dateKey, text }),
    setTheme: (value) => dispatch({ type: 'settings/theme', value }),
    setReminderTime: (index, value) => dispatch({ type: 'settings/reminderTime', index, value }),
    setReminderEnabled: (value) => dispatch({ type: 'settings/reminderEnabled', value }),
    markAutoBackup: (value) => dispatch({ type: 'settings/autoBackupAt', value }),
    replaceState: (next) => dispatch({ type: 'state/replace', state: next }),
  }), [dispatch]);
}

interface ConflictPayload {
  state?: unknown;
  updatedAt?: unknown;
  revision?: unknown;
}

/** Тело 409-ответа: актуальная серверная версия для диалога конфликта. */
function conflictFromError(error: unknown): SyncConflict | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const data = error.data as ConflictPayload | null | undefined;
  if (!data || !data.state) return null;
  return {
    local: normalizeState({}),
    remote: normalizeState(data.state),
    remoteUpdatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    remoteRevision: typeof data.revision === 'number' && Number.isInteger(data.revision) ? data.revision : 0,
  };
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const userId = user?.id ?? '';
  const [state, rawDispatch] = useReducer(reducer, userId, loadState);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const [initialTick, setInitialTick] = useState(0);

  const metaRef = useRef<SyncMeta | null>(null);
  if (metaRef.current === null) metaRef.current = loadSyncMeta(userId);
  const getMeta = useCallback((): SyncMeta => metaRef.current as SyncMeta, []);

  const readyRef = useRef(false);
  const savingRef = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Любое действие пользователя (кроме принятия серверной версии) помечает данные
  // как изменённые локально — это защищает оффлайн-правки от затирания сервером.
  const dispatch = useCallback((action: AppAction) => {
    if (action.type !== 'state/adopt') {
      metaRef.current = { ...getMeta(), dirty: true, lastLocalChangeAt: new Date().toISOString() };
      saveSyncMeta(userId, metaRef.current);
    }
    rawDispatch(action);
  }, [rawDispatch, userId, getMeta]);

  const actions = useActions(dispatch);

  const adoptRemote = useCallback((remote: unknown, updatedAt?: string | null, revision = 0) => {
    const next = normalizeState(remote);
    rawDispatch({ type: 'state/adopt', state: next });
    saveState(next, userId);
    metaRef.current = {
      dirty: false,
      lastLocalChangeAt: null,
      lastSyncedAt: updatedAt ?? new Date().toISOString(),
      revision: Number.isInteger(revision) ? revision : 0,
    };
    saveSyncMeta(userId, metaRef.current);
    setSyncStatus('saved');
  }, [rawDispatch, userId]);

  const applySavedMeta = useCallback((meta: SyncMeta, saved: SavedStateResponse, baseRevision?: number | null) => {
    const revision = Number.isInteger(saved?.revision)
      ? Number(saved.revision)
      : (Number.isInteger(baseRevision) ? Number(baseRevision) + 1 : (meta.revision ?? 0) + 1);
    meta.revision = revision;
    meta.lastSyncedAt = saved?.savedAt ?? saved?.updatedAt ?? new Date().toISOString();
  }, []);

  // Первичная синхронизация: не затираем локальные правки, сделанные оффлайн.
  // Пока GET не удался, автосохранение запрещено: иначе устаревший локальный
  // кэш мог бы затереть сервер, который мы ещё не видели.
  useEffect(() => {
    let cancelled = false;
    if (!token || !userId) return undefined;
    readyRef.current = false;
    (async () => {
      try {
        const { state: remoteRaw, updatedAt, revision } = await fetchServerState(token);
        if (cancelled) return;
        const remote = normalizeState(remoteRaw);
        const meta = getMeta();
        const local = stateRef.current;

        const localDirty = Boolean(meta.dirty && meta.lastLocalChangeAt);
        const serverChangedSinceSync = hasServerChanged({
          revision,
          knownRevision: meta.revision,
          remoteUpdatedAt: updatedAt,
          lastSyncedAt: meta.lastSyncedAt,
        });
        const action = decideInitialSync({
          remoteIsEmpty: isEmptyAppState(remote),
          localIsEmpty: isEmptyAppState(local),
          localDirty,
          serverChangedSinceSync,
        });

        if (action === SYNC_ACTION.ADOPT_REMOTE) {
          // Несинхронизированных правок нет — серверная версия главнее.
          adoptRemote(remote, updatedAt, revision);
        } else if (action === SYNC_ACTION.PUSH_LOCAL) {
          // Отправляем локальное: либо на сервере пусто, либо оно не менялось
          // с нашей последней синхронизации.
          const localChangeAt = getMeta().lastLocalChangeAt;
          const saved = await saveServerState(token, local, revision);
          if (cancelled) return;
          const current = getMeta();
          const stillDirty = local !== stateRef.current || current.lastLocalChangeAt !== localChangeAt;
          current.dirty = stillDirty;
          applySavedMeta(current, saved, revision);
          saveSyncMeta(userId, current);
          if (stillDirty) {
            setSyncStatus('saving');
            setSyncTick((tick) => tick + 1);
          } else {
            setSyncStatus('saved');
          }
        } else if (action === SYNC_ACTION.CONFLICT) {
          // Изменилось и локально, и на сервере — спрашиваем пользователя.
          setConflict({ local, remote, remoteUpdatedAt: updatedAt ?? null, remoteRevision: revision });
          setSyncStatus('offline');
        } else {
          // Обе стороны пусты — запоминаем, что синхронизированы.
          meta.dirty = false;
          meta.revision = revision;
          meta.lastSyncedAt = updatedAt ?? new Date().toISOString();
          saveSyncMeta(userId, meta);
          setSyncStatus('saved');
        }
        readyRef.current = true;
      } catch (error) {
        if (cancelled) return;
        const conflictState = conflictFromError(error);
        if (conflictState) {
          setConflict({ ...conflictState, local: stateRef.current });
          setSyncStatus('offline');
          readyRef.current = true;
          return;
        }
        console.error('Сервер недоступен, работаем из локального кэша:', error);
        readyRef.current = false;
        setSyncStatus('offline');
      }
    })();
    return () => { cancelled = true; };
  }, [token, userId, adoptRemote, applySavedMeta, initialTick, getMeta]);

  useEffect(() => { saveState(state, userId); }, [state, userId]);

  // Повторяем сохранение после восстановления сети и по таймеру, пока есть
  // несинхронизированные правки — иначе они ждали бы следующего действия пользователя.
  useEffect(() => {
    if (!token) return undefined;
    const retry = () => {
      if (readyRef.current) setSyncTick((tick) => tick + 1);
      else setInitialTick((tick) => tick + 1);
    };
    const onOnline = () => {
      setInitialTick((tick) => tick + 1);
    };
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (!readyRef.current || getMeta().dirty) retry();
    }, TIMINGS.syncRetryMs);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [token, getMeta]);

  // Автосохранение на сервер. Работает, только если есть несинхронизированные
  // правки и нет неразрешённого конфликта.
  useEffect(() => {
    if (!readyRef.current || !token || conflict || savingRef.current) return undefined;
    if (!getMeta().dirty) return undefined;
    setSyncStatus((current) => (current === 'offline' ? 'offline' : 'saving'));
    const snapshot = stateRef.current;
    const localChangeAt = getMeta().lastLocalChangeAt;
    const baseRevision = getMeta().revision;
    const timer = window.setTimeout(async () => {
      savingRef.current = true;
      try {
        const saved = await saveServerState(token, snapshot, baseRevision);
        // Пока запрос летел, пользователь мог продолжить редактировать.
        // Тогда dirty нельзя снимать: следующая попытка отправит свежий снимок.
        const stillDirty = snapshot !== stateRef.current || getMeta().lastLocalChangeAt !== localChangeAt;
        const nextMeta = { ...getMeta(), dirty: stillDirty };
        applySavedMeta(nextMeta, saved, baseRevision);
        metaRef.current = nextMeta;
        saveSyncMeta(userId, nextMeta);
        if (stillDirty) {
          setSyncStatus('saving');
          setSyncTick((tick) => tick + 1);
        } else {
          setSyncStatus('saved');
        }
      } catch (error) {
        const conflictState = conflictFromError(error);
        if (conflictState) {
          setConflict({ ...conflictState, local: stateRef.current });
          setSyncStatus('offline');
        } else {
          console.error('Автосохранение на сервер не удалось:', error);
          setSyncStatus('offline');
        }
      } finally {
        savingRef.current = false;
      }
    }, TIMINGS.autosaveDebounceMs);
    return () => window.clearTimeout(timer);
  }, [state, token, userId, conflict, syncTick, applySavedMeta, getMeta]);

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
    if (!conflict) return;
    if (choice === 'server') {
      adoptRemote(conflict.remote, conflict.remoteUpdatedAt, conflict.remoteRevision);
      setConflict(null);
      return;
    }
    try {
      const saved = await saveServerState(token, stateRef.current, conflict.remoteRevision);
      metaRef.current = { ...getMeta(), dirty: false };
      applySavedMeta(metaRef.current, saved, conflict.remoteRevision);
      saveSyncMeta(userId, metaRef.current);
      setConflict(null);
      setSyncStatus('saved');
    } catch (error) {
      const conflictState = conflictFromError(error);
      if (conflictState) {
        // Пока пользователь выбирал, сервер успел измениться ещё раз.
        setConflict({ ...conflictState, local: stateRef.current });
        throw new Error('Данные на сервере снова изменились. Проверь версии и выбери ещё раз.', { cause: error });
      }
      console.error('Не удалось отправить локальные данные на сервер:', error);
      setSyncStatus('offline');
      throw error;
    }
  }, [conflict, token, userId, adoptRemote, applySavedMeta, getMeta]);

  const value = useMemo<AppStoreValue>(
    () => ({ state, actions, syncStatus, conflict, resolveConflict, adoptServerState: adoptRemote }),
    [state, actions, syncStatus, conflict, resolveConflict, adoptRemote],
  );
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppStore(): AppStoreValue {
  const context = useContext(AppStoreContext);
  if (!context) throw new Error('useAppStore нужно использовать внутри AppStoreProvider');
  return context;
}
