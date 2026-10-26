import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../FeedbackContext';
import {
  apiAdminDeleteUser,
  apiAdminKick,
  apiAdminResetPassword,
  apiAdminSetStatus,
  apiAdminUsers,
} from '../../api/authApi';
import type { AdminUserAction } from '../../api/authApi';
import { TIMINGS } from '../../config/timings';
import { adminPasswordSchema, firstError } from '../../validation/schemas';
import type { AdminStats, User, UserStatus } from '../../types';
import { errorMessage } from '../../utils/errors';
import { formatDate, useI18n } from '../../i18n';

const STATUS_LABELS: Record<UserStatus, string> = { pending: 'Ожидает', approved: 'Одобрен', blocked: 'Заблокирован' };
const dateTimeOptions: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

type AdminAction = 'delete' | 'kick' | AdminUserAction;

function formatAdminDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : formatDate(date, dateTimeOptions);
}

export function AdminPanel() {
  const { token, user: me } = useAuth();
  const { t } = useI18n();
  const { confirm, prompt, notify } = useFeedback();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiAdminUsers(token);
      setUsers(data.users);
      setStats(data.stats);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Не удалось загрузить список пользователей'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    const timer = window.setInterval(load, TIMINGS.adminUsersPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  async function act(id: string, action: AdminAction) {
    setBusyId(id);
    setNotice('');
    try {
      if (action === 'delete') {
        const target = users.find((entry) => entry.id === id);
        const confirmed = await confirm({
          title: t('Удалить пользователя?'),
          message: t('«{username}» и все его данные будут удалены безвозвратно.', { username: target?.username ?? '' }),
          confirmText: t('Удалить'),
          tone: 'danger',
        });
        if (!confirmed) return;
        await apiAdminDeleteUser(token, id);
        setNotice('Пользователь удалён');
      } else if (action === 'kick') {
        await apiAdminKick(token, id);
        setNotice('Пользователь отключён от сессии');
      } else {
        await apiAdminSetStatus(token, id, action as AdminUserAction);
        setNotice(action === 'approve' || action === 'unblock' ? 'Доступ открыт' : 'Доступ заблокирован');
      }
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось выполнить действие'));
    } finally {
      setBusyId('');
    }
  }

  async function resetPassword(id: string) {
    const target = users.find((entry) => entry.id === id);
    const password = await prompt({
      title: t('Новый пароль'),
      message: t('Для «{username}». Все сессии пользователя будут разорваны.', { username: target?.username ?? '' }),
      inputLabel: t('Новый пароль (от 6 символов)'),
      inputType: 'password',
      autoComplete: 'new-password',
      minLength: 6,
      confirmText: t('Сбросить пароль'),
    });
    if (password == null) return;
    const parsed = adminPasswordSchema.safeParse(password);
    if (!parsed.success) {
      notify(firstError(parsed), { tone: 'error' });
      return;
    }
    setBusyId(id);
    setNotice('');
    try {
      await apiAdminResetPassword(token, id, parsed.data);
      setNotice('Пароль сброшен, пользователь разлогинен');
    } catch (err) {
      setError(errorMessage(err, 'Не удалось сбросить пароль'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="section-card page-section admin-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t('УПРАВЛЕНИЕ ДОСТУПОМ')}</p>
          <h2>{t('Админ-панель')}</h2>
        </div>
        <span className="section-count">{t('{count} всего', { count: users.length })}</span>
      </div>
      <p className="section-description">
        {t('Одобряйте заявки, кикайте или блокируйте пользователей. Список обновляется автоматически.')}
      </p>

      <div className="admin-stats">
        <article className="admin-stat admin-stat--online">
          <span className="admin-stat-value">{stats?.online ?? '—'}</span>
          <span className="admin-stat-label">{t('Сейчас в сети')}</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-value">{stats?.approved ?? '—'}</span>
          <span className="admin-stat-label">{t('С доступом')}</span>
        </article>
        <article className="admin-stat admin-stat--pending">
          <span className="admin-stat-value">{stats?.pending ?? '—'}</span>
          <span className="admin-stat-label">{t('Ожидают')}</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-value">{stats?.blocked ?? '—'}</span>
          <span className="admin-stat-label">{t('Заблокированы')}</span>
        </article>
      </div>

      {error && <p className="admin-message admin-message--error" role="alert">{t(error)}</p>}
      {notice && <p className="admin-message" role="status">{t(notice)}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('Пользователь')}</th>
              <th>{t('Статус')}</th>
              <th>{t('Онлайн')}</th>
              <th>{t('Создан')}</th>
              <th aria-label={t('Действия')} />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="admin-empty">{t('Загрузка…')}</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="admin-empty">{t('Пока нет зарегистрированных пользователей.')}</td></tr>
            )}
            {users.map((entry) => {
              const isSelf = entry.id === me?.id;
              const isAdmin = entry.role === 'admin';
              return (
                <tr key={entry.id} className={entry.status === 'blocked' ? 'is-blocked' : ''}>
                  <td>
                    <span className="admin-username">{entry.username}</span>
                    {isAdmin && <span className="admin-role-tag">ADMIN</span>}
                    {isSelf && <span className="admin-role-tag admin-role-tag--me">{t('ВЫ')}</span>}
                  </td>
                  <td>
                    <span className={`admin-status admin-status--${entry.status}`}>{t(STATUS_LABELS[entry.status] ?? entry.status)}</span>
                  </td>
                  <td>
                    {entry.online ? <span className="admin-online is-on">● {t('в сети')}</span> : <span className="admin-online">—</span>}
                  </td>
                  <td className="admin-date">{formatAdminDate(entry.createdAt)}</td>
                  <td>
                    <div className="admin-actions">
                      {isAdmin ? (
                        <span className="admin-date">—</span>
                      ) : (
                        <>
                          {entry.status === 'pending' && (
                            <button type="button" className="button button--red admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'approve')}>{t('Одобрить')}</button>
                          )}
                          {entry.status === 'approved' && (
                            <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'kick')} title={t('Разорвать активные сессии')}>{t('Кикнуть')}</button>
                          )}
                          {entry.status === 'blocked' ? (
                            <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'unblock')}>{t('Разблокировать')}</button>
                          ) : (
                            entry.status === 'approved' && (
                              <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'block')}>{t('Заблокировать')}</button>
                            )
                          )}
                          {entry.status === 'pending' && (
                            <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'block')}>{t('Отклонить')}</button>
                          )}
                          <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => resetPassword(entry.id)} title={t('Задать пользователю новый пароль')}>{t('Сбросить пароль')}</button>
                          <button type="button" className="text-button admin-delete" disabled={busyId === entry.id} onClick={() => act(entry.id, 'delete')}>{t('Удалить')}</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="admin-security">
        <div>
          <p className="eyebrow">{t('БЕЗОПАСНОСТЬ')}</p>
          <h3>{t('Один постоянный администратор')}</h3>
          <p className="section-description">
            {t('Аккаунт администратора единственный и неизменный: его нельзя удалить, заблокировать или создать второго. Логин зафиксирован, а пароль, который вы сменили сами, сервер не сбрасывает.')}{' '}
            {t('Если задан')} <code>WAKANDA_ADMIN_PASS</code>{t(', он применяется при каждом запуске.')}
          </p>
        </div>
        <div className="admin-note-card">
          <p className="admin-note-line">
            {t('Логин администратора:')} <strong>{users.find((entry) => entry.role === 'admin')?.username ?? '—'}</strong>
          </p>
          <p className="admin-note-line admin-note-line--muted">
            {t('Пароль — в файле')} <code>server/data/admin-credentials.txt</code> {t('на сервере. Чтобы сменить его осознанно, задай')} <code>WAKANDA_ADMIN_PASS</code> {t('в')} <code>server/.env</code> {t('и перезапусти сервер.')}
          </p>
        </div>
      </div>
    </section>
  );
}
