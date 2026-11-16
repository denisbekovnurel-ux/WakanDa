import { useI18n } from '../i18n';

/** Заглушка на время загрузки ленивого раздела: скелетон вместо пустого экрана. */
export function PageFallback() {
  const { t } = useI18n();
  return (
    <section className="section-card page-section" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('Загружаем раздел…')}</span>
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton skeleton-card" aria-hidden="true" />
    </section>
  );
}
