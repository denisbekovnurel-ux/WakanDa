/**
 * Блокировка прокрутки фона под модальным окном.
 *
 * На iOS Safari `overflow: hidden` у body недостаточно: страница под
 * диалогом продолжает «резинить» и прокручиваться. Надёжный способ — на время
 * диалога зафиксировать body со сдвигом на текущую прокрутку, а после закрытия
 * вернуть позицию. Счётчик нужен, чтобы вложенные/последовательные диалоги не
 * разблокировали body раньше времени.
 */

type SavedScroll = {
  scrollY: number;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
  paddingRight: string;
};

let lockCount = 0;
let saved: SavedScroll | null = null;

export function lockBodyScroll(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  lockCount += 1;
  if (lockCount > 1 || saved) return;

  const body = document.body;
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;

  saved = {
    scrollY,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };

  body.style.position = 'fixed';
  body.style.top = scrollY ? `-${scrollY}px` : '0px';
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  // Компенсируем исчезающий десктопный скроллбар, но игнорируем бессмысленные
  // значения (в jsdom clientWidth равен нулю).
  if (scrollbar > 0 && scrollbar <= 24) body.style.paddingRight = `${scrollbar}px`;

  document.documentElement.classList.add('modal-open');
}

export function unlockBodyScroll(): void {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0 || !saved) return;

  const body = document.body;
  const { scrollY } = saved;
  body.style.position = saved.position;
  body.style.top = saved.top;
  body.style.left = saved.left;
  body.style.right = saved.right;
  body.style.width = saved.width;
  body.style.overflow = saved.overflow;
  body.style.paddingRight = saved.paddingRight;
  saved = null;

  document.documentElement.classList.remove('modal-open');
  try {
    if (scrollY > 0) window.scrollTo(0, scrollY);
  } catch {
    // В окружениях без прокрутки (jsdom) это не ошибка приложения.
  }
}
