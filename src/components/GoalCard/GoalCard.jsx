import { useEffect, useRef, useState } from 'react';
import { getGoalProgress, toDateKey } from '../../utils/calc';
import { useAppStore } from '../../store/AppStore';
import { pluralize } from '../../utils/pluralize';
import { fireConfetti } from '../../utils/confetti';
import { ProgressRing } from '../ProgressRing/ProgressRing';
import './GoalCard.css';

/**
 * goal: { id, title, unit, target, current, dailyRate, createdAt }
 * onDelete: () => void
 */
export function GoalCard({ goal, onDelete }) {
  const { actions } = useAppStore();
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal.title);
  const progress = getGoalProgress(goal);
  const wasDone = useRef(progress.isDone);

  // Конфетти — только при переходе в «выполнено», а не на каждый рендер
  useEffect(() => {
    if (progress.isDone && !wasDone.current) fireConfetti();
    wasDone.current = progress.isDone;
  }, [progress.isDone]);

  const today = new Date();
  const chartDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - 6 + index);
    const key = toDateKey(day);
    return { key, label: new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(day), amount: (goal.log || []).reduce((total, item) => total + (item.date === key ? Number(item.amount) || 0 : 0), 0) };
  });
  const chartMaximum = Math.max(goal.dailyRate || 0, ...chartDays.map((day) => day.amount), 1);

  function handleSubmit(e) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    actions.addGoalProgress(goal.id, value, toDateKey(new Date()));
    setAmount('');
  }

  function saveRename() {
    const title = draft.trim();
    if (title) actions.renameGoal(goal.id, title);
    setEditing(false);
  }

  return (
    <li className={`goal-card ${progress.isDone ? 'goal-card--done' : ''}`}>
      <button type="button" className="delete-btn" onClick={onDelete} aria-label={`Удалить цель ${goal.title}`}>×</button>

      <ProgressRing percent={progress.percent} size={80} />

      <div className="goal-card-info">
        {editing ? (
          <span className="rename-inline">
            <input type="text" value={draft} maxLength="80" aria-label="Новое название цели" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveRename(); if (event.key === 'Escape') setEditing(false); }} autoFocus />
            <button type="button" className="text-button" onClick={saveRename}>Сохранить</button>
            <button type="button" className="text-button" onClick={() => setEditing(false)}>Отмена</button>
          </span>
        ) : (
          <h3>{goal.title} <button type="button" className="text-button" aria-label={`Переименовать цель ${goal.title}`} onClick={() => { setDraft(goal.title); setEditing(true); }}>✎</button></h3>
        )}
        <p className="goal-card-stats">
          {progress.current} / {goal.target} {goal.unit}
        </p>

        {progress.isDone ? (
          <p className="goal-card-done-label">🎉 цель выполнена{progress.current > goal.target ? ` · сверх плана на ${progress.current - goal.target} ${goal.unit}` : ''}</p>
        ) : (
          <p className="goal-card-forecast">
            осталось {progress.remaining} {goal.unit} · ~{progress.daysLeft}{' '}
            {pluralize(progress.daysLeft, 'день', 'дня', 'дней')}
            {progress.actualRate > 0 && (
              <span className="goal-card-rate"> (твой темп: {progress.actualRate}/день)</span>
            )}
          </p>
        )}

        <p className={`goal-today ${progress.todayProgress >= progress.dailyRate ? 'is-met' : ''}`}>Норма сегодня: {progress.todayProgress} / {progress.dailyRate} {goal.unit}</p>
        <div className="goal-history-chart" role="img" aria-label="История прогресса за последние семь дней">
          <svg viewBox="0 0 220 58" preserveAspectRatio="none" aria-hidden="true">
            <line x1="3" y1="49" x2="217" y2="49" />
            {chartDays.map((day, index) => {
              const height = day.amount ? Math.max(3, (day.amount / chartMaximum) * 43) : 2;
              return <g key={day.key}><title>{day.key}: {day.amount} {goal.unit}</title><rect className={day.key === toDateKey(today) ? 'is-today' : ''} x={7 + index * 30} y={49 - height} width="15" height={height} rx="3" /><text x={14.5 + index * 30} y="57" textAnchor="middle">{day.label.slice(0, 2)}</text></g>;
            })}
          </svg>
        </div>
        {Number(amount) > progress.remaining && <p className="goal-overrun-note">Будет учтён весь объём: цель превысится на {Number(amount) - progress.remaining} {goal.unit}.</p>}
        <div className="goal-card-actions">
          <button type="button" className="button button--light goal-norm-button" onClick={() => actions.addGoalProgress(goal.id, progress.dailyRate, toDateKey(new Date()))} aria-label={`Добавить дневную норму ${progress.dailyRate} ${goal.unit} к цели ${goal.title}`}>+{progress.dailyRate} норма в день</button>
          <form className="goal-card-form" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor={`progress-${goal.id}`}>Добавить прогресс: {goal.unit}</label>
            <input
              id={`progress-${goal.id}`}
              type="number"
              min="1"
              placeholder={`+${goal.unit} сегодня`}
              aria-label={`Добавить прогресс к цели «${goal.title}», ${goal.unit}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button type="submit" className="button button--light" aria-label={`Добавить прогресс к цели ${goal.title}`}>Добавить</button>
          </form>
        </div>
      </div>
    </li>
  );
}
