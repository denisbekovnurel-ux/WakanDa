import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from './FeedbackContext';
import { useI18n } from '../i18n';
import { errorMessage } from '../utils/errors';
import { createTelegramLink, fetchTelegramStatus, sendTestTelegram, unlinkTelegram } from '../api/telegramApi';
import type { TelegramLink, TelegramStatus } from '../api/telegramApi';

// Разрешение приходит с сервера: опрашиваем, пока пользователь жмёт Start.
const POLL_INTERVAL_MS = 3000;

/**
 * Подключение Telegram для напоминаний. Панель невидима, пока бот не настроен
 * на сервере, — в обычной установке она не добавляет шума в настройки.
 */
export function TelegramPanel() {
  const { token } = useAuth();
  const { notify, confirm } = useFeedback();
  const { t } = useI18n();
  // Статус привязан к токену: после смены аккаунта показываем только актуальный
  // ответ сервера, а не прошлую привязку.
  const [statusEntry, setStatusEntry] = useState<{ token: string; status: TelegramStatus } | null>(null);
  const status = statusEntry && statusEntry.token === token ? statusEntry.status : null;
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    fetchTelegramStatus(token)
      .then((next) => {
        if (!cancelled) setStatusEntry({ token, status: next });
      })
      .catch(() => {
        if (!cancelled) setStatusEntry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const deepLink = link?.deepLink ?? '';
  const expiresAt = link?.expiresAt ?? '';

  useEffect(() => {
    if (!token || !deepLink) return undefined;
    const activeToken = token;
    let cancelled = false;
    const expiry = Date.parse(expiresAt);

    async function check() {
      if (!Number.isNaN(expiry) && Date.now() > expiry) {
        setLink(null);
        notify(t('Ссылка устарела. Создайте новую.'), { tone: 'warning' });
        return;
      }
      try {
        const next = await fetchTelegramStatus(activeToken);
        if (cancelled) return;
        setStatusEntry({ token: activeToken, status: next });
        if (next.linked) {
          setLink(null);
          notify(t('Telegram подключён — напоминания будут приходить в чат.'), { tone: 'success' });
        }
      } catch {
        // Кратковременный сбой сервера не отменяет ожидание: следующий тик повторит.
      }
    }

    const timer = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);
    // В скрытой вкладке браузер прореживает таймеры, а подтверждение из
    // Telegram ждут именно после возврата на сайт — проверим сразу.
    const onReturn = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [token, deepLink, expiresAt, notify, t]);

  const connect = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const next = await createTelegramLink(token, -new Date().getTimezoneOffset());
      setLink(next);
      // Ссылку открываем сразу: пользователю остаётся подтвердить кнопкой Start.
      if (next.deepLink) window.open(next.deepLink, '_blank', 'noopener,noreferrer');
    } catch (error) {
      notify(errorMessage(error, 'Не удалось получить ссылку для подключения'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [token, notify]);

  const sendTest = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await sendTestTelegram(token);
      notify(t('Проверь Telegram — туда ушло тестовое сообщение.'), { tone: 'success' });
    } catch (error) {
      notify(errorMessage(error, 'Не удалось отправить тестовое сообщение'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [token, notify, t]);

  const disconnect = useCallback(async () => {
    if (!token) return;
    const confirmed = await confirm({
      title: t('Отключить Telegram?'),
      message: t('Напоминания перестанут приходить в чат. Подключить можно снова в любой момент.'),
      confirmText: t('Отключить'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await unlinkTelegram(token);
      setLink(null);
      setStatusEntry((current) =>
        current && current.token === token
          ? { ...current, status: { ...current.status, linked: false, telegramUsername: null, linkedAt: null } }
          : current,
      );
      notify(t('Telegram отключён.'), { tone: 'success' });
    } catch (error) {
      notify(errorMessage(error, 'Не удалось отключить Telegram'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [token, confirm, notify, t]);

  if (!token || !status?.configured) return null;

  return (
    <div className="telegram-panel">
      {status.linked ? (
        <div className="telegram-row">
          <span className="telegram-state">
            {t('Telegram подключён')}
            {status.telegramUsername ? ` · @${status.telegramUsername}` : ''}
          </span>
          <div className="telegram-actions">
            <button className="button button--light" type="button" onClick={sendTest} disabled={busy}>
              {t('Проверить сообщение')}
            </button>
            <button className="button button--light" type="button" onClick={disconnect} disabled={busy}>
              {t('Отключить Telegram')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="telegram-hint">{t('Напоминания можно получать в Telegram — тогда не нужно устанавливать приложение и разрешать уведомления браузера.')}</p>
          {deepLink ? (
            <div className="telegram-row telegram-row--pending">
              <a className="button button--red" href={deepLink} target="_blank" rel="noreferrer">
                {t('Открыть чат и нажать Start')}
              </a>
              <span className="telegram-code">
                {t('Код привязки')} <code>{link?.code}</code>
              </span>
              <button className="text-link" type="button" onClick={() => setLink(null)}>
                {t('Отмена')}
              </button>
            </div>
          ) : (
            <button className="button button--red" type="button" onClick={connect} disabled={busy}>
              {t('Подключить Telegram')}
            </button>
          )}
        </>
      )}
      {!status.webhookReady && (
        <p className="telegram-warn">
          {t('Сервер пока не получает ответы бота. Привязка заработает после настройки вебхука или опроса Telegram.')}
        </p>
      )}
    </div>
  );
}
