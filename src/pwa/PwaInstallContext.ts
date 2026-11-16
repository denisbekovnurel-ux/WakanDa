import { createContext, useContext } from 'react';

/**
 * Chrome (и другие Chromium-браузеры) присылают это событие, когда сайт
 * выполнил критерии устанавливаемого PWA. Событие одноразовое: после вызова
 * prompt() его нельзя использовать повторно, поэтому провайдер держит его
 * в состоянии и очищает после ответа пользователя.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface PwaInstallValue {
  /** Браузер готов показать нативный диалог установки. */
  canPrompt: boolean;
  /** Приложение установлено (или уже открыто в standalone-режиме). */
  installed: boolean;
  /** Сейчас открыто в отдельном окне PWA, а не во вкладке браузера. */
  standalone: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isChrome: boolean;
  /** Установка PWA требует HTTPS (исключение — localhost). */
  isSecure: boolean;
  promptInstall: () => Promise<InstallOutcome>;
}

export const PwaInstallContext = createContext<PwaInstallValue | null>(null);

export function usePwaInstall(): PwaInstallValue {
  const value = useContext(PwaInstallContext);
  if (!value) throw new Error('usePwaInstall должен вызываться внутри PwaInstallProvider');
  return value;
}
