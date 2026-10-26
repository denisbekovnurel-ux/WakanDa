// Общие типы данных приложения. Здесь только то, что пересекает границы
// модулей: состояние, привычки, разовые задачи, ответы API и обратная связь.
// Компонентные пропсы живут рядом с компонентами.

export type HabitStatus = 'done' | 'failed' | 'empty';
export type Theme = 'light' | 'dark' | 'system';
export type OneOffPriority = 'high' | 'normal' | 'low';
export type SyncStatus = 'connecting' | 'saving' | 'saved' | 'offline';
export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface PauseRange {
  from: string;
  to: string;
}

export interface Habit {
  id: string;
  title: string;
  history: Record<string, HabitStatus>;
  createdAt?: string;
  schedule?: number[];
  archived: boolean;
  pauseRanges: PauseRange[];
}

export interface OneOffTask {
  id: string;
  title: string;
  done: boolean;
  createdAt?: string;
  deadline: string;
  priority: OneOffPriority;
}

export interface AppState {
  version: number;
  tasks: Habit[];
  oneOffTasks: OneOffTask[];
  notes: Record<string, string>;
  theme: Theme;
  reminderTime: string;
  reminderEnabled: boolean;
  lastAutoBackupAt: number;
}

export interface SyncMeta {
  dirty: boolean;
  lastLocalChangeAt: string | null;
  lastSyncedAt: string | null;
  revision: number;
}

export interface User {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt?: string;
  online?: boolean;
}

export interface AdminStats {
  online: number;
  approved: number;
  pending: number;
  blocked: number;
}

export interface SyncConflict {
  local: AppState;
  remote: AppState;
  remoteUpdatedAt: string | null;
  remoteRevision: number;
}

export interface StatusHistoryItem {
  id: string;
  reason: string;
  createdAt: string;
  size: number;
}

export interface ServerStateResponse {
  state: unknown;
  updatedAt: string | null;
  revision: number;
}

/** Ошибка API: HTTP-статус и тело ответа нужны для 409-конфликтов. */
export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

export interface Badge {
  id: string;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  progress: string;
}

export interface HabitStats {
  bestStreak: number;
  monthPercent: number;
  monthDone: number;
  monthExpected: number;
  mostProductiveDay: number | null;
}

export interface WeekdayStat {
  day: number;
  done: number;
  expected: number;
}

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
  title: string;
}

export interface NotifyOptions {
  tone?: ToastTone;
  title?: string;
  duration?: number;
}

export interface DialogOptions {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  cancelText: string;
  confirmText: string;
  tone?: ToastTone | 'danger';
  inputLabel?: string;
  inputType?: 'text' | 'password' | 'email';
  autoComplete?: string;
  minLength?: number;
  value?: string;
}

export interface FeedbackContextValue {
  notify: (message: unknown, options?: NotifyOptions) => number | null;
  confirm: (options?: Partial<Omit<DialogOptions, 'kind'>>) => Promise<boolean>;
  prompt: (options?: Partial<Omit<DialogOptions, 'kind'>>) => Promise<string | null>;
  toasts: Toast[];
  dismiss: (id: number) => void;
  dialog: DialogOptions | null;
  finishDialog: (result: unknown) => void;
}

export interface TodayContextValue {
  today: Date;
  todayKey: string;
}

export interface OneOffOptions {
  deadline: string;
  priority: OneOffPriority;
}

/** Действия над состоянием, которые доступны компонентам. */
export interface AppActions {
  addHabit: (title: string, schedule: number[]) => void;
  setHabitStatus: (id: string, dateKey: string, status: HabitStatus) => void;
  renameHabit: (id: string, title: string) => void;
  archiveHabit: (id: string) => void;
  restoreHabit: (id: string) => void;
  deleteHabit: (id: string) => void;
  moveHabit: (from: number, to: number) => void;
  changeHabitSchedule: (id: string, day: number) => void;
  pauseHabit: (id: string, from: string, to: string) => void;
  unpauseHabit: (id: string, dateKey: string) => void;
  addOneOff: (title: string, options: OneOffOptions, todayKey: string) => void;
  toggleOneOff: (id: string) => void;
  deleteOneOff: (id: string) => void;
  renameOneOff: (id: string, title: string) => void;
  moveOneOff: (id: string, direction: -1 | 1) => void;
  setNote: (dateKey: string, text: string) => void;
  setTheme: (value: Theme) => void;
  setReminderTime: (value: string) => void;
  setReminderEnabled: (value: boolean) => void;
  markAutoBackup: (value: number) => void;
  replaceState: (next: unknown) => void;
}

export interface AppStoreValue {
  state: AppState;
  actions: AppActions;
  syncStatus: SyncStatus;
  conflict: SyncConflict | null;
  resolveConflict: (choice: 'local' | 'server') => Promise<void>;
  adoptServerState: (remote: unknown, updatedAt?: string | null, revision?: number) => void;
}

export type ConflictChoice = 'local' | 'server';

export interface AuthContextValue {
  token: string;
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: (user: User | null) => void;
}
