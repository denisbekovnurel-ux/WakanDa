import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getStreak, isPaused, toDateKey, STATUS } from '../utils/calc';
import { useToday } from '../hooks/TodayContext';
import { useAppStore } from '../store/AppStore';
import { selectActiveHabits } from '../store/selectors';
import { useFeedback } from './FeedbackContext';
import { TIMINGS } from '../config/timings';
import { formatDate, useI18n } from '../i18n';
import type { Habit, HabitStatus } from '../types';

const weekdayOptions: Intl.DateTimeFormatOptions = { weekday: 'short' };
const monthOptions: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };

export function MonthGrid() {
  const { state, actions } = useAppStore();
  const tasks = selectActiveHabits(state);
  const { confirm, notify } = useFeedback();
  const { t } = useI18n();
  const { today, todayKey } = useToday();
  const [month, setMonth] = useState(() => {
    const current = new Date();
    return new Date(current.getFullYear(), current.getMonth(), 1);
  });
  const pressTimer = useRef<number | null>(null);
  const suppressTimer = useRef<number | null>(null);
  const suppressClicks = useRef(false);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) => new Date(year, monthIndex, index + 1, 12));
  const currentOrFutureMonth = year > today.getFullYear() || (year === today.getFullYear() && monthIndex >= today.getMonth());

  function changeMonth(offset: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  // Обычный клик: пусто → выполнено → пусто. «Провал» — long-press или правый клик,
  // чтобы случайно не зафиксировать пропуск вместо выполнения.
  function handleCellClick(task: Habit, dateKey: string, status: HabitStatus) {
    // Клик, сразу следующий за long-press, не должен «переключить» статус обратно.
    if (suppressClicks.current) {
      suppressClicks.current = false;
      return;
    }
    if (status === STATUS.DONE || status === STATUS.FAILED) actions.setHabitStatus(task.id, dateKey, STATUS.EMPTY);
    else actions.setHabitStatus(task.id, dateKey, STATUS.DONE);
  }

  function markFailed(task: Habit, dateKey: string) {
    actions.setHabitStatus(task.id, dateKey, STATUS.FAILED);
  }

  function startPress(task: Habit, dateKey: string, disabled: boolean) {
    if (disabled) return;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      suppressClicks.current = true;
      markFailed(task, dateKey);
      // Снимаем запрет, даже если клик после удержания так и не пришёл
      // (пальца увёл с кнопки): иначе первая следующая нажатия терялась бы.
      suppressTimer.current = window.setTimeout(() => { suppressClicks.current = false; }, TIMINGS.clickSuppressMs);
    }, TIMINGS.longPressMs);
  }

  function endPress() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  useEffect(() => () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    if (suppressTimer.current) window.clearTimeout(suppressTimer.current);
  }, []);

  async function archiveHabit(task: Habit) {
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
    <section className="month-panel" aria-label={t('Календарь привычек за месяц')}>
      <div className="month-toolbar">
        <div><p className="eyebrow">{t('НЕПРЕРЫВНЫЙ ПУТЬ')}</p><h2>{t('Ритм месяца')}</h2></div>
        <div className="month-controls">
          <button type="button" className="month-arrow" onClick={() => changeMonth(-1)} aria-label={t('Предыдущий месяц')}>‹</button>
          <time className="month-name" dateTime={`${year}-${String(monthIndex + 1).padStart(2, '0')}`}>{formatDate(month, monthOptions)}</time>
          <button type="button" className="month-arrow" onClick={() => changeMonth(1)} aria-label={t('Следующий месяц')} disabled={currentOrFutureMonth}>›</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="week-grid-empty">{t('Сначала добавь привычку — здесь появится календарь на весь месяц.')}</p>
      ) : (
        <div className="month-table-scroll" role="region" aria-label={t('Отметки по привычкам за месяц. На узком экране прокручивай календарь по горизонтали.')} tabIndex={0}>
          <div className="month-table" style={{ '--day-count': dayCount } as CSSProperties}>
            <div className="month-row month-row--head"><span className="month-habit-label">{t('Привычка')}</span>{days.map((day) => {
              const dateKey = toDateKey(day);
              return <span key={dateKey} className={`month-day-heading ${dateKey === todayKey ? 'is-today' : ''}`} title={`${formatDate(day, weekdayOptions)}, ${dateKey}`}><small>{formatDate(day, weekdayOptions)}</small>{day.getDate()}</span>;
            })}<span className="month-streak-label">{t('СЕРИЯ')}</span><span aria-hidden="true" /></div>
            {tasks.map((task) => (
              <div className="month-row" key={task.id}>
                <span className="month-habit-label" title={task.title}>{task.title}</span>
                {days.map((day) => {
                  const dateKey = toDateKey(day);
                  const status = task.history?.[dateKey] || STATUS.EMPTY;
                  const scheduled = (task.schedule || [0, 1, 2, 3, 4, 5, 6]).includes(day.getDay());
                  const future = dateKey > todayKey;
                  const beforeCreation = Boolean(task.createdAt && dateKey < task.createdAt);
                  const paused = !scheduled ? false : isPaused(task, dateKey);
                  const interactive = scheduled && !paused && !future && !beforeCreation;
                  const statusLabel = !scheduled
                    ? t('выходной по расписанию')
                    : future
                      ? t('будущее — отметка недоступна')
                      : beforeCreation
                        ? t('привычки ещё не было')
                        : paused
                          ? t('пауза')
                          : status === STATUS.DONE
                            ? t('выполнено')
                            : status === STATUS.FAILED
                              ? t('пропуск')
                              : t('не отмечено');
                  const actionHint = interactive
                    ? t('Клик — выполнено/снять, Delete — пропуск, удержание или правый клик — пропуск')
                    : '';
                  const readableDate = formatDate(day, { day: 'numeric', month: 'long' });
                  return <button type="button" key={dateKey} disabled={!interactive}
                    className={`month-day-cell month-day-cell--${paused ? 'paused' : status} ${dateKey === todayKey ? 'is-today' : ''} ${!scheduled ? 'is-rest' : ''} ${future ? 'is-future' : ''} ${beforeCreation ? 'is-before-creation' : ''} ${interactive && status === STATUS.EMPTY ? 'is-empty' : ''}`}
                    onClick={() => handleCellClick(task, dateKey, status)}
                    onKeyDown={(event) => {
                      // Пропуск доступен и с клавиатуры, а не только долгим нажатием/правым кликом.
                      if (interactive && ['Delete', 'Backspace', 'f', 'F', 'к', 'К'].includes(event.key)) {
                        event.preventDefault();
                        markFailed(task, dateKey);
                      }
                    }}
                    onContextMenu={(event) => { event.preventDefault(); if (interactive) markFailed(task, dateKey); }}
                    onPointerDown={() => startPress(task, dateKey, !interactive)}
                    onPointerUp={endPress}
                    onPointerLeave={endPress}
                    onPointerCancel={endPress}
                    aria-label={`${task.title}, ${dateKey}: ${statusLabel}${actionHint ? `. ${actionHint}` : ''}`}
                    title={`${readableDate} — ${statusLabel}`}><span>{!scheduled ? '—' : paused ? '‖' : status === STATUS.DONE ? '✓' : status === STATUS.FAILED ? '×' : ''}</span></button>;
                })}
                <span className="month-streak-label month-streak-value">{getStreak(task.history || {}, task.schedule || [0, 1, 2, 3, 4, 5, 6], today, task.pauseRanges || [])}<small>{t('дн.')}</small></span>
                <button className="delete-btn month-delete" type="button" onClick={() => archiveHabit(task)} aria-label={t('Переместить привычку {title} в архив', { title: task.title })} title={t('В архив')}>↧</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="month-legend" aria-label={t('Условные обозначения')}><span><i className="legend-dot legend-dot--done" /> {t('выполнено')}</span><span><i className="legend-dot legend-dot--failed" /> {t('пропуск')}</span><span><i className="legend-dot legend-dot--paused" /> {t('пауза')}</span><span><i className="legend-dot" /> {t('не отмечено')}</span></div>
      <p className="month-fail-hint"><b>{t('Как отметить пропуск:')}</b> {t('наведи на пустую ячейку — появится «×», затем удерживай её полсекунды, кликни правой кнопкой или нажми Delete.')}</p>
    </section>
  );
}
