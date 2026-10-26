import { useI18n } from '../i18n';

/** Заглушка на время загрузки ленивого раздела. */
export function PageFallback() {
  const { t } = useI18n();
  return (
    <section className="section-card page-section" role="status" aria-live="polite" aria-busy="true">
      <p className="section-description">{t('Загружаем раздел…')}</p>
    </section>
  );
}
