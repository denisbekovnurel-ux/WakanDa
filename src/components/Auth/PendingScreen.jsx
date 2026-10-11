import { useAuth } from '../../auth/AuthContext';
import { AuthBrand } from './Brand';

export function PendingScreen({ blocked = false }) {
  const { user, logout } = useAuth();

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card--pending">
        <AuthBrand />
        <div className={`pending-pulse ${blocked ? 'is-blocked' : ''}`} aria-hidden="true">
          <span className="pending-pulse-ring" />
          <span className="pending-pulse-dot" />
        </div>
        <h1 className="pending-title">{blocked ? 'Доступ закрыт' : 'Заявка отправлена'}</h1>
        <p className="pending-text">
          {blocked ? (
            'Администратор ограничил ваш доступ. Свяжитесь с ним, чтобы восстановить вход.'
          ) : (
            <>
              <strong>{user?.username}</strong>, ваш аккаунт ожидает одобрения администратора.
              <br />
              Страница обновится автоматически, как только доступ откроют.
            </>
          )}
        </p>
        <div className="pending-status" role="status" aria-live="polite">
          {blocked ? 'СТАТУС: ЗАБЛОКИРОВАН' : 'СТАТУС: ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ'}
        </div>
        <button className="button button--light" type="button" onClick={logout}>
          Выйти
        </button>
      </div>
      <p className="auth-footer">WAKANDA 와칸다 <span aria-hidden="true">✳</span></p>
    </div>
  );
}
