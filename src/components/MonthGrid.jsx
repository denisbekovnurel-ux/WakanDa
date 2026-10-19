import { useRef, useState } from 'react';
import { getStreak, isPaused, toDateKey, STATUS } from '../utils/calc';
import { useAppStore } from '../store/AppStore';

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

export function MonthGrid({ tasks }) {
  const { actions } = useAppStore();
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const todayKey = toDateKey(new Date());
  const days = Array.from({ length: dayCount }, (_, index) => new Date(year, monthIndex, index + 1));

  function changeMonth(offset) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  // Обычный клик: пусто → выполнено → пусто. «Провал» — long-press или правый клик,
  // чтобы случайно не зафиксировать пропуск вместо выполнения.
  function handleCellClick(task, dateKey, status) {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (status === STATUS.DONE || status === STATUS.FAILED) actions.setHabitStatus(task.id, dateKey, STATUS.EMPTY);
    else actions.setHabitStatus(task.id, dateKey, STATUS.DONE);
  }

  function markFailed(task, dateKey) {
    actions.setHabitStatus(task.id, dateKey, STATUS.FAILED);
  }

  function startPress(task, dateKey) {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      markFailed(task, dateKey);
    }, 500);
  }

  function endPress() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  return (
    <section className="month-panel" aria-label="Календарь привычек за месяц">
      <div className="month-toolbar">
        <div><p className="eyebrow">НЕПРЕРЫВНЫЙ ПУТЬ</p><h2>Ритм месяца</h2></div>
        <div className="month-controls">
          <button type="button" className="month-arrow" onClick={() => changeMonth(-1)} aria-label="Предыдущий месяц">‹</button>
          <time className="month-name" dateTime={`${year}-${String(monthIndex + 1).padStart(2, '0')}`}>{monthFormatter.format(month)}</time>
          <button type="button" className="month-arrow" onClick={() => changeMonth(1)} aria-label="Следующий месяц">›</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="week-grid-empty">Сначала добавь привычку — здесь появится календарь на весь месяц.</p>
      ) : (
        <div className="month-table-scroll" role="region" aria-label="Отметки по привычкам за месяц. На узком экране прокручивай календарь по горизонтали." tabIndex="0">
          <div className="month-table" style={{ '--day-count': dayCount }}>
            <div className="month-row month-row--head"><span className="month-habit-label">Привычка</span>{days.map((day) => {
              const dateKey = toDateKey(day);
              return <span key={dateKey} className={`month-day-heading ${dateKey === todayKey ? 'is-today' : ''}`} title={`${weekdayFormatter.format(day)}, ${dateKey}`}><small>{weekdayFormatter.format(day)}</small>{day.getDate()}</span>;
            })}<span className="month-streak-label">СЕРИЯ</span><span aria-hidden="true" /></div>
            {tasks.map((task) => (
              <div className="month-row" key={task.id}>
                <span className="month-habit-label" title={task.title}>{task.title}</span>
                {days.map((day) => {
                  const dateKey = toDateKey(day);
                  const status = task.history?.[dateKey] || STATUS.EMPTY;
                  const scheduled = (task.schedule || [0, 1, 2, 3, 4, 5, 6]).includes(day.getDay());
                  const paused = !scheduled ? false : isPaused(task, dateKey);
                  const interactive = scheduled && !paused;
                  const statusLabel = !scheduled ? 'выходной по расписанию' : paused ? 'пауза' : status === STATUS.DONE ? 'выполнено' : status === STATUS.FAILED ? 'пропуск' : 'не отмечено';
                  return <button type="button" key={dateKey} disabled={!interactive}
                    className={`month-day-cell month-day-cell--${paused ? 'paused' : status} ${dateKey === todayKey ? 'is-today' : ''} ${!scheduled ? 'is-rest' : ''} ${interactive && status === STATUS.EMPTY ? 'is-empty' : ''}`}
                    onClick={() => handleCellClick(task, dateKey, status)}
                    onKeyDown={(event) => {
                      // Пропуск доступен и с клавиатуры, а не только долгим нажатием/правым кликом.
                      if (interactive && ['Delete', 'Backspace', 'f', 'F', 'к', 'К'].includes(event.key)) {
                        event.preventDefault();
                        markFailed(task, dateKey);
                      }
                    }}
                    onContextMenu={(event) => { event.preventDefault(); if (interactive) markFailed(task, dateKey); }}
                    onPointerDown={() => startPress(task, dateKey)}
                    onPointerUp={endPress}
                    onPointerLeave={endPress}
                    onPointerCancel={endPress}
                    aria-label={`${task.title}, ${dateKey}: ${statusLabel}${interactive ? '. Клик — выполнено/снять, Delete — пропуск, удержание или правый клик — пропуск' : ''}`}
                    title={`${dateKey} — ${statusLabel}`}><span>{!scheduled ? '—' : paused ? '‖' : status === STATUS.DONE ? '✓' : status === STATUS.FAILED ? '×' : ''}</span></button>;
                })}
                <span className="month-streak-label month-streak-value">{getStreak(task.history || {}, task.schedule || [0, 1, 2, 3, 4, 5, 6], new Date(), task.pauseRanges || [])}<small>дн.</small></span>
                <button className="delete-btn month-delete" type="button" onClick={() => actions.archiveHabit(task.id)} aria-label={`Переместить привычку ${task.title} в архив`} title="В архив">↧</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="month-legend" aria-label="Условные обозначения"><span><i className="legend-dot legend-dot--done" /> выполнено</span><span><i className="legend-dot legend-dot--failed" /> пропуск</span><span><i className="legend-dot legend-dot--paused" /> пауза</span><span><i className="legend-dot" /> не отмечено</span><span className="month-scroll-hint">Узкий экран — прокрути календарь в сторону.</span></div>
      <p className="month-fail-hint"><b>Как отметить пропуск:</b> наведи на пустую ячейку — появится «×», затем удерживай её полсекунды, кликни правой кнопкой или нажми Delete.</p>
    </section>
  );
}
