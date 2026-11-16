import { useEffect, useRef } from 'react';
import { lockBodyScroll, unlockBodyScroll } from '../utils/scrollLock';

interface DialogA11yOptions {
  /** Вызывается по Escape (если не задан onEscape). */
  onClose?: () => void;
  /** Своя реакция на Escape — например, «отмена» вместо закрытия. */
  onEscape?: () => void;
  /** Для обязательных диалогов: Escape не должен ничего делать. */
  closeOnEscape?: boolean;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Общее поведение модальных окон: блокировка фона, начальный фокус, ловушка
 * Tab, Escape и возврат фокуса на элемент, который открыл диалог.
 *
 * Раньше каждый диалог повторял это по-своему, а на iOS фон под окном
 * продолжал прокручиваться. Теперь поведение живёт в одном месте.
 */
export function useDialogA11y({
  onClose,
  onEscape,
  closeOnEscape = true,
}: DialogA11yOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(onEscape);
  const closeOnEscapeRef = useRef(closeOnEscape);

  // Колбэки обновляем отдельно: пересоздание функции в родителе не должно
  // перезапускать блокировку scroll и сбрасывать фокус.
  useEffect(() => {
    onCloseRef.current = onClose;
    onEscapeRef.current = onEscape;
    closeOnEscapeRef.current = closeOnEscape;
  }, [onClose, onEscape, closeOnEscape]);

  useEffect(() => {
    const container = containerRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    lockBodyScroll();
    const autofocus = container?.querySelector<HTMLElement>('[data-autofocus]');
    (autofocus ?? container)?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (onEscapeRef.current) {
          event.preventDefault();
          onEscapeRef.current();
          return;
        }
        if (closeOnEscapeRef.current) {
          event.preventDefault();
          onCloseRef.current?.();
        }
        return;
      }

      if (event.key !== 'Tab' || !container) return;
      const items = focusableItems(container);
      if (!items.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Контейнер тоже считается «вне списка»: Tab из него ведёт на первый
      // элемент, Shift+Tab — на последний.
      const outside = active === container || !container.contains(active);

      if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return containerRef;
}
