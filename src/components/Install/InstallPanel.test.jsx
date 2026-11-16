// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../i18n';
import { PwaInstallProvider } from '../../pwa/PwaInstallProvider';
import { InstallPanel } from './InstallPanel';

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

function renderPanel() {
  render(<PwaInstallProvider><InstallPanel /></PwaInstallProvider>);
}

beforeEach(() => {
  setLocale('ru');
  mocks.notify.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InstallPanel', () => {
  it('объясняет установку вручную, пока браузер не готов', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Установить WakanDa' })).toBeTruthy();
    expect(screen.getByText('Откройте сайт в Chrome, чтобы установить приложение.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Установить WakanDa' })).toBeNull();
  });

  it('показывает кнопку после beforeinstallprompt и устанавливает приложение', async () => {
    renderPanel();
    const event = makePromptEvent('accepted');
    act(() => { window.dispatchEvent(event); });

    const button = await screen.findByRole('button', { name: 'Установить WakanDa' });
    fireEvent.click(button);

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('✓ Установлено')).toBeTruthy());
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining('WakanDa установлен'),
      { tone: 'success' },
    );
  });

  it('для iPhone отправляет в Safari', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    renderPanel();

    expect(screen.getByText('На iPhone и iPad: Safari → «Поделиться» → «На экран „Домой“».')).toBeTruthy();
  });

  it('показывает статус установки после appinstalled', async () => {
    renderPanel();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'WakanDa установлен' })).toBeTruthy());
    expect(screen.getByText('✓ Установлено')).toBeTruthy();
  });
});
