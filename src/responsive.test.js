import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const viewport = readFileSync(new URL('./utils/viewport.ts', import.meta.url), 'utf8');
const scrollLock = readFileSync(new URL('./utils/scrollLock.ts', import.meta.url), 'utf8');

function section(start, end) {
  const from = css.indexOf(start);
  const to = end ? css.indexOf(end, from) : css.length;
  expect(from).toBeGreaterThanOrEqual(0);
  return css.slice(from, to);
}

describe('mobile responsive profile', () => {
  it('viewport готов для notch и Android browser UI', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('interactive-widget=resizes-content');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).not.toContain('user-scalable=no');
  });

  it('использует dvh и safe-area для iOS/PWA', () => {
    expect(css).toContain('min-height: 100dvh');
    expect(css).toContain('--safe-top: env(safe-area-inset-top, 0px)');
    expect(css).toContain('--safe-bottom: env(safe-area-inset-bottom, 0px)');
    expect(indexCss).toContain('min-height: 100dvh');
  });

  it('мобильные поля не запускают авто-zoom и имеют крупные зоны нажатия', () => {
    const mobile = section('Mobile profile: iPhone + Android', '@media (max-width: 420px)');
    expect(mobile).toContain('font-size: 16px');
    expect(mobile).toContain('min-height: var(--tap-target-large)');
    expect(mobile).toContain('@media (pointer: coarse)');
    expect(mobile).toContain('min-width: var(--tap-target)');
  });

  it('таблицы и heatmap прокручиваются внутри контейнеров', () => {
    expect(css).toContain('.month-table-scroll');
    expect(css).toContain('.admin-table-wrap');
    expect(css).toContain('-webkit-overflow-scrolling: touch');
    expect(css).toContain('overscroll-behavior-x: contain');
  });

  it('узкие экраны и landscape учтены отдельно', () => {
    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('@media (orientation: landscape) and (max-height: 540px)');
    expect(css).toContain('@media (display-mode: standalone)');
  });

  it('диалоги на телефоне работают как нижняя шторка', () => {
    expect(css).toContain('.sync-dialog-backdrop');
    expect(css).toContain('align-items: flex-end');
    expect(css).toContain('border-radius: 24px 24px 0 0');
    expect(css).toContain('@keyframes dialog-sheet-in');
  });

  it('мелкие подписи остаются читаемыми на телефоне', () => {
    expect(css).toContain('.one-off-priority');
    expect(css).toContain('.month-day-heading small');
    expect(css).toContain('font-size: 0.68rem');
    expect(css).toContain('scroll-margin-top: calc(var(--topbar-height) + var(--safe-top) + 8px)');
  });

  it('iPhone-клавиатура: visual viewport, --vvh и скрытие нижней навигации', () => {
    expect(main).toContain('installViewportTracking');
    expect(viewport).toContain('visualViewport');
    expect(viewport).toContain("'--vvh'");
    expect(viewport).toContain('keyboard-open');
    expect(css).toContain('html.keyboard-open .main-nav');
    expect(css).toContain('--vvh: 100dvh');
    expect(css).toContain('var(--vvh, 100dvh)');
  });

  it('iOS Safari: нативные контролы, long-press, 16px и safe-area', () => {
    expect(css).toContain('@supports (-webkit-touch-callout: none)');
    expect(css).toContain('-webkit-touch-callout: none');
    expect(css).toContain('-webkit-user-select: none');
    expect(css).toContain('font-size: 16px !important');
    expect(css).toContain('touch-action: manipulation');
    expect(css).toContain('overscroll-behavior-y: none');
    expect(html).toContain('apple-mobile-web-app-title');
  });

  it('фон под диалогом фиксируется, а не просто прячется через overflow', () => {
    expect(scrollLock).toContain("body.style.position = 'fixed'");
    expect(scrollLock).toContain('unlockBodyScroll');
    expect(css).toContain('html.modal-open');
    expect(css).toContain('scroll-padding-bottom');
  });

  it('плашка установки учитывает safe-area и не мешает клавиатуре', () => {
    const install = section('PWA install', '@media (pointer: coarse)');
    expect(install).toContain('bottom: calc(var(--mobile-nav-space) + 8px)');
    expect(install).toContain('left: calc(10px + var(--safe-left))');
    expect(install).toContain('right: calc(10px + var(--safe-right))');
    expect(css).toContain('html.keyboard-open .app-shell > .install-banner');
    expect(css).toContain('html.modal-open .app-shell > .install-banner');
  });
});
