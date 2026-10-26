import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAppStore } from '../store/AppStore';
import { useAuth } from '../auth/AuthContext';
import { createStateSnapshot } from '../api/stateApi';
import { assertValidBackupData, normalizeState } from '../utils/schema';
import { useFeedback } from './FeedbackContext';
import type { SyncStatus } from '../types';
import { errorMessage } from '../utils/errors';

const STATUS_TEXT: Record<SyncStatus, string> = {
  connecting: 'Подключаемся к серверу…',
  saving: 'Сохраняем…',
  saved: 'Автосохранение на сервер включено.',
  offline: 'Сервер недоступен. Данные пока только в этом браузере — запусти бэкенд.',
};

export function BackupControls() {
  const { state, actions, syncStatus } = useAppStore();
  const { token } = useAuth();
  const { confirm } = useFeedback();
  const [message, setMessage] = useState('');

  function buildBackup() {
    const data = {
      tasks: state.tasks,
      oneOffTasks: state.oneOffTasks,
      notes: state.notes,
      theme: state.theme,
      reminderTime: state.reminderTime,
      reminderEnabled: state.reminderEnabled,
    };
    return { format: 'wakanda-backup', version: 2, exportedAt: new Date().toISOString(), data };
  }

  function handleExport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wakanda-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('Резервная копия скачана.');
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const data = backup?.data;
      const isKnownFormat = backup?.format === 'wakanda-backup' && (backup?.version === 2 || backup?.version === 1);
      if (!isKnownFormat) throw new Error('Формат копии не распознан.');
      assertValidBackupData(data);
      const confirmed = await confirm({
        title: 'Восстановить из файла?',
        message: 'Текущие привычки и задачи будут заменены данными из файла. Текущая версия сохранится в истории.',
        confirmText: 'Восстановить',
      });
      if (!confirmed) return;
      // Снимок текущего состояния на сервере — чтобы импорт можно было откатить.
      try {
        await createStateSnapshot(token, 'import');
      } catch {
        // оффлайн или сервер недоступен: снимок сделает автосохранение позже
      }
      actions.replaceState(normalizeState(data));
      setMessage('Данные восстановлены и сохранятся на сервер.');
    } catch (error) {
      setMessage(error instanceof SyntaxError ? 'Не удалось прочитать файл.' : errorMessage(error, 'Не удалось восстановить данные.'));
    }
  }

  return (
    <div className="backup-controls">
      <p className={`backup-warning ${syncStatus === 'saved' || syncStatus === 'saving' ? 'backup-warning--ok' : ''}`} role="status">
        {STATUS_TEXT[syncStatus]}
      </p>
      <button className="button button--light" type="button" onClick={handleExport}>Скачать копию</button>
      <label className="button button--light backup-import">Восстановить из файла<input type="file" accept="application/json,.json" onChange={handleImport} /></label>
      {message && <p className="backup-message" role="status">{message}</p>}
    </div>
  );
}
