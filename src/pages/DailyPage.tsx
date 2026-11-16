import { useAppStore } from '../store/AppStore';
import { selectActiveHabits } from '../store/selectors';
import { pluralize } from '../utils/pluralize';
import { MonthGrid } from '../components/MonthGrid';
import { NotesPanel } from '../components/NotesPanel/NotesPanel';
import { HabitManager } from '../components/HabitManager';
import { useI18n } from '../i18n';

/** Дневная страница: календарь, заметка и управление привычками. */
export default function DailyPage() {
  const { state } = useAppStore();
  const { t } = useI18n();
  const activeTasks = selectActiveHabits(state);

  return (
    <section className="section-card page-section" data-reveal>
      <MonthGrid />
      <NotesPanel />
      <div className="daily-task-manager">
        <div className="section-heading">
          <div><p className="eyebrow">{t('ДИСЦИПЛИНА КАЖДЫЙ ДЕНЬ')}</p><h2>{t('Управление привычками')}</h2></div>
          <span className="section-count">{activeTasks.length} {pluralize(activeTasks.length, 'привычка', 'привычки', 'привычек')}</span>
        </div>
        <HabitManager />
      </div>
    </section>
  );
}
