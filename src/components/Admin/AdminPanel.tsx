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

const STATUS_LABELS: Record<UserStatus, string> = { pending: 'Ожидает', approved: 'Одобрен', blocked: 'Заблокирован' };
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

type AdminAction = 'delete' | 'kick' | AdminUserAction;

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function AdminPanel() {
  const { token, user: me } = useAuth();
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
          title: 'Удалить пользователя?',
          message: `«${target?.username ?? ''}» и все его данные будут удалены безвозвратно.`,
          confirmText: 'Удалить',
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
      title: 'Новый пароль',
      message: `Для «${target?.username ?? ''}». Все сессии пользователя будут разорваны.`,
      inputLabel: 'Новый пароль (от 6 символов)',
      inputType: 'password',
      autoComplete: 'new-password',
      minLength: 6,
      confirmText: 'Сбросить пароль',
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
          <p className="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</p>
          <h2>Админ-панель</h2>
        </div>
        <span className="section-count">{users.length} всего</span>
      </div>
      <p className="section-description">
        Одобряйте заявки, кикайте или блокируйте пользователей. Список обновляется автоматически.
      </p>

      <div className="admin-stats">
        <article className="admin-stat admin-stat--online">
          <span className="admin-stat-value">{stats?.online ?? '—'}</span>
          <span className="admin-stat-label">Сейчас в сети</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-value">{stats?.approved ?? '—'}</span>
          <span className="admin-stat-label">С доступом</span>
        </article>
        <article className="admin-stat admin-stat--pending">
          <span className="admin-stat-value">{stats?.pending ?? '—'}</span>
          <span className="admin-stat-label">Ожидают</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-value">{stats?.blocked ?? '—'}</span>
          <span className="admin-stat-label">Заблокированы</span>
        </article>
      </div>

      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      {notice && <p className="admin-message" role="status">{notice}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Статус</th>
              <th>Онлайн</th>
              <th>Создан</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="admin-empty">Загрузка…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="admin-empty">Пока нет зарегистрированных пользователей.</td></tr>
            )}
            {users.map((entry) => {
              const isSelf = entry.id === me?.id;
              const isAdmin = entry.role === 'admin';
              return (
                <tr key={entry.id} className={entry.status === 'blocked' ? 'is-blocked' : ''}>
                  <td>
                    <span className="admin-username">{entry.username}</span>
                    {isAdmin && <span className="admin-role-tag">ADMIN</span>}
                    {isSelf && <span className="admin-role-tag admin-role-tag--me">ВЫ</span>}
                  </td>
                  <td>
                    <span className={`admin-status admin-status--${entry.status}`}>{STATUS_LABELS[entry.status] ?? entry.status}</span>
                  </td>
                  <td>
                    {entry.online ? <span className="admin-online is-on">● в сети</span> : <span className="admin-online">—</span>}
                  </td>
                  <td className="admin-date">{formatDate(entry.createdAt)}</td>
                  <td>
                    <div className="admin-actions">
                      {isAdmin ? (
                        <span className="admin-date">—</span>
                      ) : (
                        <>
                          {entry.status === 'pending' && (
                            <button type="button" className="button button--red admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'approve')}>Одобрить</button>
                          )}
                          {entry.status === 'approved' && (
                            <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'kick')} title="Разорвать активные сессии">Кикнуть</button>
                          )}
                          {entry.status === 'blocked' ? (
                            <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'unblock')}>Разблокировать</button>
                          ) : (
                            entry.status === 'approved' && (
                              <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'block')}>Заблокировать</button>
                            )
                          )}
                          {entry.status === 'pending' && (
                            <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => act(entry.id, 'block')}>Отклонить</button>
                          )}
                          <button type="button" className="button button--light admin-btn" disabled={busyId === entry.id} onClick={() => resetPassword(entry.id)} title="Задать пользователю новый пароль">Сбросить пароль</button>
                          <button type="button" className="text-button admin-delete" disabled={busyId === entry.id} onClick={() => act(entry.id, 'delete')}>Удалить</button>
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
          <p className="eyebrow">БЕЗОПАСНОСТЬ</p>
          <h3>Один постоянный администратор</h3>
          <p className="section-description">
            Аккаунт администратора единственный и неизменный: его нельзя удалить, заблокировать
            или создать второго. Логин зафиксирован, а пароль, который вы сменили сами,
            сервер не сбрасывает. Если задан <code>WAKANDA_ADMIN_PASS</code>, он применяется
            при каждом запуске.
          </p>
        </div>
        <div className="admin-note-card">
          <p className="admin-note-line">
            Логин администратора: <strong>{users.find((entry) => entry.role === 'admin')?.username ?? '—'}</strong>
          </p>
          <p className="admin-note-line admin-note-line--muted">
            Пароль — в файле <code>server/data/admin-credentials.txt</code> на сервере.
            Чтобы сменить его осознанно, задай <code>WAKANDA_ADMIN_PASS</code> в <code>server/.env</code> и перезапусти сервер.
          </p>
        </div>
      </div>
    </section>
  );
}
