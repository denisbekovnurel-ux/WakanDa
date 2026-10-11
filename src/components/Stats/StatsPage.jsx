import { useMemo } from 'react';
import { getBestStreak, getHabitStats, getStreak, toDateKey, STATUS } from '../../utils/calc';
import { getBadges } from '../../utils/badges';
import { useAppStore } from '../../store/AppStore';

const FULL_SCHEDULE = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function buildDayPercent(tasks, dateKey, day) {
  let expected = 0;
  let done = 0;
  for (const task of tasks) {
    if (!(task.schedule || FULL_SCHEDULE).includes(day.getDay())) continue;
    expected += 1;
    if (task.history?.[dateKey] === STATUS.DONE) done += 1;
  }
  return expected === 0 ? null : done / expected;
}

export function StatsPage() {
  const { state } = useAppStore();
  const tasks = state.tasks.filter((task) => !task.archived);
  const badges = useMemo(() => getBadges(state), [state]);

  const { monthDays, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const count = new Date(year, month + 1, 0).getDate();
    const days = Array.from({ length: count }, (_, index) => {
      const date = new Date(year, month, index + 1);
      return { date, key: toDateKey(date), percent: buildDayPercent(tasks, toDateKey(date), date) };
    });
    return { monthDays: days, monthLabel: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(now) };
  }, [tasks]);

  const yearDays = useMemo(() => {
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let offset = 364; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      days.push({ date, key: toDateKey(date), percent: buildDayPercent(tasks, toDateKey(date), date) });
    }
    return days;
  }, [tasks]);

  const records = useMemo(() => state.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    current: getStreak(task.history || {}, task.schedule || FULL_SCHEDULE),
    best: getBestStreak(task.history || {}, task.schedule || FULL_SCHEDULE),
    stats: getHabitStats(task),
  })).sort((first, second) => second.best - first.best), [state.tasks]);

  return (
    <section className="section-card page-section stats-page">
      <div className="section-heading"><div><p className="eyebrow">ДИСЦИПЛИНА В ЦИФРАХ</p><h2>Твоя статистика</h2></div></div>

      <h3 className="stats-subtitle">Ритм месяца · {monthLabel}</h3>
      <div className="stats-month-chart" role="img" aria-label="Доля выполненных привычек по дням текущего месяца">
        {monthDays.map((day) => (
          <div className="stats-month-col" key={day.key} title={`${day.key}: ${day.percent === null ? 'выходные' : `${Math.round(day.percent * 100)}%`}`}>
            <span className="stats-month-bar" style={{ height: day.percent === null ? '4px' : `${Math.max(6, day.percent * 100)}%` }} data-empty={day.percent === null} />
            <small>{day.date.getDate()}</small>
          </div>
        ))}
      </div>

      <h3 className="stats-subtitle">Карта года</h3>
      <div className="stats-heatmap" role="img" aria-label="Тепловая карта выполнений за последний год">
        {yearDays.map((day) => (
          <span
            key={day.key}
            className={`heat-cell ${day.percent === null ? 'heat-cell--rest' : day.percent >= 1 ? 'heat-cell--full' : day.percent > 0.5 ? 'heat-cell--high' : day.percent > 0 ? 'heat-cell--low' : 'heat-cell--zero'}`}
            title={`${day.key} (${WEEKDAY_SHORT[day.date.getDay()]}): ${day.percent === null ? 'выходные' : `${Math.round(day.percent * 100)}%`}`}
          />
        ))}
      </div>
      <div className="heatmap-legend"><span>меньше</span><i className="heat-cell heat-cell--zero" /><i className="heat-cell heat-cell--low" /><i className="heat-cell heat-cell--high" /><i className="heat-cell heat-cell--full" /><span>больше</span></div>

      <h3 className="stats-subtitle">Рекорды серий</h3>
      {records.length === 0 ? (
        <p className="one-off-empty">Добавь привычки — здесь появятся рекорды.</p>
      ) : (
        <ul className="records-list">
          {records.map((record) => (
            <li key={record.id}>
              <span className="records-title">{record.title}</span>
              <span>сейчас <b>{record.current}</b> дн.</span>
              <span>рекорд <b>{record.best}</b> дн.</span>
              <span>месяц <b>{record.stats.monthPercent}%</b> ({record.stats.monthDone}/{record.stats.monthExpected})</span>
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
