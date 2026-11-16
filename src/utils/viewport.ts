/**
 * Отслеживание visual viewport нужно мобильному Safari: когда открывается
 * клавиатура, layout viewport не меняется, а visual viewport уменьшается на
 * 250–350 px. Без этого нижняя навигация и нижние шторки оказываются под
 * клавиатурой, а поле ввода может уехать из видимой области.
 *
 * Модуль намеренно не зависит от React: он работает и на экране входа, и в
 * основном приложении, и в тестах ничего не ломает (в jsdom visualViewport
 * отсутствует — остаётся безопасный fallback).
 */

// Панель браузера уменьшает viewport максимум на ~90 px, клавиатура — заметно
// сильнее. Порог отделяет эти два случая, чтобы не прятать навигацию зря.
const KEYBOARD_THRESHOLD_PX = 140;

let teardown: (() => void) | null = null;

export function installViewportTracking(): () => void {
  if (teardown) return teardown;
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  const viewport = window.visualViewport;

  if (!viewport) {
    root.style.setProperty('--vvh', `${window.innerHeight}px`);
    teardown = () => {
      root.style.removeProperty('--vvh');
      teardown = null;
    };
    return teardown;
  }

  let frame = 0;

  const apply = () => {
    frame = 0;
    const height = Math.round(viewport.height);
    root.style.setProperty('--vvh', `${height}px`);
    root.style.setProperty('--vv-offset-top', `${Math.round(viewport.offsetTop)}px`);
    root.classList.toggle('keyboard-open', window.innerHeight - height > KEYBOARD_THRESHOLD_PX);
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(apply);
  };

  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  apply();

  teardown = () => {
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    if (frame) window.cancelAnimationFrame(frame);
    root.classList.remove('keyboard-open');
    root.style.removeProperty('--vvh');
    root.style.removeProperty('--vv-offset-top');
    teardown = null;
  };

  return teardown;
}
