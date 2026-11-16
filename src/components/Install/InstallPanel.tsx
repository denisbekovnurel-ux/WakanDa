import { useI18n } from '../../i18n';
import { usePwaInstall } from '../../pwa/PwaInstallContext';
import { useFeedback } from '../FeedbackContext';

/**
 * Постоянная карточка установки на главной. В отличие от плашки, она видна
 * всегда (кроме уже установленного приложения) и объясняет ручной путь, если
 * Chrome ещё не прислал beforeinstallprompt.
 */
export function InstallPanel() {
  const { canPrompt, installed, isIos, isAndroid, isChrome, isSecure, promptInstall } = usePwaInstall();
  const { notify } = useFeedback();
  const { t } = useI18n();

  function manualHint(): string {
    if (isIos) return t('На iPhone и iPad: Safari → «Поделиться» → «На экран „Домой“».');
    if (isAndroid) return t('В Chrome на Android: меню ⋮ → «Установить приложение».');
    if (isChrome) return t('В Chrome на компьютере: значок установки в адресной строке или меню ⋮ → «Установить приложение».');
    return t('Откройте сайт в Chrome, чтобы установить приложение.');
  }

  async function handleInstall() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      notify(t('WakanDa установлен. Откройте его с рабочего стола или экрана «Домой».'), { tone: 'success' });
    } else if (outcome === 'unavailable') {
      notify(t('Не удалось открыть установку. В Chrome откройте меню ⋮ → «Установить приложение».'), { tone: 'info' });
    }
  }

  if (installed) {
    return (
      <div className="install-panel install-panel--done">
        <div className="install-panel-copy">
          <p className="eyebrow">{t('ПРИЛОЖЕНИЕ')}</p>
          <h2>{t('WakanDa установлен')}</h2>
          <p className="section-description">{t('Откройте WakanDa с рабочего стола или с экрана «Домой».')}</p>
        </div>
        <span className="install-badge">✓ {t('Установлено')}</span>
      </div>
    );
  }

  return (
    <div className="install-panel">
      <div className="install-panel-copy">
        <p className="eyebrow">{t('ПРИЛОЖЕНИЕ')}</p>
        <h2>{t('Установить WakanDa')}</h2>
        <p className="section-description">{t('Добавьте WakanDa на ноутбук или телефон — приложение откроется в отдельном окне, без адресной строки.')}</p>
        <p className="install-hint">{manualHint()}</p>
        {!isSecure && <p className="install-warning" role="status">{t('Установка доступна только по HTTPS. Откройте сайт по защищённому адресу.')}</p>}
      </div>
      {canPrompt && (
        <div className="install-panel-actions">
          <button className="button button--red" type="button" onClick={handleInstall}>{t('Установить WakanDa')}</button>
        </div>
      )}
    </div>
  );
}
