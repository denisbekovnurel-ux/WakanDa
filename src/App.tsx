import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useToday } from './hooks/TodayContext';
import { usePrefersDark } from './hooks/usePrefersDark';
import { useAppStore } from './store/AppStore';
import { selectActiveHabits } from './store/selectors';
import { useReminders } from './hooks/useReminders';
import { pluralize } from './utils/pluralize';
import { isPaused } from './utils/calc';
import { TIMINGS } from './config/timings';
import { BackupControls } from './components/BackupControls';
import { StateHistory } from './components/StateHistory';
import { SyncConflictDialog } from './components/SyncConflictDialog';
import { PasswordChangeDialog } from './components/PasswordChangeDialog';
import { getBadges } from './utils/badges';
import { useAuth } from './auth/AuthContext';
import { ensurePushSubscription, disablePushSubscription } from './utils/push';
import { sendTestPush } from './api/pushApi';
import { FeedbackViewport } from './components/Feedback';
import { useFeedback } from './components/FeedbackContext';
import { PageFallback } from './components/PageFallback';
import quotes from './data/quotes.json';
import { errorMessage } from './utils/errors';
import './App.css';

type PageKey = 'home' | 'daily' | 'oneoff' | 'stats' | 'admin';

interface PageMeta {
  label: string;
  en: string;
  ko: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

// Ленивые разделы: попадают в бандл только когда пользователь их открыл.
// Главная остаётся в основном чанке — это точка входа после входа в аккаунт.
const DailyPage = lazy(() => import('./pages/DailyPage'));
const OneOffPage = lazy(() => import('./pages/OneOffPage'));
const StatsPage = lazy(() => import('./components/Stats/StatsPage').then((module) => ({ default: module.StatsPage })));
const AdminPanel = lazy(() => import('./components/Admin/AdminPanel').then((module) => ({ default: module.AdminPanel })));

const pages: Record<PageKey, PageMeta> = {
  home: { label: 'HOME 홈', en: 'HOME', ko: '홈', eyebrow: 'ПЛАН НА ДЕЙСТВИЕ', title: 'Точка старта', description: 'Порядок в делах. Холодная голова. Каждый день — шаг вперёд.', image: 'home-bg.jpg' },
  daily: { label: 'DAILY 매일', en: 'DAILY', ko: '매일', eyebrow: 'РИТМ И ПОВТОРЕНИЕ', title: 'Ежедневный режим', description: 'Отмечай сделанное. Месяц покажет, насколько крепка твоя дисциплина.', image: 'daily-bg.jpg' },
  oneoff: { label: 'ONE-SHOT 단발', en: 'ONE-SHOT', ko: '단발', eyebrow: 'ДЕЛО ДОЛЖНО БЫТЬ ЗАКРЫТО', title: 'Разовые задачи', description: 'Список конкретных дел. Выполнил — закрыл. История остаётся в архиве.', image: 'oneoff-bg.jpg' },
  stats: { label: 'STATS 통계', en: 'STATS', ko: '통계', eyebrow: 'ЦИФРЫ НЕ ВРУТ', title: 'Статистика', description: 'Серия, ритм месяца и годовая карта — виден весь путь целиком.', image: 'stats-bg.jpg' },
  admin: { label: 'ADMIN 관리자', en: 'ADMIN', ko: '관리자', eyebrow: 'УПРАВЛЕНИЕ ДОСТУПОМ', title: 'Админ-панель', description: 'Одобряй заявки, следи за активностью и управляй доступом пользователей.', image: 'admin-bg.jpg' },
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

function isPageKey(value: string): value is PageKey {
  return Object.hasOwn(pages, value);
}

function pathForPage(key: PageKey): string {
  return key === 'home' ? '/' : `/${key}`;
}

function AdminOnly({ allowed }: { allowed: boolean }) {
  if (!allowed) {
    return <section className="section-card page-section"><p className="section-description">Раздел доступен только администратору.</p></section>;
  }
  return <AdminPanel />;
}

function App() {
  const { state, actions, conflict, resolveConflict } = useAppStore();
  const { user, token, logout } = useAuth();
  const { notify } = useFeedback();
  const isAdmin = user?.role === 'admin';
  const { oneOffTasks, theme, reminderTime, reminderEnabled } = state;
  const prefersDark = usePrefersDark();
  // «system» — следуем системной теме, иначе берём явный выбор пользователя.
  const effectiveTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const themeNames = { system: 'как в системе', light: 'светлая', dark: 'тёмная' };
  const themeIcons = { system: '◐', light: '☼', dark: '☾' };
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * quotes.length));
  const { today, todayKey } = useToday();
  const location = useLocation();
  const pageKey = location.pathname === '/' ? 'home' : location.pathname.replace(/^\//, '');
  const page = isPageKey(pageKey) ? pageKey : null;
  const currentPage = pages[page ?? 'home'];
  const activeTasks = selectActiveHabits(state);
  const completedToday = activeTasks.filter((task) => task.history?.[todayKey] === 'done').length;
  // Не напоминаем о привычках, которые сегодня не по расписанию, на паузе
  // или ещё не существовали: счётчик в уведомлении должен быть честным.
  const pendingHabits = Math.max(0, activeTasks.filter((task) => {
    if (task.schedule && !task.schedule.includes(today.getDay())) return false;
    if (isPaused(task, todayKey)) return false;
    if (task.createdAt && task.createdAt > todayKey) return false;
    return task.history?.[todayKey] !== 'done';
  }).length);
  const badges = useMemo(() => getBadges(state), [state]);
  const unlockedCount = badges.filter((badge) => badge.unlocked).length;

  const { enable: requestReminderPermission } = useReminders({ enabled: reminderEnabled, reminderTime, pendingHabits, todayKey });

  useEffect(() => {
    function captureInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  }, []);

  // При переходе между страницами остаёмся наверху — иначе длинная главная
  // «передаёт» свою прокрутку короткому разделу.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % quotes.length);
    }, TIMINGS.quoteRotateMs);
    return () => window.clearInterval(interval);
  }, []);

  // Разрешение уже выдано и напоминания включены — обновляем подписку на сервере:
  // иначе после переезда в другой часовой пояс сервер шлёт уведомления по
  // старому смещению, а устройство неизвестно для защиты от чужих подписок.
  useEffect(() => {
    if (!token || !reminderEnabled) return undefined;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return undefined;
    let cancelled = false;
    ensurePushSubscription(token)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok && result.reason === 'error') {
          console.warn('Не удалось обновить push-подписку:', result.error);
        }
      })
      .catch((error) => { if (!cancelled) console.warn('Не удалось обновить push-подписку:', error); });
    return () => { cancelled = true; };
  }, [token, reminderEnabled]);

  async function toggleReminders() {
    if (reminderEnabled) {
      actions.setReminderEnabled(false);
      if (token) await disablePushSubscription(token);
      return;
    }
    const granted = await requestReminderPermission();
    if (!granted) return;
    actions.setReminderEnabled(true);
    // С разрешением на уведомления оформляем и фоновый Web Push: тогда
    // напоминание придёт, даже когда вкладка закрыта (его шлёт сервер).
    if (token) {
      const result = await ensurePushSubscription(token);
      if (!result.ok && result.reason === 'unsupported') {
        notify('Фоновые уведомления этот браузер не поддерживает. Пока сайт открыт, напоминание всё равно сработает.', { tone: 'warning' });
      }
    }
  }

  async function sendTestNotification() {
    if (!token) return;
    try {
      const result = await sendTestPush(token);
      if ((result.sent ?? 0) > 0) notify('Тестовое уведомление отправлено — проверь шторку.', { tone: 'success' });
      else if ((result.failed ?? 0) > 0) notify('Подписка есть, но сервер не смог доставить уведомление. Попробуй позже или переподпиши уведомления.', { tone: 'error' });
      else notify('Подписка на уведомления не найдена. Включи напоминания и разреши уведомления в браузере.', { tone: 'warning' });
    } catch (error) {
      notify(errorMessage(error, 'Не удалось отправить тестовое уведомление.'), { tone: 'error' });
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  return (
    <div className={`app-shell ${effectiveTheme === 'light' ? 'theme-light' : ''}`}>
      <header className="topbar">
        <Link className="brand" to="/" aria-label="WakanDa 와칸다 — на главную"><span className="brand-mark" aria-hidden="true">W</span><span>WakanDa<span className="brand-period">.</span></span><span className="brand-ko">와칸다</span></Link>
        <nav className="main-nav" aria-label="Основная навигация">
          {(Object.entries(pages) as Array<[PageKey, PageMeta]>).filter(([key]) => key !== 'admin' || isAdmin).map(([key, item]) => <NavLink key={key} to={pathForPage(key)} end={key === 'home'} className={({ isActive }) => (isActive ? 'is-active' : '')}>{item.label}</NavLink>)}
        </nav>
        {page === 'home' && <span className="pending-reminder" aria-live="polite">{pendingHabits ? `ОСТАЛОСЬ ОТМЕТИТЬ ${pendingHabits}` : 'ВСЁ ОТМЕЧЕНО'}</span>}
        <div className="user-menu">
          <span className="user-chip" title={user?.username}>{user?.username}<span className="user-chip-role">{isAdmin ? 'ADMIN' : 'USER'}</span></span>
          <button className="logout-button" type="button" onClick={() => setShowPasswordDialog(true)} title="Пароль и сессии">Пароль</button>
          <button className="logout-button" type="button" onClick={logout} title="Выйти из аккаунта">Выйти</button>
        </div>
        <button className="theme-toggle" type="button" onClick={() => actions.setTheme(nextTheme)} aria-label={`Тема: ${themeNames[theme]}. Переключить на «${themeNames[nextTheme]}»`} title={`Тема: ${themeNames[theme]}`}>{themeIcons[theme]}</button>
        <time className="today-date" dateTime={todayKey}>{dateFormatter.format(today)}</time>
      </header>

      <main className="page-content">
        <section className={`page-hero page-hero--${page ?? 'home'}`} style={{ '--page-photo': `url('/images/${currentPage.image}')` } as CSSProperties} aria-labelledby="page-title">
          <div className="page-hero-copy"><p className="eyebrow">{currentPage.eyebrow}</p><h1 id="page-title">{currentPage.title}</h1><p className="page-hero-description">{currentPage.description}</p></div>
          <div className="hero-watermark" aria-hidden="true">{currentPage.ko}</div>
        </section>

        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={(
              <>
                <section className="stats-grid" aria-label="Сводка">
                  <article className="stat-card"><span className="stat-icon" aria-hidden="true">✦</span><div><p className="stat-label">Выполнено сегодня</p><p className="stat-value">{completedToday}<span> / {activeTasks.length}</span></p><p className="stat-foot">{pluralize(completedToday, 'привычка выполнена', 'привычки выполнены', 'привычек выполнено')}</p></div></article>
                  <article className="stat-card stat-card--red"><span className="stat-icon" aria-hidden="true">⚔</span><div><p className="stat-label">Разовые задачи</p><p className="stat-value">{oneOffTasks.filter((task) => !task.done).length}<span> в работе</span></p><p className="stat-foot">{oneOffTasks.filter((task) => task.done).length} закрыто и в архиве</p></div></article>
                  <article className="stat-card stat-card--gold"><span className="stat-icon" aria-hidden="true">🏅</span><div><p className="stat-label">Награды</p><p className="stat-value">{unlockedCount}<span> / {badges.length}</span></p><p className="stat-foot"><Link className="text-link" to="/stats">смотреть достижения</Link></p></div></article>
                </section>
                <div className="home-grid">
                  <section className="section-card home-preview"><div className="section-heading"><div><p className="eyebrow">ДЕНЬ ЗА ДНЁМ</p><h2>Твои привычки</h2></div><Link className="text-link" to="/daily">Открыть месяц <span aria-hidden="true">↗</span></Link></div><p className="section-description">{activeTasks.length ? `В списке ${activeTasks.length} ${pluralize(activeTasks.length, 'привычка', 'привычки', 'привычек')}. Продолжай держать ритм.` : 'Добавь привычку и начни собирать свою серию.'}</p><ul className="home-habit-list">{activeTasks.slice(0, 4).map((task) => <li key={task.id}><span className={`home-habit-mark ${task.history?.[todayKey] === 'done' ? 'is-done' : ''}`}>{task.history?.[todayKey] === 'done' ? '✓' : '·'}</span><span>{task.title}</span></li>)}</ul>{activeTasks.length > 4 && <Link className="text-link home-more" to="/daily">И ещё {activeTasks.length - 4} привычек</Link>}</section>
                  <section className="section-card home-focus"><p className="eyebrow">НЕ ЖДИ ИДЕАЛЬНОГО МОМЕНТА</p><h2>Выбери дело.<br /><span>Доведи до конца.</span></h2><p className="section-description">Характер крепнет не от обещаний, а от выполненных решений.</p><Link className="button button--red" to="/oneoff">К списку задач <span aria-hidden="true">→</span></Link></section>
                </div>
                <section className="section-card settings-panel"><div><p className="eyebrow">СОХРАНИ СВОЙ ПРОГРЕСС</p><h2>Инструменты и напоминания</h2><p className="section-description">Напоминание приходит в выбранное время. С включёнными push-уведомлениями сервер пришлёт его, даже когда вкладка закрыта (нужно установить приложение и разрешить уведомления).</p></div><div className="reminder-controls"><label>Время напоминания<input type="time" value={reminderTime} onChange={(event) => actions.setReminderTime(event.target.value)} /></label><button className="button button--red" type="button" onClick={toggleReminders}>{reminderEnabled ? 'Отключить напоминания' : 'Включить напоминание'}</button>{reminderEnabled && <button className="button button--light" type="button" onClick={sendTestNotification}>Проверить уведомление</button>}</div><BackupControls />{installPrompt && <button className="button button--light install-button" type="button" onClick={installApp}>Установить WakanDa</button>}<StateHistory /></section>
              </>
            )} />
            <Route path="/daily" element={<DailyPage />} />
            <Route path="/oneoff" element={<OneOffPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/admin" element={<AdminOnly allowed={isAdmin} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        <aside key={quoteIndex} className="quote-card" aria-label="Мотивационная цитата"><span className="quote-mark" aria-hidden="true">“</span><p>{quotes[quoteIndex].text}</p><span className="quote-caption">ДИСЦИПЛИНА · {String(quoteIndex + 1).padStart(2, '0')} / {quotes.length}</span></aside>
        <footer className="site-footer"><span>Выдержка создаёт результат.</span><span>WAKANDA 와칸다 <span aria-hidden="true">✳</span></span></footer>
      </main>
      {conflict && <SyncConflictDialog conflict={conflict} onChoose={resolveConflict} />}
      {showPasswordDialog && <PasswordChangeDialog onClose={() => setShowPasswordDialog(false)} />}
      <FeedbackViewport />
    </div>
  );
}

export default App;
