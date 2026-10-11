import { useAppStore } from '../../store/AppStore';
import { toDateKey } from '../../utils/calc';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });

export function NotesPanel() {
  const { state, actions } = useAppStore();
  const todayKey = toDateKey(new Date());
  // Значение всегда берём напрямую из стора — так заметка не «потеряется»,
  // когда серверная версия приходит позже (новая вкладка/устройство, конфликт).
  const draft = state.notes?.[todayKey] || '';

  const recent = Object.entries(state.notes || {})
    .filter(([key]) => key !== todayKey)
    .sort(([first], [second]) => second.localeCompare(first))
    .slice(0, 5);

  return (
    <section className="section-card notes-panel" aria-label="Ежедневные заметки">
      <div className="section-heading"><div><p className="eyebrow">ДНЕВНИК</p><h2>Заметка дня</h2></div></div>
      <textarea
        className="notes-input"
        rows={3}
        maxLength={2000}
        placeholder="Что получилось сегодня? Что не вышло и почему?"
        aria-label={`Заметка за ${todayKey}`}
        value={draft}
        onChange={(event) => actions.setNote(todayKey, event.target.value)}
      />
      {recent.length > 0 && (
        <ul className="notes-list">
          {recent.map(([dateKey, text]) => (
            <li key={dateKey}>
              <time dateTime={dateKey}>{dateFormatter.format(new Date(`${dateKey}T00:00:00`))}</time>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
