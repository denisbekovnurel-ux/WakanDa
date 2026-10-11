import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  apiAdminDeleteUser,
  apiAdminKick,
  apiAdminSetStatus,
  apiAdminUsers,
} from '../../api/authApi';

const STATUS_LABELS = { pending: 'Ожидает', approved: 'Одобрен', blocked: 'Заблокирован' };
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function AdminPanel() {
  const { token, user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
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
      setError(err?.message || 'Не удалось загрузить список пользователей');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    const timer = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  async function act(id, action) {
    setBusyId(id);
    setNotice('');
    try {
      if (action === 'delete') {
        const target = users.find((entry) => entry.id === id);
        if (!window.confirm(`Удалить пользователя «${target?.username ?? ''}» вместе с его данными? Действие необратимо.`)) {
          return;
        }
        await apiAdminDeleteUser(token, id);
        setNotice('Пользователь удалён');
      } else if (action === 'kick') {
        await apiAdminKick(token, id);
        setNotice('Пользователь отключён от сессии');
      } else {
        await apiAdminSetStatus(token, id, action);
        setNotice(action === 'approve' || action === 'unblock' ? 'Доступ открыт' : 'Доступ заблокирован');
      }
      await load();
    } catch (err) {
      setError(err?.message || 'Не удалось выполнить действие');
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
            или создать второго. Данные входа хранятся на сервере и автоматически
            восстанавливаются при каждом запуске.
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
