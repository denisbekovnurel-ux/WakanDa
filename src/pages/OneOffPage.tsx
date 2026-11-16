import { useAppStore } from '../store/AppStore';
import { OneOffList } from '../components/OneOffList';
import { useI18n } from '../i18n';

/** Разовые задачи: список конкретных дел на один раз. */
export default function OneOffPage() {
  const { state } = useAppStore();
  const { t } = useI18n();
  const openCount = state.oneOffTasks.filter((task) => !task.done).length;

  return (
    <section className="section-card page-section" data-reveal>
      <div className="section-heading">
        <div><p className="eyebrow">{t('ОДИН РАЗ — НО ДО КОНЦА')}</p><h2>{t('Список действий')}</h2></div>
        <span className="section-count">{t('{count} открыто', { count: openCount })}</span>
      </div>
      <p className="section-description">{t('Небольшие дела тоже требуют решения. Закрывай их одно за другим.')}</p>
      <OneOffList />
    </section>
  );
}
