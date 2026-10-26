import { useEffect, useRef, useState } from 'react';
import { pluralize } from '../utils/pluralize';
import type { AppState, ConflictChoice, SyncConflict } from '../types';
import { errorMessage } from '../utils/errors';
import { useI18n } from '../i18n';

function summarize(state: AppState): string[] {
  return [
    `${state.tasks.length} ${pluralize(state.tasks.length, 'привычка', 'привычки', 'привычек')}`,
    `${state.oneOffTasks.length} ${pluralize(state.oneOffTasks.length, 'разовое дело', 'разовых дела', 'разовых дел')}`,
    `${Object.keys(state.notes).length} ${pluralize(Object.keys(state.notes).length, 'заметка', 'заметки', 'заметок')}`,
  ];
}

interface VersionCardProps {
  title: string;
  hint: string;
  items: string[];
  action: string;
  busy: boolean;
  onChoose: () => void;
}

function VersionCard({ title, hint, items, action, busy, onChoose }: VersionCardProps) {
  const { t } = useI18n();
  return (
    <article className="sync-version">
      <h3>{t(title)}</h3>
      <p className="sync-version-hint">{t(hint)}</p>
      <ul className="sync-version-list">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <button className="button button--red" type="button" disabled={busy} onClick={onChoose}>{t(action)}</button>
    </article>
  );
}

export function SyncConflictDialog({ conflict, onChoose }: { conflict: SyncConflict; onChoose: (choice: ConflictChoice) => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<ConflictChoice | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Клавиатурный фокус должен попадать в диалог. Escape намеренно не закрывает
  // окно: выбор обязателен, иначе автосохранение так и останется заблокировано.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function choose(which: ConflictChoice) {
    setBusy(which);
    setError('');
    try {
      await onChoose(which);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось разрешить конфликт. Попробуй ещё раз.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title">
      <div className="sync-dialog" ref={dialogRef} tabIndex={-1} style={{ outline: 'none' }}>
        <p className="eyebrow">{t('КОНФЛИКТ СИНХРОНИЗАЦИИ')}</p>
        <h2 id="sync-dialog-title">{t('Есть две версии данных')}</h2>
        <p className="section-description">
          {t('Ты менял данные без подключения к серверу, и с тех пор на сервере тоже появились изменения. Выбери, какую версию оставить. Неиспользованная версия пропадёт, поэтому при сомнениях сначала скачай резервную копию.')}
        </p>
        {error && <p className="backup-message" role="alert">{t(error)}</p>}
        <div className="sync-versions">
          <VersionCard
            title="Мои изменения"
            hint="Данные из этого браузера (оффлайн-правки)."
            items={summarize(conflict.local)}
            action="Оставить мои данные"
            busy={Boolean(busy)}
            onChoose={() => choose('local')}
          />
          <VersionCard
            title="Версия с сервера"
            hint="То, что уже сохранено на сервере."
            items={summarize(conflict.remote)}
            action="Загрузить серверную"
            busy={Boolean(busy)}
            onChoose={() => choose('server')}
          />
        </div>
      </div>
    </div>
  );
}
