import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { fetchServerState, isEmptyAppState, saveServerState } from '../api/stateApi';
import { loadState, loadSyncMeta, saveState, saveSyncMeta } from '../utils/migrations';
import { normalizeState } from '../utils/schema';
import { createTask } from '../utils/tasks';
import { useAuth } from '../auth/AuthContext';

const AppStoreContext = createContext(null);

function reducer(state, action) {
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
          const merged = [];
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
      return { ...state, oneOffTasks: [...state.oneOffTasks, { id: crypto.randomUUID(), title: action.title, done: false, createdAt: action.todayKey, deadline: action.deadline, priority: action.priority }] };
    case 'oneoff/toggle':
      return { ...state, oneOffTasks: state.oneOffTasks.map((task) => (task.id === action.id ? { ...task, done: !task.done } : task)) };
    case 'oneoff/delete':
      return { ...state, oneOffTasks: state.oneOffTasks.filter((task) => task.id !== action.id) };
    case 'oneoff/rename':
      return { ...state, oneOffTasks: state.oneOffTasks.map((task) => (task.id === action.id && action.title.trim() ? { ...task, title: action.title.trim() } : task)) };
    case 'oneoff/move': {
      const activeIds = state.oneOffTasks.filter((task) => !task.done).map((task) => task.id);
      const index = activeIds.indexOf(action.id);
      const swapWith = activeIds[index + action.direction];
      if (index < 0 || !swapWith) return state;
      const list = [...state.oneOffTasks];
      const from = list.findIndex((task) => task.id === action.id);
      const to = list.findIndex((task) => task.id === swapWith);
      [list[from], list[to]] = [list[to], list[from]];
      return { ...state, oneOffTasks: list };
    }
    case 'goal/add':
      return { ...state, goals: [...state.goals, { id: crypto.randomUUID(), title: action.title, unit: action.unit, target: action.target, dailyRate: action.dailyRate, current: 0, log: [], createdAt: action.todayKey }] };
    case 'goal/progress': {
      return {
        ...state,
        goals: state.goals.map((goal) => {
          if (goal.id !== action.id) return goal;
          const log = Array.isArray(goal.log) ? goal.log : (goal.current ? [{ date: goal.createdAt || action.todayKey, amount: Number(goal.current) }] : []);
          return { ...goal, current: (Number(goal.current) || 0) + action.amount, log: [...log, { date: action.todayKey, amount: action.amount }] };
        }),
      };
    }
    case 'goal/rename':
      return { ...state, goals: state.goals.map((goal) => (goal.id === action.id && action.title.trim() ? { ...goal, title: action.title.trim() } : goal)) };
    case 'goal/delete':
      return { ...state, goals: state.goals.filter((goal) => goal.id !== action.id) };
    case 'notes/set': {
      const notes = { ...state.notes };
      if (action.text.trim()) notes[action.dateKey] = action.text;
      else delete notes[action.dateKey];
      return { ...state, notes };
    }
    case 'settings/theme':
      return { ...state, theme: action.value };
    case 'settings/reminderTime':
      return { ...state, reminderTime: action.value };
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

function useActions(dispatch) {
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
    addOneOff: (title, options, todayKey) => dispatch({ type: 'oneoff/add', title, deadline: options.deadline, priority: options.priority, todayKey }),
    toggleOneOff: (id) => dispatch({ type: 'oneoff/toggle', id }),
    deleteOneOff: (id) => dispatch({ type: 'oneoff/delete', id }),
    renameOneOff: (id, title) => dispatch({ type: 'oneoff/rename', id, title }),
    moveOneOff: (id, direction) => dispatch({ type: 'oneoff/move', id, direction }),
    addGoal: ({ title, target, unit, dailyRate }, todayKey) => dispatch({ type: 'goal/add', title, unit, target, dailyRate, todayKey }),
    addGoalProgress: (id, amount, todayKey) => dispatch({ type: 'goal/progress', id, amount, todayKey }),
    renameGoal: (id, title) => dispatch({ type: 'goal/rename', id, title }),
    deleteGoal: (id) => dispatch({ type: 'goal/delete', id }),
    setNote: (dateKey, text) => dispatch({ type: 'notes/set', dateKey, text }),
    setTheme: (value) => dispatch({ type: 'settings/theme', value }),
    setReminderTime: (value) => dispatch({ type: 'settings/reminderTime', value }),
    setReminderEnabled: (value) => dispatch({ type: 'settings/reminderEnabled', value }),
    markAutoBackup: (value) => dispatch({ type: 'settings/autoBackupAt', value }),
    replaceState: (next) => dispatch({ type: 'state/replace', state: next }),
  }), [dispatch]);
}

export function AppStoreProvider({ children }) {
  const { token, user } = useAuth();
  const userId = user?.id ?? '';
  const [state, rawDispatch] = useReducer(reducer, undefined, () => loadState(userId));
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [conflict, setConflict] = useState(null);
  const [syncTick, setSyncTick] = useState(0);

  const metaRef = useRef(null);
  if (metaRef.current === null) metaRef.current = loadSyncMeta(userId);

  const readyRef = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Любое действие пользователя (кроме принятия серверной версии) помечает данные
  // как изменённые локально — это защищает оффлайн-правки от затирания сервером.
  const dispatch = useCallback((action) => {
    if (action.type !== 'state/adopt') {
      metaRef.current = { ...metaRef.current, dirty: true, lastLocalChangeAt: new Date().toISOString() };
      saveSyncMeta(userId, metaRef.current);
    }
    rawDispatch(action);
  }, [rawDispatch, userId]);

  const actions = useActions(dispatch);

  const adoptRemote = useCallback((remote, updatedAt) => {
    rawDispatch({ type: 'state/adopt', state: remote });
    saveState(remote, userId);
    metaRef.current = { dirty: false, lastLocalChangeAt: null, lastSyncedAt: updatedAt ?? new Date().toISOString() };
    saveSyncMeta(userId, metaRef.current);
    setSyncStatus('saved');
  }, [rawDispatch, userId]);

  // Первичная синхронизация: не затираем локальные правки, сделанные оффлайн.
  useEffect(() => {
    let cancelled = false;
    if (!token || !userId) return undefined;
    (async () => {
      try {
        const { state: remoteRaw, updatedAt } = await fetchServerState(token);
        if (cancelled) return;
        const remote = normalizeState(remoteRaw);
        const meta = metaRef.current;
        const local = stateRef.current;

        if (isEmptyAppState(remote)) {
          // На сервере пусто: если локально что-то есть — отправляем это наверх.
          if (!isEmptyAppState(local)) {
            const saved = await saveServerState(token, local);
            if (cancelled) return;
            meta.lastSyncedAt = saved?.savedAt ?? new Date().toISOString();
          }
          meta.dirty = false;
          saveSyncMeta(userId, meta);
          setSyncStatus('saved');
          readyRef.current = true;
          return;
        }

        const localDirty = Boolean(meta.dirty && meta.lastLocalChangeAt);
        const remoteAt = updatedAt ? Date.parse(updatedAt) : 0;
        const syncedAt = meta.lastSyncedAt ? Date.parse(meta.lastSyncedAt) : 0;
        const serverChangedSinceSync = remoteAt > syncedAt + 1000;

        if (!localDirty) {
          // Несинхронизированных правок нет — серверная версия главнее.
          adoptRemote(remote, updatedAt);
        } else if (!serverChangedSinceSync) {
          // Сервер с нашей последней синхронизации не менялся: правки оффлайн свежее.
          const saved = await saveServerState(token, local);
          if (cancelled) return;
          meta.dirty = false;
          meta.lastSyncedAt = saved?.savedAt ?? new Date().toISOString();
          saveSyncMeta(userId, meta);
          setSyncStatus('saved');
        } else {
          // Изменилось и локально, и на сервере — спрашиваем пользователя.
          setConflict({ local, remote, remoteUpdatedAt: updatedAt ?? null });
          setSyncStatus('offline');
        }
        readyRef.current = true;
      } catch (error) {
        console.error('Сервер недоступен, работаем из локального кэша:', error);
        readyRef.current = true;
        setSyncStatus('offline');
      }
    })();
    return () => { cancelled = true; };
  }, [token, userId, adoptRemote]);

  useEffect(() => { saveState(state, userId); }, [state, userId]);

  // Повторяем сохранение после восстановления сети и по таймеру, пока есть
  // несинхронизированные правки — иначе они ждали бы следующего действия пользователя.
  useEffect(() => {
    if (!token) return undefined;
    const retry = () => setSyncTick((tick) => tick + 1);
    window.addEventListener('online', retry);
    const timer = window.setInterval(() => {
      if (metaRef.current?.dirty) retry();
    }, 30000);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(timer);
    };
  }, [token]);

  // Автосохранение на сервер. Работает, только если есть несинхронизированные
  // правки и нет неразрешённого конфликта.
  useEffect(() => {
    if (!readyRef.current || !token || conflict) return undefined;
    if (!metaRef.current.dirty) return undefined;
    setSyncStatus((current) => (current === 'offline' ? 'offline' : 'saving'));
    const timer = window.setTimeout(async () => {
      try {
        const saved = await saveServerState(token, stateRef.current);
        metaRef.current = { ...metaRef.current, dirty: false, lastSyncedAt: saved?.savedAt ?? new Date().toISOString() };
        saveSyncMeta(userId, metaRef.current);
        setSyncStatus('saved');
      } catch (error) {
        console.error('Автосохранение на сервер не удалось:', error);
        setSyncStatus('offline');
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state, token, userId, conflict, syncTick]);

  const resolveConflict = useCallback(async (choice) => {
    if (!conflict) return;
    if (choice === 'server') {
      adoptRemote(conflict.remote, conflict.remoteUpdatedAt);
      setConflict(null);
      return;
    }
    try {
      const saved = await saveServerState(token, stateRef.current);
      metaRef.current = { ...metaRef.current, dirty: false, lastSyncedAt: saved?.savedAt ?? new Date().toISOString() };
      saveSyncMeta(userId, metaRef.current);
      setConflict(null);
      setSyncStatus('saved');
    } catch (error) {
      console.error('Не удалось отправить локальные данные на сервер:', error);
      setSyncStatus('offline');
    }
  }, [conflict, token, userId, adoptRemote]);

  const value = useMemo(
    () => ({ state, actions, syncStatus, conflict, resolveConflict }),
    [state, actions, syncStatus, conflict, resolveConflict],
  );
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppStore() {
  const context = useContext(AppStoreContext);
  if (!context) throw new Error('useAppStore нужно использовать внутри AppStoreProvider');
  return context;
}
