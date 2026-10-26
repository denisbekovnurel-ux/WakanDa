import { useState } from 'react';
import { getHabitStats, isPaused } from '../utils/calc';
import { useAppStore } from '../store/AppStore';
import { useToday } from '../hooks/TodayContext';
import { useFeedback } from './FeedbackContext';

const weekdays = [
  { value: 1, label: 'ПН' }, { value: 2, label: 'ВТ' }, { value: 3, label: 'СР' },
  { value: 4, label: 'ЧТ' }, { value: 5, label: 'ПТ' }, { value: 6, label: 'СБ' }, { value: 0, label: 'ВС' },
];
const weekdayNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function RenameHabitControls({ task }) {
  const { actions } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  function save() {
    const title = draft.trim();
    if (title) actions.renameHabit(task.id, title);
    setEditing(false);
  }

  if (!editing) {
    return <button type="button" className="text-button" onClick={() => { setDraft(task.title); setEditing(true); }} aria-label={`Переименовать ${task.title}`}>✎</button>;
  }
  return (
    <span className="rename-inline">
      <input type="text" value={draft} maxLength="80" aria-label="Новое название привычки" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }} autoFocus />
      <button type="button" className="text-button" onClick={save}>Сохранить</button>
      <button type="button" className="text-button" onClick={() => setEditing(false)}>Отмена</button>
    </span>
  );
}

function PauseControls({ task }) {
  const { actions } = useAppStore();
  const { todayKey } = useToday();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(todayKey);
  const ranges = task.pauseRanges || [];

  function submit(event) {
    event.preventDefault();
    if (!from || !to || from > to) return;
    actions.pauseHabit(task.id, from, to);
    setOpen(false);
  }

  if (!open) {
    return <button type="button" className="text-button" onClick={() => setOpen(true)} aria-label={`Пауза для ${task.title}`}>⏸ Пауза</button>;
  }
  return (
    <form className="pause-editor" onSubmit={submit}>
      <label>с <input type="date" value={from} min="2000-01-01" onChange={(event) => setFrom(event.target.value)} /></label>
      <label>по <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button button--light" type="submit" disabled={!from || !to || from > to}>Поставить</button>
      {ranges.length > 0 && <ul className="pause-list">{ranges.map((range) => <li key={`${range.from}${range.to}`}>{range.from} — {range.to}<button type="button" onClick={() => actions.unpauseHabit(task.id, range.from)} aria-label={`Снять паузу с ${range.from}`}>снять</button></li>)}</ul>}
      <p className="pause-hint">Дни паузы нейтральны: серия не сгорает, процент за месяц не снижается.</p>
    </form>
  );
}

function HabitRow({ task, position, count }) {
  const { actions } = useAppStore();
  const { today, todayKey } = useToday();
  const { confirm, notify } = useFeedback();
  const stats = getHabitStats(task, today);
  const schedule = task.schedule || [0, 1, 2, 3, 4, 5, 6];
  const bestDay = stats.mostProductiveDay === null ? 'пока нет данных' : weekdayNames[stats.mostProductiveDay];
  const pausedToday = isPaused(task, todayKey);

  async function removeHabit() {
    const confirmed = await confirm({
      title: 'Удалить привычку?',
      message: `«${task.title}» и вся история отметок будут удалены безвозвратно. Если хочешь сохранить историю, используй «В архив».`,
      confirmText: 'Удалить',
      tone: 'danger',
    });
    if (!confirmed) return;
    actions.deleteHabit(task.id);
    notify(`Привычка «${task.title}» удалена.`, { tone: 'success' });
  }

  async function archiveHabit() {
    const confirmed = await confirm({
      title: 'Переместить в архив?',
      message: `«${task.title}» исчезнет из активных привычек, но история сохранится. Привычку можно вернуть из архива.`,
      confirmText: 'В архив',
    });
    if (!confirmed) return;
    actions.archiveHabit(task.id);
    notify(`«${task.title}» перемещена в архив.`, { tone: 'success' });
  }

  return (
    <li className={`managed-habit ${task.archived ? 'is-archived' : ''}`}>
      <div className="managed-habit-main"><span className="managed-habit-name">{task.title}{pausedToday && <span className="pause-badge">пауза</span>}</span><div className="managed-habit-stats"><span>РЕКОРД <b>{stats.bestStreak} дн.</b></span><span>МЕСЯЦ <b>{stats.monthPercent}%</b></span><span>ЛУЧШИЙ ДЕНЬ <b>{bestDay}</b></span></div></div>
      {!task.archived && <div className="schedule-pills" role="group" aria-label={`Расписание привычки ${task.title}`}>
        {weekdays.map((day) => <button key={day.value} className={schedule.includes(day.value) ? 'is-selected' : ''} type="button" onClick={() => actions.changeHabitSchedule(task.id, day.value)} aria-pressed={schedule.includes(day.value)} aria-label={`${day.label}: ${schedule.includes(day.value) ? 'по расписанию' : 'выходной'}`}>{day.label}</button>)}
      </div>}
      <div className="managed-habit-actions">
        {!task.archived && <><button type="button" className="order-button" disabled={position === 0} onClick={() => actions.moveHabit(position, position - 1)} aria-label={`Поднять ${task.title} выше`}>↑</button><button type="button" className="order-button" disabled={position === count - 1} onClick={() => actions.moveHabit(position, position + 1)} aria-label={`Опустить ${task.title} ниже`}>↓</button><RenameHabitControls task={task} /><PauseControls task={task} /><button type="button" className="text-button" onClick={archiveHabit}>В архив</button></>}
        {task.archived && <button type="button" className="text-button" onClick={() => actions.restoreHabit(task.id)}>Вернуть</button>}
        <button type="button" className="delete-btn" onClick={removeHabit} aria-label={`Удалить ${task.title}`}>×</button>
      </div>
    </li>
  );
}

export function HabitManager() {
  const { state, actions } = useAppStore();
  const tasks = state.tasks;
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [formError, setFormError] = useState('');
  const activeTasks = tasks.filter((task) => !task.archived);
  const archivedTasks = tasks.filter((task) => task.archived);

  function toggleDay(day) {
    setFormError('');
    setSchedule((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    // Раньше форма просто закрывалась: привычка не создавалась, а человек
    // решал, что всё нажатое потерялось.
    if (!trimmedTitle) {
      setFormError('Укажи название привычки.');
      return;
    }
    if (schedule.length === 0) {
      setFormError('Выбери хотя бы один день выполнения.');
      return;
    }
    setFormError('');
    actions.addHabit(trimmedTitle, weekdays.filter((day) => schedule.includes(day.value)).map((day) => day.value));
    setTitle('');
  }

  return (
    <div className="habit-manager">
      <form className="habit-add-form" onSubmit={handleSubmit} noValidate>
        <div className="habit-add-row"><label className="sr-only" htmlFor="habit-title">Название привычки</label><input id="habit-title" type="text" maxLength="80" placeholder="Например, утренняя тренировка" value={title} onChange={(event) => { setFormError(''); setTitle(event.target.value); }} required /><button className="button button--red" type="submit">Добавить привычку</button></div>
        {formError && <p className="backup-message" role="alert">{formError}</p>}
        <div className="habit-schedule-create"><span>Дни выполнения</span><div className="schedule-pills" role="group" aria-label="Дни выполнения новой привычки">{weekdays.map((day) => <button key={day.value} type="button" className={schedule.includes(day.value) ? 'is-selected' : ''} onClick={() => toggleDay(day.value)} aria-pressed={schedule.includes(day.value)}>{day.label}</button>)}</div><span className="schedule-hint">Выходные не прерывают серию</span></div>
      </form>

      <section className="habit-roster" aria-label="Активные привычки">
        {activeTasks.length ? <ul>{activeTasks.map((task, index) => <HabitRow key={task.id} task={task} position={index} count={activeTasks.length} />)}</ul> : <p className="one-off-empty">Добавь первую привычку и выбери дни для неё.</p>}
      </section>

      <details className="habit-archive"><summary>Архив привычек <span>{archivedTasks.length}</span></summary>{archivedTasks.length ? <ul>{archivedTasks.map((task) => <HabitRow key={task.id} task={task} position={0} count={0} />)}</ul> : <p>Архивированных привычек пока нет.</p>}</details>
    </div>
  );
}
