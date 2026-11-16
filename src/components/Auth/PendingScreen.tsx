import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { AuthBrand } from './Brand';

export function PendingScreen({ blocked = false }: { blocked?: boolean }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();

  return (
    <div className="auth-shell">
      <LanguageSwitcher className="lang-switch--auth" />
      <div className="auth-card auth-card--pending">
        <AuthBrand />
        <div className={`pending-pulse ${blocked ? 'is-blocked' : ''}`} aria-hidden="true">
          <span className="pending-pulse-ring" />
          <span className="pending-pulse-dot" />
        </div>
        <h1 className="pending-title">{blocked ? t('Доступ закрыт') : t('Заявка отправлена')}</h1>
        <p className="pending-text">
          {blocked ? (
            t('Администратор ограничил ваш доступ. Свяжитесь с ним, чтобы восстановить вход.')
          ) : (
            <>
              <strong>{user?.username}</strong>, {t('ваш аккаунт ожидает одобрения администратора.')}
              <br />
              {t('Страница обновится автоматически, как только доступ откроют.')}
            </>
          )}
        </p>
        <div className="pending-status" role="status" aria-live="polite">
          {blocked ? t('СТАТУС: ЗАБЛОКИРОВАН') : t('СТАТУС: ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ')}
        </div>
        <button className="button button--light" type="button" onClick={logout}>
          {t('Выйти')}
        </button>
      </div>
      <p className="auth-footer">WAKANDA <span aria-hidden="true">✳</span></p>
    </div>
  );
}
