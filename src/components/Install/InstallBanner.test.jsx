// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../i18n';
import { PwaInstallProvider } from '../../pwa/PwaInstallProvider';
import { InstallBanner } from './InstallBanner';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../FeedbackContext', () => ({ useFeedback: () => ({ notify: mocks.notify }) }));

function makePromptEvent(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

function renderBanner() {
  render(<PwaInstallProvider><InstallBanner /></PwaInstallProvider>);
}

beforeEach(() => {
  setLocale('ru');
  window.sessionStorage.clear();
  mocks.notify.mockClear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('InstallBanner', () => {
  it('не показывается, пока браузер не готов к установке', () => {
    renderBanner();
    expect(screen.queryByRole('region', { name: 'Установить приложение' })).toBeNull();
  });

  it('появляется после beforeinstallprompt и запускает установку', async () => {
    renderBanner();
    const event = makePromptEvent('accepted');
    act(() => { window.dispatchEvent(event); });

    const banner = await screen.findByRole('region', { name: 'Установить приложение' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Установить' }));

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Установить приложение' })).toBeNull());
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining('WakanDa установлен'),
      { tone: 'success' },
    );
  });

  it('скрывается по «Позже» и запоминает отказ до конца сессии', async () => {
    renderBanner();
    act(() => { window.dispatchEvent(makePromptEvent()); });

    const banner = await screen.findByRole('region', { name: 'Установить приложение' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Позже' }));

    expect(screen.queryByRole('region', { name: 'Установить приложение' })).toBeNull();
    expect(window.sessionStorage.getItem('wakanda.install-banner-dismissed')).toBe('1');
  });

  it('не возвращается после перезагрузки, если пользователь отказался', async () => {
    window.sessionStorage.setItem('wakanda.install-banner-dismissed', '1');
    renderBanner();
    act(() => { window.dispatchEvent(makePromptEvent()); });

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Установить приложение' })).toBeNull());
  });

  it('исчезает после appinstalled', async () => {
    renderBanner();
    act(() => { window.dispatchEvent(makePromptEvent()); });
    await screen.findByRole('region', { name: 'Установить приложение' });

    act(() => { window.dispatchEvent(new Event('appinstalled')); });

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Установить приложение' })).toBeNull());
  });
});
