import { useAppStore } from '../store/AppStore';
import { OneOffList } from '../components/OneOffList';

/** Разовые задачи: список конкретных дел на один раз. */
export default function OneOffPage() {
  const { state } = useAppStore();
  const openCount = state.oneOffTasks.filter((task) => !task.done).length;

  return (
    <section className="section-card page-section">
      <div className="section-heading">
        <div><p className="eyebrow">ОДИН РАЗ — НО ДО КОНЦА</p><h2>Список действий</h2></div>
        <span className="section-count">{openCount} открыто</span>
      </div>
      <p className="section-description">Небольшие дела тоже требуют решения. Закрывай их одно за другим.</p>
      <OneOffList />
    </section>
  );
}
