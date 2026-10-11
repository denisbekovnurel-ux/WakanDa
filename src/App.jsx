import { useEffect, useState } from 'react';
import { useToday } from './hooks/useToday';
import { usePrefersDark } from './hooks/usePrefersDark';
import { useAppStore } from './store/AppStore';
import { useReminders } from './hooks/useReminders';
import { pluralize } from './utils/pluralize';
import { HabitManager } from './components/HabitManager';
import { BackupControls } from './components/BackupControls';
import { StateHistory } from './components/StateHistory';
import { SyncConflictDialog } from './components/SyncConflictDialog';
import { OneOffList } from './components/OneOffList';
import { MonthGrid } from './components/MonthGrid';
import { GoalCard } from './components/GoalCard/GoalCard';
import { StatsPage } from './components/Stats/StatsPage';
import { NotesPanel } from './components/NotesPanel/NotesPanel';
import { getBadges } from './utils/badges';
import { useAuth } from './auth/AuthContext';
import { AdminPanel } from './components/Admin/AdminPanel';
import quotes from './data/quotes.json';
import './App.css';

const pages = {
  home: { label: 'HOME 홈', en: 'HOME', ko: '홈', eyebrow: 'ПЛАН НА ДЕЙСТВИЕ', title: 'Точка старта', description: 'Порядок в делах. Холодная голова. Каждый день — шаг вперёд.', image: 'home-bg.jpg' },
  daily: { label: 'DAILY 매일', en: 'DAILY', ko: '매일', eyebrow: 'РИТМ И ПОВТОРЕНИЕ', title: 'Ежедневный режим', description: 'Отмечай сделанное. Месяц покажет, насколько крепка твоя дисциплина.', image: 'daily-bg.jpg' },
  oneoff: { label: 'ONE-SHOT 단발', en: 'ONE-SHOT', ko: '단발', eyebrow: 'ДЕЛО ДОЛЖНО БЫТЬ ЗАКРЫТО', title: 'Разовые задачи', description: 'Список конкретных дел. Выполнил — закрыл. История остаётся в архиве.', image: 'oneoff-bg.jpg' },
  goals: { label: 'GOALS 목표', en: 'GOALS', ko: '목표', eyebrow: 'БЕЗ ОТСТУПЛЕНИЙ', title: 'Планка выше', description: 'Зафиксируй цель. Выдержи темп. Забери результат.', image: 'goals-bg.jpg' },
  stats: { label: 'STATS 통계', en: 'STATS', ko: '통계', eyebrow: 'ЦИФРЫ НЕ ВРУТ', title: 'Статистика', description: 'Серия, ритм месяца и годовая карта — виден весь путь целиком.', image: 'stats-bg.jpg' },
  admin: { label: 'ADMIN 관리자', en: 'ADMIN', ko: '관리자', eyebrow: 'УПРАВЛЕНИЕ ДОСТУПОМ', title: 'Админ-панель', description: 'Одобряй заявки, следи за активностью и управляй доступом пользователей.', image: 'admin-bg.jpg' },
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

function getPageFromHash() {
  const key = window.location.hash.slice(1);
  return Object.hasOwn(pages, key) ? key : 'home';
}

function App() {
  const { state, actions, conflict, resolveConflict } = useAppStore();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { tasks, oneOffTasks, goals, theme, reminderTime, reminderEnabled } = state;
  const prefersDark = usePrefersDark();
  // «system» — следуем системной теме, иначе берём явный выбор пользователя.
  const effectiveTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const themeNames = { system: 'как в системе', light: 'светлая', dark: 'тёмная' };
  const themeIcons = { system: '◐', light: '☼', dark: '☾' };
  const [page, setPage] = useState(getPageFromHash);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * quotes.length));
  const [goalForm, setGoalForm] = useState({ title: '', target: '', unit: '', dailyRate: '' });
  const { today, todayKey } = useToday();
  const activeTasks = tasks.filter((task) => !task.archived);
  const completedToday = activeTasks.filter((task) => task.history?.[todayKey] === 'done').length;
  const pendingHabits = Math.max(0, activeTasks.filter((task) => (!task.schedule || task.schedule.includes(today.getDay())) && task.history?.[todayKey] !== 'done').length);
  const badges = getBadges(state);
  const unlockedCount = badges.filter((badge) => badge.unlocked).length;

  const { enable: requestReminderPermission } = useReminders({ enabled: reminderEnabled, reminderTime, pendingHabits, todayKey });

  useEffect(() => {
    function syncPage() { setPage(getPageFromHash()); }
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    function captureInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % quotes.length);
    }, 20000);
    return () => window.clearInterval(interval);
  }, []);

  function handleAddGoal(event) {
    event.preventDefault();
    const { title, target, unit, dailyRate } = goalForm;
    if (!title.trim() || Number(target) <= 0 || Number(dailyRate) <= 0) return;
    actions.addGoal({ title: title.trim(), unit: unit.trim() || 'шт', target: Number(target), dailyRate: Number(dailyRate) }, todayKey);
    setGoalForm({ title: '', target: '', unit: '', dailyRate: '' });
  }

  function handleDeleteGoal(id, title) {
    if (!window.confirm(`Удалить цель «${title}» и всю её историю прогресса?`)) return;
    actions.deleteGoal(id);
  }

  async function toggleReminders() {
    if (reminderEnabled) {
      actions.setReminderEnabled(false);
      return;
    }
    const granted = await requestReminderPermission();
    if (granted) actions.setReminderEnabled(true);
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  const currentPage = pages[page];

  return (
    <div className={`app-shell ${effectiveTheme === 'light' ? 'theme-light' : ''}`}>
      <header className="topbar">
        <a className="brand" href="#home" aria-label="WakanDa 와칸다 — на главную"><span className="brand-mark" aria-hidden="true">W</span><span>WakanDa<span className="brand-period">.</span></span><span className="brand-ko">와칸다</span></a>
        <nav className="main-nav" aria-label="Основная навигация">
          {Object.entries(pages).filter(([key]) => key !== 'admin' || isAdmin).map(([key, item]) => <a key={key} href={`#${key}`} className={page === key ? 'is-active' : ''} aria-current={page === key ? 'page' : undefined}>{item.label}</a>)}
        </nav>
        <span className="pending-reminder" aria-live="polite">{pendingHabits ? `ОСТАЛОСЬ ОТМЕТИТЬ ${pendingHabits}` : 'ВСЁ ОТМЕЧЕНО'}</span>
        <div className="user-menu">
          <span className="user-chip" title={user?.username}>{user?.username}<span className="user-chip-role">{isAdmin ? 'ADMIN' : 'USER'}</span></span>
          <button className="logout-button" type="button" onClick={logout} title="Выйти из аккаунта">Выйти</button>
        </div>
        <button className="theme-toggle" type="button" onClick={() => actions.setTheme(nextTheme)} aria-label={`Тема: ${themeNames[theme]}. Переключить на «${themeNames[nextTheme]}»`} title={`Тема: ${themeNames[theme]}`}>{themeIcons[theme]}</button>
        <time className="today-date" dateTime={todayKey}>{dateFormatter.format(today)}</time>
      </header>

      <main className="page-content">
        <section className={`page-hero page-hero--${page}`} style={{ '--page-photo': `url('/images/${currentPage.image}')` }} aria-labelledby="page-title">
          <div className="page-hero-copy"><p className="eyebrow">{currentPage.eyebrow}</p><h1 id="page-title">{currentPage.title}</h1><p className="page-hero-description">{currentPage.description}</p></div>
          <div className="photo-slot" role="img" aria-label={`Место для фонового фото страницы ${currentPage.en}`}><span className="photo-slot-cross" aria-hidden="true">✳</span><span className="photo-slot-label">IMAGE SLOT <span>public/images/{currentPage.image}</span></span></div>
          <div className="hero-watermark" aria-hidden="true">{currentPage.ko}</div>
        </section>

        {page === 'home' && (
          <>
            <section className="stats-grid" aria-label="Сводка">
              <article className="stat-card"><span className="stat-icon" aria-hidden="true">✦</span><div><p className="stat-label">Выполнено сегодня</p><p className="stat-value">{completedToday}<span> / {activeTasks.length}</span></p><p className="stat-foot">{pluralize(completedToday, 'привычка выполнена', 'привычки выполнены', 'привычек выполнено')}</p></div></article>
              <article className="stat-card stat-card--red"><span className="stat-icon" aria-hidden="true">⚔</span><div><p className="stat-label">Разовые задачи</p><p className="stat-value">{oneOffTasks.filter((task) => !task.done).length}<span> в работе</span></p><p className="stat-foot">{oneOffTasks.filter((task) => task.done).length} закрыто и в архиве</p></div></article>
              <article className="stat-card stat-card--violet"><span className="stat-icon" aria-hidden="true">◎</span><div><p className="stat-label">Цели</p><p className="stat-value">{goals.length}<span> {pluralize(goals.length, 'цель', 'цели', 'целей')}</span></p><p className="stat-foot">держи курс на своё</p></div></article>
              <article className="stat-card stat-card--gold"><span className="stat-icon" aria-hidden="true">🏅</span><div><p className="stat-label">Награды</p><p className="stat-value">{unlockedCount}<span> / {badges.length}</span></p><p className="stat-foot"><a className="text-link" href="#stats">смотреть достижения</a></p></div></article>
            </section>
            <div className="home-grid">
              <section className="section-card home-preview"><div className="section-heading"><div><p className="eyebrow">ДЕНЬ ЗА ДНЁМ</p><h2>Твои привычки</h2></div><a className="text-link" href="#daily">Открыть месяц <span aria-hidden="true">↗</span></a></div><p className="section-description">{activeTasks.length ? `В списке ${activeTasks.length} ${pluralize(activeTasks.length, 'привычка', 'привычки', 'привычек')}. Продолжай держать ритм.` : 'Добавь привычку и начни собирать свою серию.'}</p><ul className="home-habit-list">{activeTasks.slice(0, 4).map((task) => <li key={task.id}><span className={`home-habit-mark ${task.history?.[todayKey] === 'done' ? 'is-done' : ''}`}>{task.history?.[todayKey] === 'done' ? '✓' : '·'}</span><span>{task.title}</span></li>)}</ul>{activeTasks.length > 4 && <a className="text-link home-more" href="#daily">И ещё {activeTasks.length - 4} привычек</a>}</section>
              <section className="section-card home-focus"><p className="eyebrow">НЕ ЖДИ ИДЕАЛЬНОГО МОМЕНТА</p><h2>Выбери дело.<br /><span>Доведи до конца.</span></h2><p className="section-description">Характер крепнет не от обещаний, а от выполненных решений.</p><a className="button button--red" href="#oneoff">К списку задач <span aria-hidden="true">→</span></a></section>
            </div>
            <section className="section-card settings-panel"><div><p className="eyebrow">СОХРАНИ СВОЙ ПРОГРЕСС</p><h2>Инструменты и напоминания</h2><p className="section-description">Уведомление браузера приходит в выбранное время, пока сайт открыт. В установленном PWA на Android возможны фоновые напоминания через periodicSync.</p></div><div className="reminder-controls"><label>Время напоминания<input type="time" value={reminderTime} onChange={(event) => actions.setReminderTime(event.target.value)} /></label><button className="button button--red" type="button" onClick={toggleReminders}>{reminderEnabled ? 'Отключить напоминания' : 'Включить напоминание'}</button></div><BackupControls />{installPrompt && <button className="button button--light install-button" type="button" onClick={installApp}>Установить WakanDa</button>}<StateHistory /></section>
          </>
        )}

        {page === 'daily' && <section className="section-card page-section"><MonthGrid tasks={activeTasks} /><NotesPanel /><div className="daily-task-manager"><div className="section-heading"><div><p className="eyebrow">ДИСЦИПЛИНА КАЖДЫЙ ДЕНЬ</p><h2>Управление привычками</h2></div><span className="section-count">{activeTasks.length} {pluralize(activeTasks.length, 'привычка', 'привычки', 'привычек')}</span></div><HabitManager tasks={tasks} today={today} /></div></section>}

        {page === 'oneoff' && <section className="section-card page-section"><div className="section-heading"><div><p className="eyebrow">ОДИН РАЗ — НО ДО КОНЦА</p><h2>Список действий</h2></div><span className="section-count">{oneOffTasks.filter((task) => !task.done).length} открыто</span></div><p className="section-description">Небольшие дела тоже требуют решения. Закрывай их одно за другим.</p><OneOffList tasks={oneOffTasks} todayKey={todayKey} /></section>}

        {page === 'goals' && <section className="section-card page-section goals-page"><div className="section-heading"><div><p className="eyebrow">ПЛАН. НАГРУЗКА. РЕЗУЛЬТАТ.</p><h2>Карта целей</h2></div><span className="section-count">{goals.length} {pluralize(goals.length, 'цель', 'цели', 'целей')}</span></div><p className="section-description">Назови цель так, чтобы она задавала планку. Зафиксируй норму и ежедневно добавляй прогресс.</p><form className="goal-create-form" onSubmit={handleAddGoal}><label className="sr-only" htmlFor="goal-title">Название цели</label><input id="goal-title" type="text" placeholder="Например, пройти 1000 км" value={goalForm.title} onChange={(event) => setGoalForm({ ...goalForm, title: event.target.value })} required maxLength="80" /><div className="goal-fields"><label><span>Общий объём</span><input type="number" min="1" placeholder="1000" aria-label="Общий объём цели" value={goalForm.target} onChange={(event) => setGoalForm({ ...goalForm, target: event.target.value })} required /></label><label><span>Единица</span><input type="text" placeholder="км" aria-label="Единица измерения" value={goalForm.unit} onChange={(event) => setGoalForm({ ...goalForm, unit: event.target.value })} maxLength="12" /></label><label><span>Норма в день</span><input type="number" min="1" placeholder="5" aria-label="Ежедневная норма" value={goalForm.dailyRate} onChange={(event) => setGoalForm({ ...goalForm, dailyRate: event.target.value })} required /></label></div><button className="button button--red" type="submit"><span aria-hidden="true">＋</span> Зафиксировать цель</button></form><ul className="goal-list" aria-label="Список целей">{goals.length === 0 ? <li className="empty-state"><span aria-hidden="true">◎</span><p>Поставь цель. Задай норму. Начни выполнять.</p></li> : goals.map((goal) => <GoalCard key={goal.id} goal={goal} onDelete={() => handleDeleteGoal(goal.id, goal.title)} />)}</ul></section>}

        {page === 'stats' && <StatsPage />}

        {page === 'admin' && (isAdmin ? <AdminPanel /> : <section className="section-card page-section"><p className="section-description">Раздел доступен только администратору.</p></section>)}

        <aside key={quoteIndex} className="quote-card" aria-label="Мотивационная цитата"><span className="quote-mark" aria-hidden="true">“</span><p>{quotes[quoteIndex].text}</p><span className="quote-caption">ДИСЦИПЛИНА · {String(quoteIndex + 1).padStart(2, '0')} / {quotes.length}</span></aside>
        <footer className="site-footer"><span>Выдержка создаёт результат.</span><span>WAKANDA 와칸다 <span aria-hidden="true">✳</span></span></footer>
      </main>
      {conflict && <SyncConflictDialog conflict={conflict} onChoose={resolveConflict} />}
    </div>
  );
}

export default App;
