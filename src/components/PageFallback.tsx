/** Заглушка на время загрузки ленивого раздела. */
export function PageFallback() {
  return (
    <section className="section-card page-section" role="status" aria-live="polite" aria-busy="true">
      <p className="section-description">Загружаем раздел…</p>
    </section>
  );
}
