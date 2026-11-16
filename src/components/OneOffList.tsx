import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAppStore } from '../store/AppStore';
import { useToday } from '../hooks/TodayContext';
import { firstError, oneOffFormSchema, oneOffReminderSchema } from '../validation/schemas';
import { useFeedback } from './FeedbackContext';
import { formatDate, useI18n } from '../i18n';
import type { OneOffPriority, OneOffTask } from '../types';

const priorityRank: Record<OneOffPriority, number> = { high: 0, normal: 1, low: 2 };
const deadlineOptions: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const reminderOptions: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** ISO-время → значение для `<input type="datetime-local">` (локальная зона). */
function toLocalDateTime(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function fromLocalDateTime(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

type TaskFilter = 'all' | 'overdue' | 'high';
type SortMode = 'auto' | 'manual';

function RenameOneOff({ task }: { task: OneOffTask }) {
  const { actions } = useAppStore();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  function save() {
    const parsed = oneOffFormSchema.pick({ title: true }).safeParse({ title: draft });
    // Пустое или слишком длинное имя не сохраняем и не закрываем редактирование:
    // иначе введённый текст исчезал бы без объяснения.
    if (!parsed.success) return;
    actions.renameOneOff(task.id, parsed.data.title);
    setEditing(false);
  }

  if (!editing) {
    return <button type="button" className="text-button" onClick={() => { setDraft(task.title); setEditing(true); }} aria-label={t('Переименовать {title}', { title: task.title })}>✎</button>;
  }
  return (
    <span className="rename-inline">
      <input type="text" value={draft} maxLength={100} aria-label={t('Новое название задачи')} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }} autoFocus />
      <button type="button" className="text-button" onClick={save}>{t('Сохранить')}</button>
      <button type="button" className="text-button" onClick={() => setEditing(false)}>{t('Отмена')}</button>
    </span>
  );
}

/** Напоминание о разовой задаче: меняется прямо в строке списка. */
function ReminderOneOff({ task }: { task: OneOffTask }) {
  const { actions } = useAppStore();
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function open() {
    setDraft(toLocalDateTime(task.reminderAt));
    setError('');
    setEditing(true);
  }

  function save() {
    const parsed = oneOffReminderSchema.safeParse({ reminderAt: draft });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    const reminderAt = fromLocalDateTime(parsed.data.reminderAt);
    if (reminderAt && Date.parse(reminderAt) <= Date.now()) {
      setError(t('Это время уже прошло — выбери будущее.'));
      return;
    }
    actions.setOneOffReminder(task.id, reminderAt);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`text-button one-off-reminder ${task.reminderAt ? 'is-set' : ''}`}
        onClick={open}
        aria-label={task.reminderAt
          ? t('Изменить напоминание для «{title}»', { title: task.title })
          : t('Напомнить о задаче «{title}»', { title: task.title })}
      >
        {task.reminderAt
          ? `⏰ ${formatDate(new Date(task.reminderAt), reminderOptions)}`
          : `⏰ ${t('Напомнить')}`}
      </button>
    );
  }

  return (
    <span className="rename-inline one-off-reminder-editor">
      <input
        type="datetime-local"
        value={draft}
        aria-label={t('Новое время напоминания')}
        onChange={(event) => { setError(''); setDraft(event.target.value); }}
        onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      <button type="button" className="text-button" onClick={save}>{t('Сохранить')}</button>
      {task.reminderAt && (
        <button type="button" className="text-button" onClick={() => { actions.setOneOffReminder(task.id, ''); setEditing(false); }}>{t('Убрать')}</button>
      )}
      <button type="button" className="text-button" onClick={() => setEditing(false)}>{t('Отмена')}</button>
      {error && <span className="one-off-reminder-error" role="alert">{error}</span>}
    </span>
  );
}

export function OneOffList() {
  const { state, actions } = useAppStore();
  const { t } = useI18n();
  const { todayKey } = useToday();
  const tasks = state.oneOffTasks;
  const { confirm, notify } = useFeedback();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [reminder, setReminder] = useState('');
  const [priority, setPriority] = useState<OneOffPriority>('normal');
  const [formError, setFormError] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('auto');

  let activeTasks = tasks.filter((task) => !task.done);
  if (filter === 'overdue') activeTasks = activeTasks.filter((task) => task.deadline && task.deadline < todayKey);
  if (filter === 'high') activeTasks = activeTasks.filter((task) => task.priority === 'high');
  if (sortMode === 'auto') {
    activeTasks = [...activeTasks].sort((first, second) => {
      if (first.deadline && second.deadline && first.deadline !== second.deadline) return first.deadline.localeCompare(second.deadline);
      if (first.deadline && !second.deadline) return -1;
      if (!first.deadline && second.deadline) return 1;
      return (priorityRank[first.priority] ?? 1) - (priorityRank[second.priority] ?? 1);
    });
  } else {
    // вручную — порядок из хранилища (tasks), сохраняем его
    const order = new Map(tasks.map((task, index) => [task.id, index]));
    activeTasks = [...activeTasks].sort((first, second) => (order.get(first.id) ?? 0) - (order.get(second.id) ?? 0));
  }
  const completedTasks = tasks.filter((task) => task.done);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = oneOffFormSchema.safeParse({ title, deadline, priority, reminderAt: reminder });
    if (!parsed.success) {
      setFormError(firstError(parsed));
      return;
    }
    const reminderAt = fromLocalDateTime(parsed.data.reminderAt);
    if (reminderAt && Date.parse(reminderAt) <= Date.now()) {
      setFormError(t('Время напоминания уже прошло — выбери будущее.'));
      return;
    }
    setFormError('');
    actions.addOneOff(parsed.data.title, {
      deadline: parsed.data.deadline,
      priority: parsed.data.priority,
      reminderAt: reminderAt || undefined,
    }, todayKey);
    setTitle('');
    setDeadline('');
    setReminder('');
    setPriority('normal');
  }

  async function removeTask(task: OneOffTask) {
    const confirmed = await confirm({
      title: t('Удалить задачу?'),
      message: t('Разовая задача «{title}» будет удалена безвозвратно.', { title: task.title }),
      confirmText: t('Удалить'),
      tone: 'danger',
    });
    if (!confirmed) return;
    actions.deleteOneOff(task.id);
    notify(t('Задача «{title}» удалена.', { title: task.title }), { tone: 'success' });
  }

  function renderTask(task: OneOffTask, index: number, group: OneOffTask[]) {
    return (
      <li className={`one-off-item ${task.done ? 'one-off-item--done' : ''}`} key={task.id}>
        <button className="one-off-check" type="button" onClick={() => actions.toggleOneOff(task.id)} aria-label={`${task.done ? t('Вернуть в активные') : t('Отметить выполненной')}: ${task.title}`} aria-pressed={task.done}>{task.done ? '✓' : ''}</button>
        <span className="one-off-title">{task.title}</span>
        {task.priority && <span className={`one-off-priority one-off-priority--${task.priority}`}>{task.priority === 'high' ? t('ВЫСОКИЙ') : task.priority === 'low' ? t('НИЗКИЙ') : t('ОБЫЧНЫЙ')}</span>}
        {task.deadline && <time className={`one-off-deadline ${!task.done && task.deadline < todayKey ? 'is-overdue' : ''}`} dateTime={task.deadline}>{task.deadline < todayKey && !task.done ? `${t('ПРОСРОЧЕНО')} · ` : `${t('ДО')} · `}{formatDate(new Date(`${task.deadline}T00:00:00`), deadlineOptions)}</time>}
        {task.done && <span className="one-off-complete-label">{t('ЗАКРЫТА')}</span>}
        {!task.done && <ReminderOneOff task={task} />}
        {!task.done && <RenameOneOff task={task} />}
        {!task.done && sortMode === 'manual' && filter === 'all' && (
          <span className="order-buttons">
            <button type="button" className="order-button" disabled={index === 0} onClick={() => actions.moveOneOff(task.id, -1)} aria-label={t('Поднять {title}', { title: task.title })}>↑</button>
            <button type="button" className="order-button" disabled={index === group.length - 1} onClick={() => actions.moveOneOff(task.id, 1)} aria-label={t('Опустить {title}', { title: task.title })}>↓</button>
          </span>
        )}
        <button className="delete-btn" type="button" onClick={() => removeTask(task)} aria-label={t('Удалить разовую задачу {title}', { title: task.title })}>×</button>
      </li>
    );
  }

  return (
    <div className="one-off-list">
      <form className="add-form" onSubmit={handleSubmit} noValidate>
        <input type="text" aria-label={t('Название разовой задачи')} placeholder={t('Например, отправить документы')} value={title} onChange={(event) => { setFormError(''); setTitle(event.target.value); }} maxLength={100} required />
        <div className="one-off-form-options"><label>{t('Срок')}<input type="date" min={todayKey} aria-label={t('Срок выполнения')} value={deadline} onChange={(event) => { setFormError(''); setDeadline(event.target.value); }} /></label><label>{t('Напомнить')}<input type="datetime-local" aria-label={t('Время напоминания')} value={reminder} onChange={(event) => { setFormError(''); setReminder(event.target.value); }} /></label><label>{t('Приоритет')}<select aria-label={t('Приоритет задачи')} value={priority} onChange={(event) => { setFormError(''); setPriority(event.target.value as OneOffPriority); }}><option value="high">{t('Высокий')}</option><option value="normal">{t('Обычный')}</option><option value="low">{t('Низкий')}</option></select></label></div>
        <button type="submit" className="button button--red"><span aria-hidden="true">＋</span> {t('Добавить задачу')}</button>
        {formError && <p className="backup-message" role="alert">{formError}</p>}
      </form>

      <div className="one-off-toolbar">
        <div className="filter-pills" role="group" aria-label={t('Фильтр задач')}>
          {([['all', 'Все'], ['overdue', 'Просроченные'], ['high', 'Высокий приоритет']] as const).map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? 'is-selected' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>{t(label)}</button>
          ))}
        </div>
        <div className="filter-pills" role="group" aria-label={t('Порядок сортировки')}>
          {([['auto', 'По сроку/приоритету'], ['manual', 'Вручную']] as const).map(([value, label]) => (
            <button key={value} type="button" className={sortMode === value ? 'is-selected' : ''} onClick={() => setSortMode(value)} aria-pressed={sortMode === value}>{t(label)}</button>
          ))}
        </div>
      </div>

      <section className="one-off-group" aria-labelledby="active-oneoff-title">
        <h2 id="active-oneoff-title">{t('В работе')} <span>{activeTasks.length}</span></h2>
        {activeTasks.length ? <ul>{activeTasks.map((task, index) => renderTask(task, index, activeTasks))}</ul> : <p className="one-off-empty">{t('Здесь пусто. Добавь дело и закрой его.')}</p>}
      </section>
      <section className="one-off-group one-off-archive" aria-labelledby="done-oneoff-title">
        <h2 id="done-oneoff-title">{t('Архив выполненного')} <span>{completedTasks.length}</span></h2>
        {completedTasks.length ? <ul>{completedTasks.map((task) => renderTask(task, 0, completedTasks))}</ul> : <p className="one-off-empty">{t('Завершённые дела останутся здесь зачёркнутыми.')}</p>}
      </section>
    </div>
  );
}
