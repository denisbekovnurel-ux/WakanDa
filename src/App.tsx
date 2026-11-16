import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Link } from './components/RouteLink';
import { Topbar } from './components/Shell/Topbar';
import { isPageKey, pages } from './components/Shell/navigation';
import { useToday } from './hooks/TodayContext';
import { useAmbience } from './hooks/useAmbience';
import { useScrollReveal } from './hooks/useScrollReveal';
import { useAppStore } from './store/AppStore';
import { selectActiveHabits } from './store/selectors';
import { useReminders } from './hooks/useReminders';
import { pluralize } from './utils/pluralize';
import { isPaused, STATUS } from './utils/calc';
import { TIMINGS } from './config/timings';
import { BackupControls } from './components/BackupControls';
import { TelegramPanel } from './components/TelegramPanel';
import { RemindersPanel } from './components/RemindersPanel';
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
import { InstallBanner } from './components/Install/InstallBanner';
import { InstallPanel } from './components/Install/InstallPanel';
import { ProgressRing } from './components/ProgressRing/ProgressRing';
import { AnimatedNumber } from './components/AnimatedNumber';
import { useI18n } from './i18n';
import quotes from './data/quotes.json';
import { errorMessage } from './utils/errors';
import './App.css';

// Ленивые разделы: попадают в бандл только когда пользователь их открыл.
// Главная остаётся в основном чанке — это точка входа после входа в аккаунт.
const DailyPage = lazy(() => import('./pages/DailyPage'));
const OneOffPage = lazy(() => import('./pages/OneOffPage'));
const StatsPage = lazy(() => import('./components/Stats/StatsPage').then((module) => ({ default: module.StatsPage })));
const AdminPanel = lazy(() => import('./components/Admin/AdminPanel').then((module) => ({ default: module.AdminPanel })));

function AdminOnly({ allowed }: { allowed: boolean }) {
  const { t } = useI18n();
  if (!allowed) {
    return <section className="section-card page-section"><p className="section-description">{t('Раздел доступен только администратору.')}</p></section>;
  }
  return <AdminPanel />;
}

function App() {
  const { state, actions, conflict, resolveConflict, syncStatus } = useAppStore();
  const { user, token } = useAuth();
  const { notify } = useFeedback();
  const { t, locale } = useI18n();
  const isAdmin = user?.role === 'admin';
  const { oneOffTasks, theme, reminderTimes, reminderEnabled } = state;
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const themeNames = { light: t('светлая'), dark: t('тёмная') };
  const themeIcons = { light: '☼', dark: '☾' };
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * quotes.length));
  const [isBooting, setIsBooting] = useState(true);
  const routeSettled = useRef(false);
  const { today, todayKey } = useToday();
  useAmbience();
  useScrollReveal();
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
  const progressPercent = activeTasks.length ? Math.round((completedToday / activeTasks.length) * 100) : 0;
  const syncLabels: Record<string, string> = {
    connecting: t('Подключение…'),
    saving: t('Сохраняем…'),
    saved: t('Сохранено'),
    offline: t('Офлайн-кэш'),
  };
  const syncLabel = syncStatus ? syncLabels[syncStatus] ?? '' : '';

  const { enable: requestReminderPermission } = useReminders({ enabled: reminderEnabled, reminderTimes, oneOffTasks, pendingHabits, todayKey });

  // Заголовок и описание вкладки тоже часть интерфейса.
  useEffect(() => {
    const title = t('WakanDa — дисциплина и привычки');
    document.title = title;
    const values: Array<[string, string]> = [
      ['meta[name="description"]', t('WakanDa — дисциплина, привычки и разовые задачи в одном месте.')],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', t('Привычки и разовые задачи. Каждый день — шаг вперёд.')],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', t('Привычки и разовые задачи. Каждый день — шаг вперёд.')],
    ];
    for (const [selector, content] of values) {
      document.querySelector(selector)?.setAttribute('content', content);
    }
  }, [locale, t]);

  // Цвет статус-бара iOS/Android и фона PWA следует за выбранной темой.
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#fcf8fc' : '#09080c');
  }, [theme]);

  // При переходе между страницами остаёмся наверху — иначе длинная главная
  // «передаёт» свою прокрутку короткому разделу. useLayoutEffect + behavior:
  // 'instant' гарантируют, что прокрутка сбросится до снятия снимка
  // view-transition и страница не «прыгнет» вверх уже после начала анимации.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Дублируем напрямую: часть окружений (и jsdom в тестах) не реализует
    // scrollTo, но обязана сбрасывать позицию документа.
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    // Волна появления карточек нужна только при первом открытии приложения.
    // При смене раздела её отключаем до снятия снимка view-transition.
    if (routeSettled.current) setIsBooting(false);
    else routeSettled.current = true;
  }, [location.pathname]);

  // Страховка: даже если пользователь остался на первом экране, снимаем
  // boot-класс после завершения вступительных анимаций.
  useEffect(() => {
    const timer = window.setTimeout(() => setIsBooting(false), 1400);
    return () => window.clearTimeout(timer);
  }, []);

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

  return (
    <div className={`app-shell ${theme === 'light' ? 'theme-light' : ''} ${isBooting ? 'is-booting' : ''}`}>
      <div className="scroll-progress" aria-hidden="true" />
      <div className="cursor-glow" aria-hidden="true" />
      <div className="cosmos" aria-hidden="true" />
      <div className="tech-frame" aria-hidden="true" />
      <a className="skip-link" href="#main-content">{t('Перейти к содержимому')}</a>
      <Topbar
        page={page}
        pendingHabits={pendingHabits}
        syncLabel={syncLabel}
        syncStatus={syncStatus ?? ''}
        theme={theme}
        nextTheme={nextTheme}
        themeNames={themeNames}
        themeIcons={themeIcons}
        today={today}
        todayKey={todayKey}
        onToggleTheme={() => actions.setTheme(nextTheme)}
        onOpenPassword={() => setShowPasswordDialog(true)}
      />

      <main className="page-content" id="main-content" tabIndex={-1}>
        <section className={`page-hero page-hero--${page ?? 'home'}`} style={{ '--page-photo': `url('/images/${currentPage.image}')` } as CSSProperties} aria-labelledby="page-title">
          <div className="page-hero-copy"><p className="eyebrow">{t(currentPage.eyebrow)}</p><h1 id="page-title">{t(currentPage.title)}</h1><p className="page-hero-description">{t(currentPage.description)}</p></div>
          <aside className="hero-aside" aria-label={t('Прогресс дня')}>
            <ProgressRing percent={progressPercent} size={86} ariaLabel={t('Выполнено сегодня')} />
            <span className="hero-aside-label">{t('ПРОГРЕСС ДНЯ')}</span>
            <span className="hero-aside-value">{t('{done} из {total}', { done: completedToday, total: activeTasks.length })}</span>
          </aside>
          <div className="hero-watermark" aria-hidden="true">{currentPage.index}</div>
        </section>

        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={(
              <>
                <section className="stats-grid" data-reveal aria-label={t('Сводка')}>
                  <article className="stat-card"><span className="stat-icon" aria-hidden="true">✦</span><div><p className="stat-label">{t('Выполнено сегодня')}</p><p className="stat-value"><AnimatedNumber value={completedToday} /><span> / {activeTasks.length}</span></p><p className="stat-foot">{pluralize(completedToday, 'привычка выполнена', 'привычки выполнены', 'привычек выполнено')}</p></div></article>
                  <article className="stat-card stat-card--red"><span className="stat-icon" aria-hidden="true">⚔</span><div><p className="stat-label">{t('Разовые задачи')}</p><p className="stat-value"><AnimatedNumber value={oneOffTasks.filter((task) => !task.done).length} /><span> {t('в работе')}</span></p><p className="stat-foot">{t('{count} закрыто и в архиве', { count: oneOffTasks.filter((task) => task.done).length })}</p></div></article>
                  <article className="stat-card stat-card--gold"><span className="stat-icon" aria-hidden="true">🏅</span><div><p className="stat-label">{t('Награды')}</p><p className="stat-value"><AnimatedNumber value={unlockedCount} /><span> / {badges.length}</span></p><p className="stat-foot"><Link className="text-link" to="/stats">{t('смотреть достижения')}</Link></p></div></article>
                </section>
                <div className="home-grid" data-reveal>
                  <section className="section-card home-preview">
                    <div className="section-heading"><div><p className="eyebrow">{t('ДЕНЬ ЗА ДНЁМ')}</p><h2>{t('Твои привычки')}</h2></div><Link className="text-link" to="/daily">{t('Открыть месяц')} <span aria-hidden="true">↗</span></Link></div>
                    <p className="section-description">{activeTasks.length ? t('В списке {count} {unit}. Продолжай держать ритм.', { count: activeTasks.length, unit: pluralize(activeTasks.length, 'привычка', 'привычки', 'привычек') }) : t('Добавь привычку и начни собирать свою серию.')}</p>
                    {activeTasks.length === 0 ? (
                      <div className="home-empty">
                        <span aria-hidden="true">✦</span>
                        <p>{t('Здесь появится твой первый шаг.')}</p>
                        <Link className="text-link" to="/daily">{t('Добавить привычку')} <span aria-hidden="true">→</span></Link>
                      </div>
                    ) : (
                      <ul className="home-habit-list">
                        {activeTasks.slice(0, 4).map((task) => {
                          const done = task.history?.[todayKey] === STATUS.DONE;
                          return (
                            <li key={task.id} className={done ? 'is-done' : ''}>
                              <button
                                type="button"
                                className={`home-habit-toggle ${done ? 'is-done' : ''}`}
                                aria-pressed={done}
                                aria-label={done ? t('Снять отметку с «{title}»', { title: task.title }) : t('Отметить «{title}» выполненной', { title: task.title })}
                                onClick={() => actions.setHabitStatus?.(task.id, todayKey, done ? STATUS.EMPTY : STATUS.DONE)}
                              ><span aria-hidden="true">✓</span></button>
                              <span className="home-habit-title">{task.title}</span>
                              <span className="home-habit-streak">{done ? t('сделано') : t('сегодня')}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {activeTasks.length > 4 && <Link className="text-link home-more" to="/daily">{t('И ещё {count} привычек', { count: activeTasks.length - 4 })}</Link>}
                  </section>
                  <section className="section-card home-focus"><p className="eyebrow">{t('НЕ ЖДИ ИДЕАЛЬНОГО МОМЕНТА')}</p><h2>{t('Выбери дело.')}<br /><span>{t('Доведи до конца.')}</span></h2><p className="section-description">{t('Характер крепнет не от обещаний, а от выполненных решений.')}</p><Link className="button button--red" to="/oneoff">{t('К списку задач')} <span aria-hidden="true">→</span></Link></section>
                </div>
                <section className="section-card settings-panel" data-reveal><div><p className="eyebrow">{t('СОХРАНИ СВОЙ ПРОГРЕСС')}</p><h2>{t('Инструменты и напоминания')}</h2><p className="section-description">{t('Напоминания приходят до трёх раз в день — выбери удобное время. С включёнными push-уведомлениями сервер пришлёт их, даже когда вкладка закрыта.')}</p></div><div className="reminder-controls">{reminderTimes.map((time, index) => <label key={index}>{t('Время {n}', { n: index + 1 })}<input type="time" value={time} onChange={(event) => actions.setReminderTime(index, event.target.value)} /></label>)}<button className="button button--red" type="button" onClick={toggleReminders}>{reminderEnabled ? t('Отключить напоминания') : t('Включить напоминание')}</button>{reminderEnabled && <button className="button button--light" type="button" onClick={sendTestNotification}>{t('Проверить уведомление')}</button>}</div><TelegramPanel /><RemindersPanel /><BackupControls /><StateHistory /></section>
                <section className="section-card install-card" data-reveal><InstallPanel /></section>
              </>
            )} />
            <Route path="/daily" element={<DailyPage />} />
            <Route path="/oneoff" element={<OneOffPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/admin" element={<AdminOnly allowed={isAdmin} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        <aside key={quoteIndex} className="quote-card" data-reveal aria-label={t('Мотивационная цитата')}><span className="quote-mark" aria-hidden="true">“</span><p>{t(quotes[quoteIndex].text)}</p><span className="quote-caption">{t('ДИСЦИПЛИНА')} · {String(quoteIndex + 1).padStart(2, '0')} / {quotes.length}</span></aside>
        <footer className="site-footer" data-reveal><span>{t('Выдержка создаёт результат.')}</span><span>WAKANDA <span aria-hidden="true">✳</span></span></footer>
      </main>
      {conflict && <SyncConflictDialog conflict={conflict} onChoose={resolveConflict} />}
      {showPasswordDialog && <PasswordChangeDialog onClose={() => setShowPasswordDialog(false)} />}
      <InstallBanner />
      <FeedbackViewport />
    </div>
  );
}

export default App;
