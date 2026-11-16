// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installViewportTracking } from './viewport';

// jsdom не реализует visualViewport, поэтому проверяем безопасный fallback:
// приложение всё равно получает --vvh и не падает без API.
const stops: Array<() => void> = [];

afterEach(() => {
  while (stops.length) stops.pop()!();
  document.documentElement.classList.remove('keyboard-open');
  document.documentElement.style.removeProperty('--vvh');
  document.documentElement.style.removeProperty('--vv-offset-top');
});

describe('installViewportTracking', () => {
  it('выставляет --vvh и снимает его при остановке', () => {
    const stop = installViewportTracking();
    stops.push(stop);

    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe(`${window.innerHeight}px`);

    stop();
    stops.pop();

    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
  });

  it('повторный вызов не создаёт второй подписчик', () => {
    const first = installViewportTracking();
    const second = installViewportTracking();
    stops.push(first);

    expect(second).toBe(first);

    second();
    stops.pop();
  });
});
