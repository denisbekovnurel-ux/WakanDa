// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PwaInstallProvider } from './pwa/PwaInstallProvider';

// Роутер: главная остаётся в основном чанке, остальные разделы — ленивые.
// Здесь проверяем навигацию и доступ, сами разделы подменены заглушками
// (у них есть собственные компонентные тесты).

const mocks = vi.hoisted(() => ({
  store: null,
  auth: null,
  feedback: null,
}));

vi.mock('./store/AppStore', () => ({ useAppStore: () => mocks.store }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('./components/FeedbackContext', () => ({ useFeedback: () => mocks.feedback }));
vi.mock('./components/Feedback', () => ({ FeedbackViewport: () => null }));
vi.mock('./hooks/TodayContext', () => ({ useToday: () => ({ today: new Date(2026, 9, 26, 12), todayKey: '2026-10-26' }) }));
vi.mock('./hooks/useReminders', () => ({ useReminders: () => ({ enable: vi.fn(async () => true) }) }));
vi.mock('./utils/push', () => ({ ensurePushSubscription: vi.fn(async () => ({ ok: true })), disablePushSubscription: vi.fn() }));
vi.mock('./api/pushApi', () => ({ sendTestPush: vi.fn() }));
vi.mock('./components/BackupControls', () => ({ BackupControls: () => <div data-testid="backup-controls" /> }));
vi.mock('./components/StateHistory', () => ({ StateHistory: () => <div data-testid="state-history" /> }));
vi.mock('./components/SyncConflictDialog', () => ({ SyncConflictDialog: () => null }));
vi.mock('./components/PasswordChangeDialog', () => ({ PasswordChangeDialog: () => null }));
vi.mock('./pages/DailyPage', () => ({ default: () => <div>daily-page</div> }));
vi.mock('./pages/OneOffPage', () => ({ default: () => <div>oneoff-page</div> }));
vi.mock('./components/Stats/StatsPage', () => ({ StatsPage: () => <div>stats-page</div> }));
vi.mock('./components/Admin/AdminPanel', () => ({ AdminPanel: () => <div>admin-page</div> }));

function adminUser(overrides = {}) {
  return { id: 'u1', username: 'waka_admin', role: 'admin', status: 'approved', ...overrides };
}

beforeEach(() => {
  mocks.store = {
    state: {
      version: 2,
      tasks: [],
      oneOffTasks: [],
      notes: {},
      theme: 'dark',
      reminderTimes: ['09:00', '14:00', '20:00'],
      reminderEnabled: false,
    },
    actions: { setTheme: vi.fn(), setReminderTime: vi.fn(), setReminderEnabled: vi.fn() },
    conflict: null,
    resolveConflict: vi.fn(),
  };
  mocks.auth = { user: adminUser(), token: 'token-1', logout: vi.fn() };
  mocks.feedback = { notify: vi.fn() };
});

afterEach(() => cleanup());

function renderAt(path) {
  return render(
    <PwaInstallProvider>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </PwaInstallProvider>
  );
}

describe('App routing', () => {
  it('главная живёт в основном чанке и показывает сводку', () => {
    renderAt('/');

    expect(screen.getByRole('heading', { name: 'Точка старта' })).toBeTruthy();
    expect(screen.getByLabelText('Сводка')).toBeTruthy();
    expect(screen.getByText('ВСЁ ОТМЕЧЕНО')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'HOME' }).getAttribute('aria-current')).toBe('page');
  });

  it('переходит на ленивый раздел по клику в навигации', async () => {
    renderAt('/');

    fireEvent.click(screen.getByRole('link', { name: 'DAILY' }));

    await screen.findByText('daily-page');
    expect(screen.getByRole('heading', { name: 'Ежедневный режим' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'DAILY' }).getAttribute('aria-current')).toBe('page');
    // Индикатор «всё отмечено» — только на главной.
    expect(screen.queryByText('ВСЁ ОТМЕЧЕНО')).toBeNull();
  });

  it('открывает разделы по прямым адресам', async () => {
    const { unmount } = renderAt('/oneoff');
    await screen.findByText('oneoff-page');
    expect(screen.getByRole('heading', { name: 'Разовые задачи' })).toBeTruthy();
    unmount();

    renderAt('/stats');
    await screen.findByText('stats-page');
    expect(screen.getByRole('heading', { name: 'Статистика' })).toBeTruthy();
  });

  it('ведёт на дневную страницу по ссылке с главной', async () => {
    renderAt('/');

    fireEvent.click(screen.getByRole('link', { name: /Открыть месяц/ }));

    await screen.findByText('daily-page');
    expect(screen.getByRole('heading', { name: 'Ежедневный режим' })).toBeTruthy();
  });

  it('админ видит раздел управления', async () => {
    renderAt('/admin');

    await screen.findByText('admin-page');
    expect(screen.getByRole('link', { name: 'ADMIN' })).toBeTruthy();
  });

  it('обычный пользователь не видит ссылку и раздел админа', () => {
    mocks.auth = { ...mocks.auth, user: adminUser({ role: 'user', username: 'ivan' }) };
    renderAt('/admin');

    expect(screen.queryByRole('link', { name: 'ADMIN' })).toBeNull();
    expect(screen.getByText('Раздел доступен только администратору.')).toBeTruthy();
    expect(screen.queryByText('admin-page')).toBeNull();
  });

  it('неизвестный адрес возвращает на главную', async () => {
    renderAt('/no-such-page');

    await screen.findByRole('heading', { name: 'Точка старта' });
    expect(screen.getByLabelText('Сводка')).toBeTruthy();
  });

  it('счётчик в шапке считает невыполненные привычки на сегодня', () => {
    mocks.store.state.tasks = [
      { id: 'h1', title: 'Зарядка', createdAt: '2026-01-01', schedule: [0, 1, 2, 3, 4, 5, 6], history: {}, pauseRanges: [] },
      { id: 'h2', title: 'Чтение', createdAt: '2026-01-01', schedule: [0, 1, 2, 3, 4, 5, 6], history: { '2026-10-26': 'done' }, pauseRanges: [] },
    ];
    renderAt('/');

    expect(screen.getByText('ОСТАЛОСЬ ОТМЕТИТЬ 1')).toBeTruthy();
  });

  it('после перехода прокрутка возвращается наверх', async () => {
    document.documentElement.scrollTop = 640;
    renderAt('/');

    fireEvent.click(screen.getByRole('link', { name: 'STATS' }));
    await screen.findByText('stats-page');

    await waitFor(() => expect(document.documentElement.scrollTop).toBe(0));
  });

  it('переключает только две темы — тёмную и светлую', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /Тема: тёмная/ }));
    expect(mocks.store.actions.setTheme).toHaveBeenCalledWith('light');

    cleanup();
    mocks.store.state.theme = 'light';
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /Тема: светлая/ }));
    expect(mocks.store.actions.setTheme).toHaveBeenCalledWith('dark');
  });
});
