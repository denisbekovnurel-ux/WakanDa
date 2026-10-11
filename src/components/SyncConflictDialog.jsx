import { useState } from 'react';
import { pluralize } from '../utils/pluralize';

function summarize(state) {
  return [
    `${state.tasks.length} ${pluralize(state.tasks.length, 'привычка', 'привычки', 'привычек')}`,
    `${state.oneOffTasks.length} ${pluralize(state.oneOffTasks.length, 'разовое дело', 'разовых дела', 'разовых дел')}`,
    `${state.goals.length} ${pluralize(state.goals.length, 'цель', 'цели', 'целей')}`,
    `${Object.keys(state.notes).length} ${pluralize(Object.keys(state.notes).length, 'заметка', 'заметки', 'заметок')}`,
  ];
}

function VersionCard({ title, hint, items, action, busy, onChoose }) {
  return (
    <article className="sync-version">
      <h3>{title}</h3>
      <p className="sync-version-hint">{hint}</p>
      <ul className="sync-version-list">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <button className="button button--red" type="button" disabled={busy} onClick={onChoose}>{action}</button>
    </article>
  );
}

export function SyncConflictDialog({ conflict, onChoose }) {
  const [busy, setBusy] = useState(null);

  async function choose(which) {
    setBusy(which);
    try {
      await onChoose(which);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title">
      <div className="sync-dialog">
        <p className="eyebrow">КОНФЛИКТ СИНХРОНИЗАЦИИ</p>
        <h2 id="sync-dialog-title">Есть две версии данных</h2>
        <p className="section-description">
          Ты менял данные без подключения к серверу, и с тех пор на сервере тоже появились изменения.
          Выбери, какую версию оставить. Неиспользованная версия пропадёт, поэтому при сомнениях
          сначала скачай резервную копию.
        </p>
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
