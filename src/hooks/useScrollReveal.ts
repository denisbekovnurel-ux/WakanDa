import { useEffect } from 'react';

/**
 * Reveal-анимация по мере прокрутки: добавляет класс `is-in` элементам с
 * атрибутом `data-reveal`, когда они попадают в зону видимости.
 *
 * Контент прячется (opacity/translate через CSS) ТОЛЬКО если среда поддерживает
 * IntersectionObserver и не отключена reduced-motion — в противном случае ничего
 * не скрываем, и страница остаётся доступной (и тесты — зелёными).
 *
 * Ленивые разделы подгружаются после старта, поэтому следим за вставкой
 * новых узлов и за прокруткой, пересобирая наблюдаемых по мере появления.
 */
export function useScrollReveal(): void {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      typeof window.IntersectionObserver !== 'function'
    ) {
      return undefined;
    }
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return undefined;
    }

    const root = document.documentElement;
    const observed = new Set<Element>();
    let observer: IntersectionObserver | null = null;

    const collect = () => {
      if (!observer) {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.classList.add('is-in');
              observer?.unobserve(entry.target);
              observed.delete(entry.target);
            }
          },
          { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
        );
      }
      const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));
      for (const target of targets) {
        if (observed.has(target)) continue;
        observed.add(target);
        observer.observe(target);
      }
    };

    root.classList.add('js-reveal');
    collect();

    // Новые узлы (ленивые роуты, появление контента) и прокрутка — пересчитываем.
    const mutationObserver = new MutationObserver(collect);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    const onScroll = () => collect();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      root.classList.remove('js-reveal');
      observer?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
}
