import { useCallback, useState } from 'react';
import { useI18n } from '../../i18n';
import { usePwaInstall } from '../../pwa/PwaInstallContext';
import { useFeedback } from '../FeedbackContext';

const DISMISS_KEY = 'wakanda.install-banner-dismissed';

function wasDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Ненавязчивая плашка установки. Показывается только когда Chromium готов
 * открыть нативный диалог: на iPhone/Safari такого события нет, там инструкция
 * живёт в настройках на главной.
 */
export function InstallBanner() {
  const { canPrompt, installed, promptInstall } = usePwaInstall();
  const { notify } = useFeedback();
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(wasDismissed);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Приватный режим может запрещать storage — плашка просто скроется
      // до перезагрузки, это не критично.
    }
  }, []);

  async function handleInstall() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      notify(t('WakanDa установлен. Откройте его с рабочего стола или экрана «Домой».'), { tone: 'success' });
    } else if (outcome === 'unavailable') {
      notify(t('Не удалось открыть установку. В Chrome откройте меню ⋮ → «Установить приложение».'), { tone: 'info' });
    } else {
      dismiss();
    }
  }

  if (!canPrompt || installed || dismissed) return null;

  return (
    <aside className="install-banner" role="region" aria-label={t('Установить приложение')}>
      <div className="install-banner-copy">
        <strong>{t('WakanDa на этом устройстве')}</strong>
        <span>{t('Открывается как приложение — без адресной строки.')}</span>
      </div>
      <div className="install-banner-actions">
        <button className="button button--red" type="button" onClick={handleInstall}>{t('Установить')}</button>
        <button className="install-banner-later" type="button" onClick={dismiss}>{t('Позже')}</button>
      </div>
      <button className="install-banner-close" type="button" aria-label={t('Скрыть предложение установки')} onClick={dismiss}>×</button>
    </aside>
  );
}
