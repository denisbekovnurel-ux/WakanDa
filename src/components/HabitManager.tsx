import { useState } from 'react';
import type { FormEvent } from 'react';
import { getHabitStats, isPaused } from '../utils/calc';
import { useAppStore } from '../store/AppStore';
import { useToday } from '../hooks/TodayContext';
import { firstError, habitFormSchema } from '../validation/schemas';
import { useFeedback } from './FeedbackContext';
import { useI18n } from '../i18n';
import type { Habit } from '../types';

const weekdays = [
  { value: 1, label: 'ПН' }, { value: 2, label: 'ВТ' }, { value: 3, label: 'СР' },
  { value: 4, label: 'ЧТ' }, { value: 5, label: 'ПТ' }, { value: 6, label: 'СБ' }, { value: 0, label: 'ВС' },
];
const weekdayNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function RenameHabitControls({ task }: { task: Habit }) {
  const { actions } = useAppStore();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  function save() {
    const title = draft.trim();
    if (title) actions.renameHabit(task.id, title);
    setEditing(false);
  }

  if (!editing) {
    return <button type="button" className="text-button" onClick={() => { setDraft(task.title); setEditing(true); }} aria-label={t('Переименовать {title}', { title: task.title })}>✎</button>;
  }
  return (
    <span className="rename-inline">
      <input type="text" value={draft} maxLength={80} aria-label={t('Новое название привычки')} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }} autoFocus />
      <button type="button" className="text-button" onClick={save}>{t('Сохранить')}</button>
      <button type="button" className="text-button" onClick={() => setEditing(false)}>{t('Отмена')}</button>
    </span>
  );
}

function PauseControls({ task }: { task: Habit }) {
  const { actions } = useAppStore();
  const { t } = useI18n();
  const { todayKey } = useToday();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(todayKey);
  const ranges = task.pauseRanges || [];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!from || !to || from > to) return;
    actions.pauseHabit(task.id, from, to);
    setOpen(false);
  }

  if (!open) {
    return <button type="button" className="text-button" onClick={() => setOpen(true)} aria-label={t('Пауза для {title}', { title: task.title })}>⏸ {t('Пауза')}</button>;
  }
  return (
    <form className="pause-editor" onSubmit={submit}>
      <label>{t('с')} <input type="date" value={from} min="2000-01-01" onChange={(event) => setFrom(event.target.value)} /></label>
      <label>{t('по')} <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button button--light" type="submit" disabled={!from || !to || from > to}>{t('Поставить')}</button>
      {ranges.length > 0 && <ul className="pause-list">{ranges.map((range) => <li key={`${range.from}${range.to}`}>{range.from} — {range.to}<button type="button" onClick={() => actions.unpauseHabit(task.id, range.from)} aria-label={t('Снять паузу с {date}', { date: range.from })}>{t('снять')}</button></li>)}</ul>}
      <p className="pause-hint">{t('Дни паузы нейтральны: серия не сгорает, процент за месяц не снижается.')}</p>
    </form>
  );
}

function HabitRow({ task, position, count }: { task: Habit; position: number; count: number }) {
  const { actions } = useAppStore();
  const { today, todayKey } = useToday();
  const { t } = useI18n();
  const { confirm, notify } = useFeedback();
  const stats = getHabitStats(task, today);
  const schedule = task.schedule || [0, 1, 2, 3, 4, 5, 6];
  const bestDay = stats.mostProductiveDay === null ? t('пока нет данных') : t(weekdayNames[stats.mostProductiveDay]);
  const pausedToday = isPaused(task, todayKey);

  async function removeHabit() {
    const confirmed = await confirm({
      title: t('Удалить привычку?'),
      message: t('«{title}» и вся история отметок будут удалены безвозвратно. Если хочешь сохранить историю, используй «В архив».', { title: task.title }),
      confirmText: t('Удалить'),
      tone: 'danger',
    });
    if (!confirmed) return;
    actions.deleteHabit(task.id);
    notify(t('Привычка «{title}» удалена.', { title: task.title }), { tone: 'success' });
  }

  async function archiveHabit() {
    const confirmed = await confirm({
      title: t('Переместить в архив?'),
      message: t('«{title}» исчезнет из активных привычек, но история сохранится. Привычку можно вернуть из архива.', { title: task.title }),
      confirmText: t('В архив'),
    });
    if (!confirmed) return;
    actions.archiveHabit(task.id);
    notify(t('«{title}» перемещена в архив.', { title: task.title }), { tone: 'success' });
  }

  return (
    <li className={`managed-habit ${task.archived ? 'is-archived' : ''}`}>
      <div className="managed-habit-main"><span className="managed-habit-name">{task.title}{pausedToday && <span className="pause-badge">{t('пауза')}</span>}</span><div className="managed-habit-stats"><span>{t('РЕКОРД')} <b>{stats.bestStreak} {t('дн.')}</b></span><span>{t('МЕСЯЦ')} <b>{stats.monthPercent}%</b></span><span>{t('ЛУЧШИЙ ДЕНЬ')} <b>{bestDay}</b></span></div></div>
      {!task.archived && <div className="schedule-pills" role="group" aria-label={t('Расписание привычки {title}', { title: task.title })}>
        {weekdays.map((day) => <button key={day.value} className={schedule.includes(day.value) ? 'is-selected' : ''} type="button" onClick={() => actions.changeHabitSchedule(task.id, day.value)} aria-pressed={schedule.includes(day.value)} aria-label={`${t(day.label)}: ${schedule.includes(day.value) ? t('по расписанию') : t('выходной')}`}>{t(day.label)}</button>)}
      </div>}
      <div className="managed-habit-actions">
        {!task.archived && <><button type="button" className="order-button" disabled={position === 0} onClick={() => actions.moveHabit(position, position - 1)} aria-label={t('Поднять {title} выше', { title: task.title })}>↑</button><button type="button" className="order-button" disabled={position === count - 1} onClick={() => actions.moveHabit(position, position + 1)} aria-label={t('Опустить {title} ниже', { title: task.title })}>↓</button><RenameHabitControls task={task} /><PauseControls task={task} /><button type="button" className="text-button" onClick={archiveHabit}>{t('В архив')}</button></>}
        {task.archived && <button type="button" className="text-button" onClick={() => actions.restoreHabit(task.id)}>{t('Вернуть')}</button>}
        <button type="button" className="delete-btn" onClick={removeHabit} aria-label={t('Удалить {title}', { title: task.title })}>×</button>
      </div>
    </li>
  );
}

export function HabitManager() {
  const { state, actions } = useAppStore();
  const { t } = useI18n();
  const tasks = state.tasks;
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [formError, setFormError] = useState('');
  const activeTasks = tasks.filter((task) => !task.archived);
  const archivedTasks = tasks.filter((task) => task.archived);

  function toggleDay(day: number) {
    setFormError('');
    setSchedule((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Раньше форма просто закрывалась: привычка не создавалась, а человек
    // решал, что всё нажатое потерялось. Теперь проверяет схема, а ошибка
    // всегда остаётся на экране рядом с формой.
    const parsed = habitFormSchema.safeParse({ title, schedule });
    if (!parsed.success) {
      setFormError(firstError(parsed));
      return;
    }
    setFormError('');
    actions.addHabit(parsed.data.title, weekdays.filter((day) => parsed.data.schedule.includes(day.value)).map((day) => day.value));
    setTitle('');
  }

  return (
    <div className="habit-manager">
      <form className="habit-add-form" onSubmit={handleSubmit} noValidate>
        <div className="habit-add-row"><label className="sr-only" htmlFor="habit-title">{t('Название привычки')}</label><input id="habit-title" type="text" maxLength={80} placeholder={t('Например, утренняя тренировка')} value={title} onChange={(event) => { setFormError(''); setTitle(event.target.value); }} required /><button className="button button--red" type="submit">{t('Добавить привычку')}</button></div>
        {formError && <p className="backup-message" role="alert">{formError}</p>}
        <div className="habit-schedule-create"><span>{t('Дни выполнения')}</span><div className="schedule-pills" role="group" aria-label={t('Дни выполнения новой привычки')}>{weekdays.map((day) => <button key={day.value} type="button" className={schedule.includes(day.value) ? 'is-selected' : ''} onClick={() => toggleDay(day.value)} aria-pressed={schedule.includes(day.value)}>{t(day.label)}</button>)}</div><span className="schedule-hint">{t('Выходные не прерывают серию')}</span></div>
      </form>

      <section className="habit-roster" aria-label={t('Активные привычки')}>
        {activeTasks.length ? <ul>{activeTasks.map((task, index) => <HabitRow key={task.id} task={task} position={index} count={activeTasks.length} />)}</ul> : <p className="one-off-empty">{t('Добавь первую привычку и выбери дни для неё.')}</p>}
      </section>

      <details className="habit-archive"><summary>{t('Архив привычек')} <span>{archivedTasks.length}</span></summary>{archivedTasks.length ? <ul>{archivedTasks.map((task) => <HabitRow key={task.id} task={task} position={0} count={0} />)}</ul> : <p>{t('Архивированных привычек пока нет.')}</p>}</details>
    </div>
  );
}
