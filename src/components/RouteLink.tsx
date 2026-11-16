import { forwardRef, useCallback } from 'react';
import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  useLocation,
  useNavigate,
  useResolvedPath,
} from 'react-router-dom';
import type { LinkProps, NavigateOptions, NavLinkProps, To } from 'react-router-dom';

type Transition = {
  skipTransition: () => void;
  finished: Promise<void>;
};

let activeTransition: Transition | null = null;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Выполняет обновление роутера внутри View Transition API.
 * Если API или анимация недоступны, навигация происходит как обычно.
 */
function runWithTransition(update: () => void): void {
  // В скрытой вкладке View Transition всё равно прерывается браузером.
  // Навигация должна оставаться мгновенной, поэтому сразу идём без анимации.
  if (
    typeof document === 'undefined'
    || typeof document.startViewTransition !== 'function'
    || prefersReducedMotion()
    || document.visibilityState === 'hidden'
  ) {
    update();
    return;
  }

  // Быстрые повторные клики не должны конфликтовать с текущим переходом.
  // Старый переход намеренно «отвязываем»: его fallback не должен перебить
  // навигацию, которую инициировал новый клик.
  const previousTransition = activeTransition;
  activeTransition = null;
  previousTransition?.skipTransition();

  let updated = false;
  const runUpdate = () => {
    if (updated) return;
    updated = true;
    flushSync(update);
  };

  let transition: Transition;
  try {
    transition = document.startViewTransition(runUpdate);
  } catch {
    runUpdate();
    return;
  }

  activeTransition = transition;
  transition.finished
    // Прерванный переход — штатная ситуация (скрытая вкладка, быстрый клик).
    // Страховка: если update так и не выполнился, навигация не должна потеряться.
    .catch(() => {})
    .finally(() => {
      if (!updated && activeTransition === transition) runUpdate();
      if (activeTransition === transition) activeTransition = null;
    });
}

function isExternal(to: To): boolean {
  if (typeof to !== 'string') return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(to) || to.startsWith('//');
}

type NavigationProps = Pick<LinkProps, 'to' | 'replace' | 'state' | 'preventScrollReset' | 'relative' | 'target' | 'reloadDocument' | 'download' | 'onClick'>;

function useSmoothClick(props: NavigationProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = useResolvedPath(props.to, { relative: props.relative });

  return useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (props.target && props.target !== '_self') return;
    if (props.reloadDocument || props.download || isExternal(props.to)) return;

    event.preventDefault();
    const samePath = location.pathname + location.search + location.hash
      === path.pathname + path.search + path.hash;

    const options: NavigateOptions = {
      replace: props.replace ?? samePath,
      state: props.state,
      preventScrollReset: props.preventScrollReset,
      relative: props.relative,
    };

    runWithTransition(() => navigate(props.to, options));
  }, [location, navigate, path, props]);
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { onClick, to, replace, state, preventScrollReset, relative, target, reloadDocument, download, ...rest },
  ref,
) {
  const handleClick = useSmoothClick({ onClick, to, replace, state, preventScrollReset, relative, target, reloadDocument, download });
  return <RouterLink ref={ref} to={to} {...rest} onClick={handleClick} />;
});

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { onClick, to, replace, state, preventScrollReset, relative, target, reloadDocument, download, ...rest },
  ref,
) {
  const handleClick = useSmoothClick({ onClick, to, replace, state, preventScrollReset, relative, target, reloadDocument, download });
  return <RouterNavLink ref={ref} to={to} {...rest} onClick={handleClick} />;
});
