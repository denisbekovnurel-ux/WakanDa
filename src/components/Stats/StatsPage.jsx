import { useMemo, useState } from 'react';
import { useToday } from '../../hooks/useToday';
import {
  buildDayPercent,
  getBestStreak,
  getHabitStats,
  getMonthSummary,
  getMostProductiveWeekday,
  getPercentDelta,
  getStreak,
  toDateKey,
} from '../../utils/calc';
import { getBadges } from '../../utils/badges';
import { useAppStore } from '../../store/AppStore';
import { ProgressRing } from '../ProgressRing/ProgressRing';
import { createProgressCard, shareOrDownload } from '../../utils/shareCard';
import { useFeedback } from '../FeedbackContext';

const FULL_SCHEDULE = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const HEATMAP_WEEKDAYS = ['', 'Пн', '', 'Ср', '', 'Пт', ''];
const monthLong = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

function heatCellClass(percent) {
  if (percent === null) return 'heat-cell--rest';
  if (percent >= 1) return 'heat-cell--full';
  if (percent > 0.5) return 'heat-cell--high';
  if (percent > 0) return 'heat-cell--low';
  return 'heat-cell--zero';
}

function heatCellTitle(day) {
  return `${day.key} (${WEEKDAY_SHORT[day.date.getDay()]}): ${day.percent === null ? 'без привычек' : `${Math.round(day.percent * 100)}%`}`;
}

export function StatsPage() {
  const { state } = useAppStore();
  const { notify } = useFeedback();
  const { today } = useToday();
  const tasks = useMemo(() => state.tasks.filter((task) => !task.archived), [state.tasks]);
  const badges = useMemo(() => getBadges(state), [state]);
  const [monthCursor, setMonthCursor] = useState(() => {
    const current = new Date();
    return new Date(current.getFullYear(), current.getMonth(), 1);
  });
  const [shareBusy, setShareBusy] = useState(false);

  const year = monthCursor.getFullYear();
  const monthIndex = monthCursor.getMonth();
  const isCurrentMonth = year === today.getFullYear() && monthIndex === today.getMonth();
  const monthLabel = monthLong.format(monthCursor);
  // Для текущего месяца статистику считаем по сегодня, для прошедших — по всему месяцу.
  const referenceDate = useMemo(
    () => (isCurrentMonth ? today : new Date(year, monthIndex + 1, 0, 12)),
    [isCurrentMonth, year, monthIndex, today],
  );

  const monthDays = useMemo(() => {
    const count = new Date(year, monthIndex + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(year, monthIndex, index + 1, 12);
      const key = toDateKey(date);
      return { date, key, percent: buildDayPercent(tasks, key, date, today) };
    });
  }, [tasks, year, monthIndex, today]);

  const summary = useMemo(
    () => getMonthSummary(tasks, year, monthIndex, isCurrentMonth ? today.getDate() : undefined, today),
    [tasks, year, monthIndex, isCurrentMonth, today],
  );
  const previousSummary = useMemo(() => {
    const previous = new Date(year, monthIndex - 1, 1, 12);
    return getMonthSummary(tasks, previous.getFullYear(), previous.getMonth(), undefined, new Date(year, monthIndex, 0, 12));
  }, [tasks, year, monthIndex]);
  const delta = getPercentDelta(summary.percent, previousSummary.percent);
  const productiveDay = useMemo(() => getMostProductiveWeekday(tasks, today), [tasks, today]);

  const trend = useMemo(() => {
    const maxX = Math.max(1, monthDays.length - 1);
    const points = monthDays
      .map((day, index) => (day.percent === null ? null : { x: (index / maxX) * 100, y: (1 - day.percent) * 100 }))
      .filter(Boolean);
    return {
      line: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
      area: points.length ? `0,100 ${points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')} ${points[points.length - 1].x.toFixed(2)},100` : '',
    };
  }, [monthDays]);

  const heatmap = useMemo(() => {
    const todayKey = toDateKey(today);
    const first = new Date(today);
    first.setDate(first.getDate() - 364);
    first.setDate(first.getDate() - first.getDay()); // выравниваем на воскресенье
    first.setHours(12, 0, 0, 0);
    const weeks = [];
    const cursor = new Date(first);
    while (toDateKey(cursor) <= todayKey) {
      const week = [];
      for (let offset = 0; offset < 7; offset += 1) {
        const date = new Date(cursor);
        date.setDate(cursor.getDate() + offset);
        const key = toDateKey(date);
        if (key > todayKey) { week.push(null); continue; }
        week.push({ date, key, percent: buildDayPercent(tasks, key, date, today) });
      }
      weeks.push(week);
      cursor.setDate(cursor.getDate() + 7);
    }
    const monthLabels = weeks.map((week, index) => {
      const firstDay = week.find(Boolean);
      if (!firstDay) return '';
      const previous = weeks[index - 1]?.find(Boolean);
      if (!previous || previous.date.getMonth() !== firstDay.date.getMonth()) return monthShort.format(firstDay.date);
      return '';
    });
    return { weeks, monthLabels };
  }, [tasks, today]);

  const records = useMemo(() => state.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    archived: task.archived,
    current: getStreak(task.history || {}, task.schedule || FULL_SCHEDULE, today, task.pauseRanges || []),
    best: getBestStreak(task.history || {}, task.schedule || FULL_SCHEDULE, task.pauseRanges || []),
    stats: getHabitStats(task, referenceDate),
  })).sort((first, second) => second.best - first.best), [state.tasks, referenceDate, today]);

  const topHabits = useMemo(() => records
    .filter((record) => !record.archived && record.stats.monthExpected > 0)
    .slice()
    .sort((first, second) => second.stats.monthPercent - first.stats.monthPercent)
    .slice(0, 5), [records]);

  const streakLeader = useMemo(() => tasks
    .map((task) => ({ title: task.title, current: getStreak(task.history || {}, task.schedule || FULL_SCHEDULE, today, task.pauseRanges || []) }))
    .sort((first, second) => second.current - first.current)[0] ?? null, [tasks, today]);

  async function handleShare() {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const blob = await createProgressCard({
        monthLabel,
        percent: summary.percent,
        done: summary.done,
        expected: summary.expected,
        days: monthDays,
        streakHabit: streakLeader?.current > 0 ? streakLeader : null,
      });
      await shareOrDownload(blob, `wakanda-${year}-${String(monthIndex + 1).padStart(2, '0')}.png`, `Мой прогресс за ${monthLabel}: ${summary.percent}%`);
    } catch (error) {
      console.error('Не удалось собрать карточку прогресса:', error);
      notify('Не удалось собрать картинку. Попробуйте ещё раз.', { tone: 'error' });
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <section className="section-card page-section stats-page">
      <div className="section-heading">
        <div><p className="eyebrow">ДИСЦИПЛИНА В ЦИФРАХ</p><h2>Твоя статистика</h2></div>
        <div className="month-controls">
          <button type="button" className="month-arrow" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Предыдущий месяц">‹</button>
          <time className="month-name" dateTime={`${year}-${String(monthIndex + 1).padStart(2, '0')}`}>{monthLabel}</time>
          <button type="button" className="month-arrow" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Следующий месяц" disabled={isCurrentMonth}>›</button>
        </div>
      </div>

      <div className="stats-summary">
        <ProgressRing percent={summary.percent} size={112} ariaLabel={`Выполнено за ${monthLabel}`} />
        <div className="stats-summary-main">
          <p className="stats-summary-label">Выполнено за {monthLabel}</p>
          <p className="stats-summary-value">{summary.done}<span> / {summary.expected}</span></p>
          <p className={`stats-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '＝'} {Math.abs(delta)}% к прошлому месяцу
          </p>
        </div>
        <div className="stats-summary-side">
          <p><span>Лучший день недели</span><b>{productiveDay === null ? '—' : WEEKDAY_SHORT[productiveDay]}</b></p>
          <p><span>Лучшая привычка</span><b>{topHabits[0] ? `${topHabits[0].title} · ${topHabits[0].stats.monthPercent}%` : '—'}</b></p>
        </div>
      </div>

      <div className="stats-toolbar">
        <h3 className="stats-subtitle">Ритм месяца</h3>
        <button type="button" className="button button--light share-button" onClick={handleShare} disabled={shareBusy}>{shareBusy ? 'Собираем…' : 'Поделиться карточкой'}</button>
      </div>
      <div className="stats-month-chart" role="img" aria-label={`Доля выполненных привычек по дням: ${monthLabel}`}>
        {monthDays.map((day) => (
          <div className="stats-month-col" key={day.key} title={`${day.key}: ${day.percent === null ? 'без привычек' : `${Math.round(day.percent * 100)}%`}`}>
            <span className="stats-month-bar" style={{ height: day.percent === null ? '4px' : `${Math.max(6, day.percent * 100)}%` }} data-empty={day.percent === null} />
            <small>{day.date.getDate()}</small>
          </div>
        ))}
      </div>

      <svg className="stats-trend" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Динамика выполнения за ${monthLabel}`}>
        {trend.area && <polygon className="stats-trend-area" points={trend.area} />}
        {trend.line && <polyline className="stats-trend-line" points={trend.line} vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="stats-trend-caption" style={{ display: 'none' }} />

      <h3 className="stats-subtitle">Карта года</h3>
      <div className="heatmap-block">
        <div className="heatmap-months" aria-hidden="true">
          {heatmap.monthLabels.map((label, index) => <span key={index}>{label}</span>)}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-weekdays" aria-hidden="true">
            {HEATMAP_WEEKDAYS.map((label, index) => <span key={index}>{label}</span>)}
          </div>
          <div className="stats-heatmap" role="img" aria-label="Тепловая карта выполнений за последний год">
            {heatmap.weeks.flatMap((week, weekIndex) => week.map((day, dayIndex) => (
              day
                ? <span key={`${weekIndex}-${dayIndex}`} className={`heat-cell ${heatCellClass(day.percent)}`} title={heatCellTitle(day)} />
                : <span key={`${weekIndex}-${dayIndex}`} className="heat-cell heat-cell--blank" />
            )))}
          </div>
        </div>
      </div>
      <div className="heatmap-legend"><span>меньше</span><i className="heat-cell heat-cell--zero" /><i className="heat-cell heat-cell--low" /><i className="heat-cell heat-cell--high" /><i className="heat-cell heat-cell--full" /><span>больше</span></div>

      <h3 className="stats-subtitle">Топ привычек</h3>
      {topHabits.length === 0 ? (
        <p className="one-off-empty">Пока нет данных за этот месяц.</p>
      ) : (
        <ol className="top-habits">
          {topHabits.map((habit, index) => (
            <li key={habit.id}>
              <span className="top-habits-rank">{index + 1}</span>
              <span className="top-habits-title">{habit.title}</span>
              <span className="top-habits-bar"><i style={{ width: `${habit.stats.monthPercent}%` }} /></span>
              <span className="top-habits-value">{habit.stats.monthPercent}%</span>
            </li>
          ))}
        </ol>
      )}

      <h3 className="stats-subtitle">Рекорды серий</h3>
      {records.length === 0 ? (
        <p className="one-off-empty">Добавь привычки — здесь появятся рекорды.</p>
      ) : (
        <ul className="records-list">
          {records.map((record) => (
            <li key={record.id}>
              <span className="records-title">{record.title}{record.archived && <small className="records-archived"> архив</small>}</span>
              <span>сейчас <b>{record.current}</b> дн.</span>
              <span>рекорд <b>{record.best}</b> дн.</span>
              <span>месяц <b>{record.stats.monthPercent}%</b> ({record.stats.monthDone}/{record.stats.monthExpected})</span>
              <span>лучший день <b>{record.stats.mostProductiveDay === null ? '—' : WEEKDAY_SHORT[record.stats.mostProductiveDay]}</b></span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="stats-subtitle">Награды</h3>
      <ul className="badges-grid">
        {badges.map((badge) => (
          <li key={badge.id} className={`badge ${badge.unlocked ? 'badge--unlocked' : ''}`}>
            <span className="badge-icon" aria-hidden="true">{badge.icon}</span>
            <b>{badge.title}</b>
            <p>{badge.description}</p>
            <small>{badge.unlocked ? 'получено' : badge.progress}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
