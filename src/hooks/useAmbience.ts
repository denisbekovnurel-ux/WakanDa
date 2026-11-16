import { useEffect } from 'react';

/**
 * Лёгкие «атмосферные» эффекты, которые работают только на настольных
 * устройствах с курсором и полностью отключаются при prefers-reduced-motion.
 *  • cursor-glow — мягкое свечение, следующее за указателем;
 *  • scroll-progress — тонкая полоска прогресса прокрутки под шапкой.
 *
 * Никакого состояния React здесь нет: всё пишется напрямую в CSS-переменные
 * и стили элементов, поэтому 60fps достигается без перерисовки дерева.
 */
export function useAmbience(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const glow = document.querySelector<HTMLElement>('.cursor-glow');
    const progress = document.querySelector<HTMLElement>('.scroll-progress');
    if (!glow && !progress) return undefined;

    // Свечение появляется только там, где есть реальный курсор мыши.
    const finePointer = window.matchMedia('(pointer: fine) and (hover: hover)');
    let visibleOnlyOnHover = false;

    let spotX = 0;
    let spotY = 0;
    let raf = 0;
    let ticking = false;

    const applySpot = () => {
      ticking = false;
      if (glow) {
        glow.style.setProperty('--spot-x', `${spotX}px`);
        glow.style.setProperty('--spot-y', `${spotY}px`);
      }
      if (progress) progress.style.transform = `scaleX(${progressRatio()})`;
    };

    function onPointerMove(event: PointerEvent) {
      spotX = event.clientX;
      spotY = event.clientY;
      if (glow) glow.classList.add('is-visible');
      if (!ticking) {
        ticking = true;
        raf = window.requestAnimationFrame(applySpot);
      }
    }

    function onPointerLeave() {
      if (glow) glow.classList.remove('is-visible');
      spotX = 0;
      spotY = 0;
    }

    function progressRatio(): number {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return 0;
      const ratio = (window.scrollY || document.documentElement.scrollTop) / scrollable;
      return Math.min(1, Math.max(0, ratio));
    }

    function onScroll() {
      if (progress && !ticking) {
        ticking = true;
        raf = window.requestAnimationFrame(applySpot);
      }
    }

    function onPointerFineChange(event: MediaQueryListEvent) {
      visibleOnlyOnHover = event.matches;
      if (!visibleOnlyOnHover && glow) glow.classList.remove('is-visible');
      if (visibleOnlyOnHover) {
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerleave', onPointerLeave);
      } else {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerleave', onPointerLeave);
      }
    }
    onPointerFineChange({ matches: finePointer.matches } as MediaQueryListEvent);

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      if (glow) glow.classList.remove('is-visible');
    };
  }, []);
}
