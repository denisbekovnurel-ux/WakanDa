import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { AuthBrand } from './Brand';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError('');
  }

  function switchMode(next) {
    setMode(next);
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    const username = form.username.trim();
    const password = form.password;
    if (!username || !password) {
      setError('Заполните логин и пароль');
      return;
    }
    if (mode === 'register' && password !== form.confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err) {
      setError(err?.message || 'Не удалось выполнить вход');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <AuthBrand />
        <p className="auth-tagline">Дисциплина, привычки и цели. Доступ по одобрению.</p>

        <div className="auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => switchMode('login')}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'is-active' : ''}
            onClick={() => switchMode('register')}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Логин</span>
            <input
              type="text"
              value={form.username}
              onChange={(event) => update('username', event.target.value)}
              autoComplete="username"
              placeholder="Ваш логин"
              maxLength={24}
              autoFocus
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••"
              maxLength={200}
            />
          </label>
          {mode === 'register' && (
            <label>
              <span>Повтор пароля</span>
              <input
                type="password"
                value={form.confirm}
                onChange={(event) => update('confirm', event.target.value)}
                autoComplete="new-password"
                placeholder="••••••"
                maxLength={200}
              />
            </label>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="button button--red auth-submit" type="submit" disabled={busy}>
            {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <p className="auth-note">
          {mode === 'register'
            ? 'После регистрации доступ открывает администратор. До этого вы увидите страницу ожидания.'
            : 'Нет аккаунта? Выберите «Регистрация».'}
        </p>
      </div>
      <p className="auth-footer">WAKANDA 와칸다 <span aria-hidden="true">✳</span></p>
    </div>
  );
}
