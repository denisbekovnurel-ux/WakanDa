import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useAppStore } from '../store/AppStore';
import { createStateSnapshot, fetchStateHistory, restoreStateSnapshot } from '../api/stateApi';

const REASON_LABELS = {
  auto: 'Автоснимок',
  manual: 'Снимок вручную',
  import: 'Перед импортом',
  restore: 'Перед откатом',
};

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ` : `${bytes} Б`;
}

export function StateHistory() {
  const { token } = useAuth();
  const { actions } = useAppStore();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchStateHistory(token);
      setItems(Array.isArray(data?.history) ? data.history : []);
      setError('');
    } catch (err) {
      setError(err?.message || 'Не удалось загрузить историю');
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
      setError(err?.message || 'Не удалось создать снимок');
    }
  }

  async function restore(id) {
    if (!window.confirm('Заменить текущие данные выбранным снимком? Текущая версия тоже сохранится в истории.')) return;
    setBusyId(id);
    setNotice('');
    try {
      const data = await restoreStateSnapshot(token, id);
      actions.replaceState(data.state);
      setNotice('Снимок восстановлен и отправлен на сервер.');
      await load();
    } catch (err) {
      setError(err?.message || 'Не удалось восстановить снимок');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="state-history">
      <div className="state-history-head">
        <div>
          <p className="eyebrow">ЗАЩИТА ДАННЫХ</p>
          <h2>История версий</h2>
          <p className="section-description">
            Сервер хранит последние 40 версий: автоснимки (раз в 10 минут), а также снимки
            перед импортом бэкапа и откатом. Любую версию можно вернуть.
          </p>
        </div>
        <button className="button button--light" type="button" onClick={makeSnapshot}>Сделать снимок</button>
      </div>

      {error && <p className="backup-message" role="alert">{error}</p>}
      {notice && <p className="backup-message" role="status">{notice}</p>}

      {loading && <p className="section-description">Загрузка истории…</p>}
      {!loading && items.length === 0 && (
        <p className="section-description">Пока снимков нет — они появятся по мере работы.</p>
      )}

      {items.length > 0 && (
        <ul className="state-history-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className="state-history-reason">{REASON_LABELS[item.reason] || 'Снимок'}</span>
              <span className="state-history-date">{formatDate(item.createdAt)} · {formatSize(item.size)}</span>
              <button
                className="button button--light state-history-restore"
                type="button"
                disabled={busyId === item.id}
                onClick={() => restore(item.id)}
              >
                {busyId === item.id ? 'Восстанавливаем…' : 'Откатить'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
