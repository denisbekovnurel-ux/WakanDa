// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayProvider } from './TodayProvider.jsx';
import { useToday } from './TodayContext';

// Одна дата на всё приложение: без дублирующихся таймеров и без пропсов.

let consoleError;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  consoleError.mockRestore();
});

function Probe() {
  const { today, todayKey } = useToday();
  return <output data-testid="today">{todayKey}|{today.getFullYear()}</output>;
}

describe('TodayProvider', () => {
  it('отдаёт сегодняшнюю дату всем детям', () => {
    render(<TodayProvider><Probe /></TodayProvider>);

    expect(screen.getByTestId('today').textContent).toBe('2026-10-26|2026');
  });

  it('без провайдера падает с понятной ошибкой, а не молча', () => {
    expect(() => render(<Probe />)).toThrow('useToday должен вызываться внутри TodayProvider');
  });

  it('сам переключает дату в полночь', () => {
    vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 59));
    render(<TodayProvider><Probe /></TodayProvider>);

    expect(screen.getByTestId('today').textContent).toMatch(/^2026-10-26/);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId('today').textContent).toMatch(/^2026-10-27/);
  });

  it('догоняет дату, когда вкладка снова становится видимой', () => {
    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });

    render(<TodayProvider><Probe /></TodayProvider>);
    expect(screen.getByTestId('today').textContent).toMatch(/^2026-10-26/);

    // Вкладка «проспала» несколько дней: таймер в фоне мог не сработать.
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0, 0));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByTestId('today').textContent).toMatch(/^2026-11-02/);

    if (original) Object.defineProperty(document, 'visibilityState', original);
    else delete document.visibilityState;
  });
});
