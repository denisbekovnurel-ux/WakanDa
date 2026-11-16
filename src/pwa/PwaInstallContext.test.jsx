// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaInstallProvider } from './PwaInstallProvider';
import { usePwaInstall } from './PwaInstallContext';

function Probe() {
  const { canPrompt, installed, promptInstall } = usePwaInstall();
  const [outcome, setOutcome] = useState('idle');
  return (
    <div>
      <span data-testid="can-prompt">{String(canPrompt)}</span>
      <span data-testid="installed">{String(installed)}</span>
      <span data-testid="outcome">{outcome}</span>
      <button type="button" onClick={async () => setOutcome(await promptInstall())}>install</button>
    </div>
  );
}

function makePromptEvent(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

beforeEach(() => {
  // jsdom не реализует matchMedia, а провайдер проверяет display-mode.
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PwaInstallProvider', () => {
  it('перехватывает beforeinstallprompt и отдаёт нативный prompt', async () => {
    render(<PwaInstallProvider><Probe /></PwaInstallProvider>);
    expect(screen.getByTestId('can-prompt').textContent).toBe('false');

    const event = makePromptEvent('accepted');
    act(() => { window.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByTestId('can-prompt').textContent).toBe('true'));

    fireEvent.click(screen.getByRole('button', { name: 'install' }));

    await waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('accepted'));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('installed').textContent).toBe('true');
    expect(screen.getByTestId('can-prompt').textContent).toBe('false');
  });

  it('возвращает dismissed, если пользователь закрыл диалог', async () => {
    render(<PwaInstallProvider><Probe /></PwaInstallProvider>);
    act(() => { window.dispatchEvent(makePromptEvent('dismissed')); });
    await waitFor(() => expect(screen.getByTestId('can-prompt').textContent).toBe('true'));

    fireEvent.click(screen.getByRole('button', { name: 'install' }));

    await waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('dismissed'));
    expect(screen.getByTestId('installed').textContent).toBe('false');
    expect(screen.getByTestId('can-prompt').textContent).toBe('false');
  });

  it('без события сообщает, что установка недоступна', async () => {
    render(<PwaInstallProvider><Probe /></PwaInstallProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'install' }));

    await waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('unavailable'));
  });

  it('реагирует на appinstalled', async () => {
    render(<PwaInstallProvider><Probe /></PwaInstallProvider>);
    act(() => { window.dispatchEvent(new Event('appinstalled')); });

    await waitFor(() => expect(screen.getByTestId('installed').textContent).toBe('true'));
  });
});
