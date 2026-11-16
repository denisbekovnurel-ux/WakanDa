import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { errorMessage } from '../utils/errors';
import { createReminder, deleteReminder, fetchReminders } from '../api/remindersApi';
import type { Reminder } from '../api/remindersApi';
import { useFeedback } from './FeedbackContext';

const dueOptions: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function sortReminders(items: Reminder[]): Reminder[] {
  return [...items].sort((left, right) => left.dueAt.localeCompare(right.dueAt));
}

/**
 * Напоминания на конкретную дату и время. Их можно создавать здесь или прямо
 * в Telegram — бот и сайт работают с одним списком на сервере.
 */
export function RemindersPanel() {
  const { token } = useAuth();
  const { notify, confirm } = useFeedback();
  const { t, formatDate } = useI18n();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [text, setText] = useState('');
  const [date, setDate] = useState(() => localDateKey());
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    fetchReminders(token)
      .then((items) => {
        if (!cancelled) setReminders(items);
      })
      .catch(() => {
        // Панель не должна ломать настройки: ошибку покажем при следующем действии.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setFormError(t('Напиши, о чём напомнить.'));
      return;
    }
    if (!date || !time) {
      setFormError(t('Выбери дату и время напоминания.'));
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const reminder = await createReminder(token, {
        text: trimmed,
        date,
        time,
        timezoneOffset: -new Date().getTimezoneOffset(),
      });
      setReminders((current) => sortReminders([...current, reminder]));
      setText('');
      notify(t('Напоминание добавлено.'), { tone: 'success' });
    } catch (error) {
      setFormError(errorMessage(error, t('Не удалось создать напоминание.')));
    } finally {
      setBusy(false);
    }
  }

  async function remove(reminder: Reminder) {
    if (!token) return;
    const confirmed = await confirm({
      title: t('Удалить напоминание?'),
      message: reminder.text,
      confirmText: t('Удалить'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteReminder(token, reminder.id);
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
      notify(t('Напоминание удалено.'), { tone: 'success' });
    } catch (error) {
      notify(errorMessage(error, t('Не удалось удалить напоминание.')), { tone: 'error' });
    }
  }

  if (!token) return null;

  return (
    <div className="reminders-panel">
      <div className="reminders-head">
        <div>
          <p className="eyebrow">{t('ТОЧНАЯ ДАТА И ВРЕМЯ')}</p>
          <h3>{t('Мои напоминания')}</h3>
        </div>
        <span className="reminders-count">{t('Активных: {count}', { count: reminders.length })}</span>
      </div>
      <p className="reminders-hint">
        {t('Добавь напоминание на конкретную дату. В Telegram можно написать: «Напомни мне позвонить маме 01.10 в 21:00».')}
      </p>
      <form className="reminder-form" onSubmit={submit}>
        <label className="reminder-form-text">
          {t('Что напомнить')}
          <input
            type="text"
            value={text}
            maxLength={500}
            placeholder={t('Например: позвонить маме')}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label>
          {t('Дата')}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          {t('Время')}
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <button className="button button--red" type="submit" disabled={busy}>
          {t('Добавить')}
        </button>
      </form>
      {formError && <p className="reminder-error" role="alert">{formError}</p>}
      {reminders.length === 0 ? (
        <p className="reminders-empty">{t('Пока пусто. Добавь первое напоминание.')}</p>
      ) : (
        <ul className="reminder-list">
          {reminders.map((reminder) => (
            <li key={reminder.id}>
              <div className="reminder-item-copy">
                <span className="reminder-when">{formatDate(new Date(reminder.dueAt), dueOptions)}</span>
                <span className="reminder-text">{reminder.text}</span>
              </div>
              <button
                className="text-button reminder-delete"
                type="button"
                onClick={() => void remove(reminder)}
                aria-label={t('Удалить напоминание «{title}»', { title: reminder.text })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
