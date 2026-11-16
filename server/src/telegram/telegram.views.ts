// Тексты и кнопки Telegram-бота. Держим их отдельно от сетевой части,
// чтобы сообщения можно было проверять обычными unit-тестами.
import type { AppState } from '../state/state.schema';
import type { Reminder } from '../reminders/reminders.service';
import { formatReminderLocalDate } from '../reminders/reminders.util';
import { readReminderTimes } from '../push/push.util';

export type TelegramKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

const FULL_SCHEDULE = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function dateKeyLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return `${day} ${MONTHS[month - 1] ?? ''}`.trim();
}

function isPaused(task: AppState['tasks'][number], dateKey: string): boolean {
  return (task.pauseRanges || []).some((range) => dateKey >= range.from && dateKey <= range.to);
}

function isScheduled(task: AppState['tasks'][number], dateKey: string): boolean {
  if (task.archived) return false;
  const created = (task.createdAt || '').slice(0, 10);
  if (created && created > dateKey) return false;
  const schedule = task.schedule?.length ? task.schedule : FULL_SCHEDULE;
  return schedule.includes(weekdayOf(dateKey)) && !isPaused(task, dateKey);
}

function pendingHabits(state: AppState, dateKey: string): AppState['tasks'] {
  return state.tasks.filter((task) => {
    if (!isScheduled(task, dateKey)) return false;
    const status = task.history?.[dateKey];
    return status !== 'done' && status !== 'failed';
  });
}

function todayHabits(state: AppState, dateKey: string): AppState['tasks'] {
  return state.tasks.filter((task) => isScheduled(task, dateKey));
}

function activeOneOff(state: AppState): AppState['oneOffTasks'] {
  return state.oneOffTasks.filter((task) => !task.done);
}

function compareOneOff(dateKey: string) {
  return (left: AppState['oneOffTasks'][number], right: AppState['oneOffTasks'][number]): number => {
    const leftOverdue = Boolean(left.deadline && left.deadline < dateKey);
    const rightOverdue = Boolean(right.deadline && right.deadline < dateKey);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    const leftPriority = PRIORITY_RANK[left.priority || 'normal'] ?? 1;
    const rightPriority = PRIORITY_RANK[right.priority || 'normal'] ?? 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftDeadline = left.deadline || '9999-12-31';
    const rightDeadline = right.deadline || '9999-12-31';
    if (leftDeadline !== rightDeadline) return leftDeadline.localeCompare(rightDeadline);
    return left.title.localeCompare(right.title, 'ru');
  };
}

function taskMeta(task: AppState['oneOffTasks'][number], dateKey: string, offsetMinutes: number): string {
  const parts: string[] = [];
  if (task.priority === 'high') parts.push('🔴 высокий приоритет');
  if (task.deadline) {
    parts.push(task.deadline < dateKey ? `⚠️ просрочено до ${dateKeyLabel(task.deadline)}` : `до ${dateKeyLabel(task.deadline)}`);
  }
  if (task.reminderAt) {
    parts.push(`⏰ ${formatReminderLocalDate(task.reminderAt, offsetMinutes)}`);
  }
  return parts.join(' · ');
}

/** Локальный часовой пояс в понятном виде: UTC+03:00. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '−';
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

export function mainMenuKeyboard(): TelegramKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '📅 На сегодня', callback_data: 'menu:today' },
        { text: '✅ Разовые', callback_data: 'menu:tasks' },
      ],
      [
        { text: '⏰ Напоминания', callback_data: 'menu:reminders' },
        { text: 'ℹ️ Статус', callback_data: 'menu:status' },
      ],
      [{ text: '❓ Помощь', callback_data: 'menu:help' }],
    ],
  };
}

export const HELP_TEXT = [
  'WakanDa — помощник в Telegram.',
  '',
  '📅 /today — что осталось на сегодня',
  '✅ /tasks — активные разовые задачи',
  '⏰ /reminders — список напоминаний',
  '➕ /remind — создать напоминание',
  'ℹ️ /status — подключение, часовой пояс и настройки',
  '🔕 /stop — отключить уведомления',
  '',
  'Примеры:',
  '• Напомни мне проверить отчёт 05.11 в 21:00',
  '• Напомни завтра в 9:30 купить хлеб',
  '• Напомни через 30 минут позвонить маме',
  '• Напомни в 20:00 выключить плиту',
  '• /remind 21:00 проверить почту',
  '',
  'Удалить напоминание можно кнопкой в /reminders или командой /reminders 2.',
].join('\n');

export function startText(linked: boolean): string {
  if (linked) {
    return [
      '👋 WakanDa на связи.',
      'Уведомления и напоминания будут приходить в этот чат.',
      '',
      'Выбери, что показать:',
    ].join('\n');
  }
  return [
    '👋 Привет! Я WakanDa — помогу не забывать о привычках и задачах.',
    '',
    'Чтобы подключить уведомления:',
    '1. Открой сайт WakanDa → «Инструменты и напоминания».',
    '2. Нажми «Подключить Telegram» и перейди по ссылке.',
    '',
    'Если ссылка уже есть — просто нажми Start ещё раз.',
  ].join('\n');
}

export function connectHint(): string {
  return 'Сначала подключи Telegram: WakanDa → «Инструменты и напоминания» → «Подключить Telegram».';
}

export function todayText(state: AppState, dateKey: string, offsetMinutes: number): string {
  const scheduled = todayHabits(state, dateKey);
  const pending = pendingHabits(state, dateKey);
  const done = scheduled.filter((task) => task.history?.[dateKey] === 'done').length;
  const failed = scheduled.filter((task) => task.history?.[dateKey] === 'failed').length;
  const active = activeOneOff(state);
  const [, month, day] = dateKey.split('-').map(Number);
  const lines = [
    `🗓 Сегодня, ${day} ${MONTHS[month - 1] ?? ''} (${WEEKDAYS[weekdayOf(dateKey)]})`,
    '',
  ];

  if (!scheduled.length) {
    lines.push('Привычек на сегодня нет.');
  } else {
    lines.push(`Привычки: осталось ${pending.length} из ${scheduled.length}`);
    for (const task of pending.slice(0, 8)) lines.push(`• ${clip(task.title, 80)}`);
    if (pending.length > 8) lines.push(`…и ещё ${pending.length - 8}`);
    if (!pending.length) lines.push('• Всё отмечено — отличная работа.');
    const stats: string[] = [];
    if (done) stats.push(`выполнено: ${done}`);
    if (failed) stats.push(`пропущено: ${failed}`);
    if (stats.length) lines.push(stats.join(' · '));
  }

  lines.push('', `Разовые задачи: активных ${active.length}`);
  if (active.length) {
    for (const task of active.sort(compareOneOff(dateKey)).slice(0, 5)) {
      const meta = taskMeta(task, dateKey, offsetMinutes);
      lines.push(`• ${clip(task.title, 80)}${meta ? ` — ${meta}` : ''}`);
    }
    if (active.length > 5) lines.push(`…и ещё ${active.length - 5}`);
  } else {
    lines.push('• Активных разовых задач нет.');
  }

  lines.push('', 'Подробнее: /tasks · Напоминания: /reminders');
  return lines.join('\n');
}

export function tasksText(state: AppState, dateKey: string, offsetMinutes: number): string {
  const active = activeOneOff(state).sort(compareOneOff(dateKey));
  const done = state.oneOffTasks.length - active.length;
  if (!active.length) {
    return [
      '✅ Активных разовых задач нет.',
      done ? `Выполнено: ${done}.` : '',
      '',
      'Добавить задачу можно на сайте WakanDa → «Разовые».',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const lines = ['✅ Разовые задачи', `Активных: ${active.length}${done ? ` · выполнено: ${done}` : ''}`, ''];
  for (const [index, task] of active.slice(0, 15).entries()) {
    lines.push(`${index + 1}. ${clip(task.title, 100)}`);
    const meta = taskMeta(task, dateKey, offsetMinutes);
    if (meta) lines.push(`   ${meta}`);
  }
  if (active.length > 15) lines.push(`…и ещё ${active.length - 15}`);
  lines.push('', 'Отметить выполненной можно на сайте WakanDa.');
  return lines.join('\n');
}

export function remindersText(items: Reminder[], offsetMinutes: number): { text: string; keyboard: TelegramKeyboard } {
  if (!items.length) {
    return {
      text: '⏰ Активных напоминаний нет.\n\nНапиши, например: «Напомни через 30 минут позвонить маме».',
      keyboard: mainMenuKeyboard(),
    };
  }

  const shown = items.slice(0, 20);
  const lines = [`⏰ Напоминания (${items.length})`, ''];
  for (const [index, reminder] of shown.entries()) {
    lines.push(
      `${index + 1}. ${formatReminderLocalDate(reminder.dueAt, offsetMinutes)} — ${clip(reminder.text, 90)}`,
    );
  }
  if (items.length > shown.length) lines.push(`…и ещё ${items.length - shown.length}`);
  if (items.length > 10) {
    lines.push('', 'Кнопки удаления показаны для первых 10. Остальные можно удалить командой /reminders 11 и т.д.');
  } else {
    lines.push('', 'Нажми кнопку ниже, чтобы удалить напоминание.');
  }

  const rows: TelegramKeyboard['inline_keyboard'] = [];
  const deletable = shown.slice(0, 10);
  for (let index = 0; index < deletable.length; index += 2) {
    const row = deletable.slice(index, index + 2).map((reminder, offset) => ({
      text: `🗑 Удалить ${index + offset + 1}`,
      callback_data: `rem:del:${reminder.id}`,
    }));
    rows.push(row);
  }
  rows.push([{ text: '🏠 Меню', callback_data: 'menu:home' }]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: rows } };
}

export function statusText(input: {
  username: string | null;
  offsetMinutes: number;
  state: AppState | null;
  reminders: number;
  dateKey: string;
}): string {
  const lines = ['ℹ️ Статус WakanDa', ''];
  lines.push(`Telegram: ${input.username ? `@${input.username}` : 'подключён'}`);
  lines.push(`Часовой пояс: ${formatOffset(input.offsetMinutes)}`);

  if (input.state) {
    const times = readReminderTimes(input.state);
    lines.push(
      input.state.reminderEnabled
        ? `Ежедневные напоминания: ${times.join(' · ') || 'не заданы'}`
        : 'Ежедневные напоминания: выключены',
    );
    lines.push(`Осталось привычек сегодня: ${pendingHabits(input.state, input.dateKey).length}`);
    lines.push(`Активных разовых задач: ${activeOneOff(input.state).length}`);
  } else {
    lines.push('Данные привычек пока недоступны.');
  }

  lines.push(`Активных напоминаний: ${input.reminders}`);
  lines.push('', 'Настройки: WakanDa → «Инструменты и напоминания».');
  return lines.join('\n');
}
