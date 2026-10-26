import { useState } from 'react';
import { useAppStore } from '../store/AppStore';
import { useToday } from '../hooks/TodayContext';
import { firstError, oneOffFormSchema } from '../validation/schemas';
import { useFeedback } from './FeedbackContext';

const priorityRank = { high: 0, normal: 1, low: 2 };

function RenameOneOff({ task }) {
  const { actions } = useAppStore();
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
    return <button type="button" className="text-button" onClick={() => { setDraft(task.title); setEditing(true); }} aria-label={`Переименовать ${task.title}`}>✎</button>;
  }
  return (
    <span className="rename-inline">
      <input type="text" value={draft} maxLength="100" aria-label="Новое название задачи" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }} autoFocus />
      <button type="button" className="text-button" onClick={save}>Сохранить</button>
      <button type="button" className="text-button" onClick={() => setEditing(false)}>Отмена</button>
    </span>
  );
}

export function OneOffList() {
  const { state, actions } = useAppStore();
  const { todayKey } = useToday();
  const tasks = state.oneOffTasks;
  const { confirm, notify } = useFeedback();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('normal');
  const [formError, setFormError] = useState('');
  const [filter, setFilter] = useState('all'); // all | overdue | high
  const [sortMode, setSortMode] = useState('auto'); // auto | manual

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

  function handleSubmit(event) {
    event.preventDefault();
    const parsed = oneOffFormSchema.safeParse({ title, deadline, priority });
    if (!parsed.success) {
      setFormError(firstError(parsed));
      return;
    }
    setFormError('');
    actions.addOneOff(parsed.data.title, { deadline: parsed.data.deadline, priority: parsed.data.priority }, todayKey);
    setTitle('');
    setDeadline('');
    setPriority('normal');
  }

  async function removeTask(task) {
    const confirmed = await confirm({
      title: 'Удалить задачу?',
      message: `Разовая задача «${task.title}» будет удалена безвозвратно.`,
      confirmText: 'Удалить',
      tone: 'danger',
    });
    if (!confirmed) return;
    actions.deleteOneOff(task.id);
    notify(`Задача «${task.title}» удалена.`, { tone: 'success' });
  }

  function renderTask(task, index, group) {
    return (
      <li className={`one-off-item ${task.done ? 'one-off-item--done' : ''}`} key={task.id}>
        <button className="one-off-check" type="button" onClick={() => actions.toggleOneOff(task.id)} aria-label={`${task.done ? 'Вернуть в активные' : 'Отметить выполненной'}: ${task.title}`} aria-pressed={task.done}>{task.done ? '✓' : ''}</button>
        <span className="one-off-title">{task.title}</span>
        {task.priority && <span className={`one-off-priority one-off-priority--${task.priority}`}>{task.priority === 'high' ? 'ВЫСОКИЙ' : task.priority === 'low' ? 'НИЗКИЙ' : 'ОБЫЧНЫЙ'}</span>}
        {task.deadline && <time className={`one-off-deadline ${!task.done && task.deadline < todayKey ? 'is-overdue' : ''}`} dateTime={task.deadline}>{task.deadline < todayKey && !task.done ? 'ПРОСРОЧЕНО · ' : 'ДО · '}{task.deadline}</time>}
        {task.done && <span className="one-off-complete-label">ЗАКРЫТА</span>}
        {!task.done && <RenameOneOff task={task} />}
        {!task.done && sortMode === 'manual' && filter === 'all' && (
          <span className="order-buttons">
            <button type="button" className="order-button" disabled={index === 0} onClick={() => actions.moveOneOff(task.id, -1)} aria-label={`Поднять ${task.title}`}>↑</button>
            <button type="button" className="order-button" disabled={index === group.length - 1} onClick={() => actions.moveOneOff(task.id, 1)} aria-label={`Опустить ${task.title}`}>↓</button>
          </span>
        )}
        <button className="delete-btn" type="button" onClick={() => removeTask(task)} aria-label={`Удалить разовую задачу ${task.title}`}>×</button>
      </li>
    );
  }

  return (
    <div className="one-off-list">
      <form className="add-form" onSubmit={handleSubmit} noValidate>
        <input type="text" aria-label="Название разовой задачи" placeholder="Например, отправить документы" value={title} onChange={(event) => { setFormError(''); setTitle(event.target.value); }} maxLength="100" required />
        <div className="one-off-form-options"><label>Срок<input type="date" min={todayKey} aria-label="Срок выполнения" value={deadline} onChange={(event) => { setFormError(''); setDeadline(event.target.value); }} /></label><label>Приоритет<select aria-label="Приоритет задачи" value={priority} onChange={(event) => { setFormError(''); setPriority(event.target.value); }}><option value="high">Высокий</option><option value="normal">Обычный</option><option value="low">Низкий</option></select></label></div>
        <button type="submit" className="button button--red"><span aria-hidden="true">＋</span> Добавить задачу</button>
        {formError && <p className="backup-message" role="alert">{formError}</p>}
      </form>

      <div className="one-off-toolbar">
        <div className="filter-pills" role="group" aria-label="Фильтр задач">
          {[['all', 'Все'], ['overdue', 'Просроченные'], ['high', 'Высокий приоритет']].map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? 'is-selected' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>
          ))}
        </div>
        <div className="filter-pills" role="group" aria-label="Порядок сортировки">
          {[['auto', 'По сроку/приоритету'], ['manual', 'Вручную']].map(([value, label]) => (
            <button key={value} type="button" className={sortMode === value ? 'is-selected' : ''} onClick={() => setSortMode(value)} aria-pressed={sortMode === value}>{label}</button>
          ))}
        </div>
      </div>

      <section className="one-off-group" aria-labelledby="active-oneoff-title">
        <h2 id="active-oneoff-title">В работе <span>{activeTasks.length}</span></h2>
        {activeTasks.length ? <ul>{activeTasks.map((task, index) => renderTask(task, index, activeTasks))}</ul> : <p className="one-off-empty">Здесь пусто. Добавь дело и закрой его.</p>}
      </section>
      <section className="one-off-group one-off-archive" aria-labelledby="done-oneoff-title">
        <h2 id="done-oneoff-title">Архив выполненного <span>{completedTasks.length}</span></h2>
        {completedTasks.length ? <ul>{completedTasks.map((task) => renderTask(task, 0, completedTasks))}</ul> : <p className="one-off-empty">Завершённые дела останутся здесь зачёркнутыми.</p>}
      </section>
    </div>
  );
}
