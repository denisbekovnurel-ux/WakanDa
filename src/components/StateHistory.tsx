import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useAppStore } from '../store/AppStore';
import { createStateSnapshot, fetchStateHistory, restoreStateSnapshot } from '../api/stateApi';
import { useFeedback } from './FeedbackContext';
import type { StatusHistoryItem } from '../types';
import { errorMessage } from '../utils/errors';
import { formatDate as formatLocalizedDate, useI18n } from '../i18n';

const REASON_LABELS: Record<string, string> = {
  auto: 'Автоснимок',
  manual: 'Снимок вручную',
  import: 'Перед импортом',
  restore: 'Перед откатом',
};

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatSize(bytes: number, kilobyte: string, byte: string): string {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} ${kilobyte}` : `${bytes} ${byte}`;
}

export function StateHistory() {
  const { token } = useAuth();
  const { adoptServerState } = useAppStore();
  const { confirm } = useFeedback();
  const { t } = useI18n();
  const [items, setItems] = useState<StatusHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchStateHistory(token);
      setItems(Array.isArray(data?.history) ? data.history : []);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Не удалось загрузить историю'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function makeSnapshot() {
    setNotice('');
    try {
      const result = await createStateSnapshot(token, 'manual');
      setNotice(result?.created ? 'Снимок создан.' : 'С прошлого снимка изменений нет.');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось создать снимок'));
    }
  }

  async function restore(id: string) {
    const confirmed = await confirm({
      title: 'Восстановить снимок?',
      message: 'Текущие данные будут заменены выбранным снимком. Текущая версия тоже сохранится в истории.',
      confirmText: 'Восстановить',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusyId(id);
    setNotice('');
    try {
      const data = await restoreStateSnapshot(token, id);
      // Сервер уже сохранил снимок и вернул новую revision. Принимаем его как
      // серверную версию, иначе клиент повторно отправил бы те же данные с
      // устаревшей baseRevision и получил бы ложный конфликт.
      adoptServerState(data.state, data.updatedAt ?? data.restoredAt, data.revision ?? 0);
      setNotice('Снимок восстановлен.');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось восстановить снимок'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="state-history">
      <div className="state-history-head">
        <div>
          <p className="eyebrow">{t('ЗАЩИТА ДАННЫХ')}</p>
          <h2>{t('История версий')}</h2>
          <p className="section-description">
            {t('Сервер хранит последние 40 версий: автоснимки (раз в 10 минут), а также снимки перед импортом бэкапа и откатом. Любую версию можно вернуть.')}
          </p>
        </div>
        <button className="button button--light" type="button" onClick={makeSnapshot}>{t('Сделать снимок')}</button>
      </div>

      {error && <p className="backup-message" role="alert">{t(error)}</p>}
      {notice && <p className="backup-message" role="status">{t(notice)}</p>}

      {loading && <p className="section-description">{t('Загрузка истории…')}</p>}
      {!loading && items.length === 0 && (
        <p className="section-description">{t('Пока снимков нет — они появятся по мере работы.')}</p>
      )}

      {items.length > 0 && (
        <ul className="state-history-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className="state-history-reason">{t(REASON_LABELS[item.reason] || 'Снимок')}</span>
              <span className="state-history-date">{formatLocalizedDate(item.createdAt, dateTimeOptions)} · {formatSize(item.size, t('КБ'), t('Б'))}</span>
              <button
                className="button button--light state-history-restore"
                type="button"
                disabled={busyId === item.id}
                onClick={() => restore(item.id)}
              >
                {busyId === item.id ? t('Восстанавливаем…') : t('Откатить')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
