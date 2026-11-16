import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from '../RouteLink';
import { useAuth } from '../../auth/AuthContext';
import { formatDate, useI18n } from '../../i18n';
import { usePwaInstall } from '../../pwa/PwaInstallContext';
import { useFeedback } from '../FeedbackContext';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { pages, pathForPage, type PageKey } from './navigation';

const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

type Theme = 'light' | 'dark';

interface TopbarProps {
  page: PageKey | null;
  pendingHabits: number;
  syncLabel: string;
  syncStatus: string;
  theme: Theme;
  nextTheme: Theme;
  themeNames: Record<Theme, string>;
  themeIcons: Record<Theme, string>;
  today: Date;
  todayKey: string;
  onToggleTheme: () => void;
  onOpenPassword: () => void;
}

/**
 * Шапка приложения: бренд, нижняя мобильная навигация, статус синхронизации
 * и меню аккаунта. Данные приходят props'ами из App, а состояние меню живёт
 * здесь, чтобы App оставался композиционным корнем.
 */
export function Topbar({
  page,
  pendingHabits,
  syncLabel,
  syncStatus,
  theme,
  nextTheme,
  themeNames,
  themeIcons,
  today,
  todayKey,
  onToggleTheme,
  onOpenPassword,
}: TopbarProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { installed, isIos, isSecure, promptInstall } = usePwaInstall();
  const { notify } = useFeedback();
  const isAdmin = user?.role === 'admin';
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  async function handleInstall() {
    setUserMenuOpen(false);
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      notify(t('WakanDa установлен. Откройте его с рабочего стола или экрана «Домой».'), { tone: 'success' });
      return;
    }
    if (outcome !== 'unavailable') return;
    const message = isIos
      ? t('На iPhone и iPad установка доступна в Safari: «Поделиться» → «На экран „Домой“».')
      : !isSecure
        ? t('Установка доступна только по HTTPS. Откройте сайт по защищённому адресу.')
        : t('В Chrome откройте меню ⋮ и выберите «Установить приложение» или «Добавить на главный экран».');
    notify(message, { tone: 'info' });
  }

  // Меню аккаунта закрывается по Escape и по клику вне его.
  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [userMenuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/" aria-label={t('WakanDa — на главную')}><span className="brand-mark" aria-hidden="true">W</span><span>WakanDa<span className="brand-period">.</span></span></Link>
        <nav className="main-nav" aria-label={t('Основная навигация')}>
          {(Object.entries(pages) as Array<[PageKey, (typeof pages)[PageKey]]>)
            .filter(([key]) => key !== 'admin' || isAdmin)
            .map(([key, item]) => (
              <NavLink key={key} to={pathForPage(key)} end={key === 'home'} className={({ isActive }) => (isActive ? 'is-active' : '')}>
                {item.label}
              </NavLink>
            ))}
        </nav>
        <div className="topbar-tools">
          {page === 'home' && <span className="pending-reminder" aria-live="polite">{pendingHabits ? t('ОСТАЛОСЬ ОТМЕТИТЬ {count}', { count: pendingHabits }) : t('ВСЁ ОТМЕЧЕНО')}</span>}
          {syncLabel && (
            <span className={`sync-pill sync-pill--${syncStatus}`} title={t('Статус синхронизации: {status}', { status: syncLabel })}>
              <span className="sync-dot" aria-hidden="true" />
              <span>{syncLabel}</span>
            </span>
          )}
          <div className="user-menu" ref={userMenuRef}>
            <button className="user-menu-button" type="button" aria-haspopup="menu" aria-expanded={userMenuOpen} aria-label={t('Открыть меню аккаунта')} onClick={() => setUserMenuOpen((open) => !open)}>
              <span className="user-avatar" aria-hidden="true">{user?.username?.slice(0, 1).toUpperCase() ?? '·'}</span>
              <span className="user-menu-name">{user?.username}</span>
              <span className="user-chip-role">{isAdmin ? 'ADMIN' : 'USER'}</span>
              <span className="user-menu-chevron" aria-hidden="true">▾</span>
            </button>
            {userMenuOpen && (
              <div className="user-popover" role="menu" aria-label={t('Меню аккаунта')}>
                <div className="user-popover-head">
                  <span className="user-popover-name">{user?.username}</span>
                  <span className="user-popover-role">{isAdmin ? t('Администратор') : t('Пользователь')}</span>
                </div>
                <button type="button" role="menuitem" onClick={() => { setUserMenuOpen(false); onOpenPassword(); }}>{t('Пароль и сессии')}</button>
                {!installed && <button type="button" role="menuitem" onClick={handleInstall}>{t('Установить приложение')}</button>}
                <button type="button" role="menuitem" className="is-danger" onClick={() => { setUserMenuOpen(false); logout(); }}>{t('Выйти из аккаунта')}</button>
              </div>
            )}
          </div>
          <LanguageSwitcher />
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={t('Тема: {current}. Переключить на «{next}»', { current: themeNames[theme], next: themeNames[nextTheme] })} title={t('Тема: {current}', { current: themeNames[theme] })}>{themeIcons[theme]}</button>
          <time className="today-date" dateTime={todayKey}>{formatDate(today, dateOptions)}</time>
        </div>
      </div>
    </header>
  );
}
