import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PwaInstallContext } from './PwaInstallContext';
import type { BeforeInstallPromptEvent, InstallOutcome, PwaInstallValue } from './PwaInstallContext';

function getStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

function isChromiumBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(navigator.userAgent);
}

/**
 * Держит один beforeinstallprompt на всё приложение. Плашка и карточка
 * установки могли бы слушать событие по отдельности, но prompt() одноразовый:
 * второй обработчик получил бы уже использованное событие.
 */
export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(getStandalone);
  const [standalone, setStandalone] = useState(getStandalone);
  const isIos = useMemo(() => isIosDevice(), []);
  const isAndroid = useMemo(() => isAndroidDevice(), []);
  const isChrome = useMemo(() => isChromiumBrowser(), []);
  // В некоторых тестовых окружениях isSecureContext не определён: не пугаем
  // пользователя предупреждением, если браузер не сообщил обратного.
  const isSecure = typeof window === 'undefined' || window.isSecureContext !== false;

  useEffect(() => {
    function capturePrompt(event: Event) {
      // Без preventDefault Chrome покажет свою мини-плашку, а мы хотим
      // предложить установку в удобном месте интерфейса.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }

    function markInstalled() {
      setDeferredPrompt(null);
      setInstalled(true);
      setStandalone(true);
    }

    const media = window.matchMedia?.('(display-mode: standalone)');
    function syncDisplayMode() {
      const next = getStandalone();
      setStandalone(next);
      if (next) setInstalled(true);
    }

    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', markInstalled);
    media?.addEventListener?.('change', syncDisplayMode);

    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', markInstalled);
      media?.removeEventListener?.('change', syncDisplayMode);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = deferredPrompt;
    if (!event) return 'unavailable';
    // Событие одноразовое — убираем его сразу, чтобы повторный клик не привёл
    // к ошибке браузера.
    setDeferredPrompt(null);
    try {
      await event.prompt();
      const choice = event.userChoice ? await event.userChoice : null;
      if (choice?.outcome === 'accepted') {
        setInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  const value = useMemo<PwaInstallValue>(() => ({
    canPrompt: Boolean(deferredPrompt),
    installed,
    standalone,
    isIos,
    isAndroid,
    isChrome,
    isSecure,
    promptInstall,
  }), [deferredPrompt, installed, standalone, isIos, isAndroid, isChrome, isSecure, promptInstall]);

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}
