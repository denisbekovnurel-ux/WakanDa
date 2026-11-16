import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { firstError, loginSchema, registrationSchema } from '../../validation/schemas';
import { AuthBrand } from './Brand';
import { errorMessage } from '../../utils/errors';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useI18n } from '../../i18n';

type AuthMode = 'login' | 'register';
type AuthField = 'username' | 'password' | 'confirm';

export function AuthScreen() {
  const { login, register } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function update(field: AuthField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError('');
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const parsed = (mode === 'login' ? loginSchema : registrationSchema).safeParse(form);
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    const { username, password } = parsed.data;
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось выполнить вход'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <LanguageSwitcher className="lang-switch--auth" />
      <div className="auth-card">
        <AuthBrand />
        <p className="auth-tagline">{t('Дисциплина и привычки. Доступ по одобрению.')}</p>

        <div className="auth-tabs" role="tablist" aria-label={t('Вход или регистрация')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => switchMode('login')}
          >
            {t('Вход')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'is-active' : ''}
            onClick={() => switchMode('register')}
          >
            {t('Регистрация')}
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>{t('Логин')}</span>
            <input
              type="text"
              value={form.username}
              onChange={(event) => update('username', event.target.value)}
              autoComplete="username"
              placeholder={t('Ваш логин')}
              maxLength={24}
              autoFocus
            />
          </label>
          <label>
            <span>{t('Пароль')}</span>
            <span className="auth-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => update('password', event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••"
                maxLength={200}
              />
              <button
                type="button"
                className="auth-field-toggle"
                aria-label={showPassword ? t('Скрыть пароль') : t('Показать пароль')}
                title={showPassword ? t('Скрыть пароль') : t('Показать пароль')}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              ><span aria-hidden="true">{showPassword ? '🙈' : '👁'}</span></button>
            </span>
          </label>
          {mode === 'register' && (
            <label>
              <span>{t('Повтор пароля')}</span>
              <span className="auth-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirm}
                  onChange={(event) => update('confirm', event.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••"
                  maxLength={200}
                />
                <button
                  type="button"
                  className="auth-field-toggle"
                  aria-label={showPassword ? t('Скрыть пароль') : t('Показать пароль')}
                  title={showPassword ? t('Скрыть пароль') : t('Показать пароль')}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                ><span aria-hidden="true">{showPassword ? '🙈' : '👁'}</span></button>
              </span>
            </label>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="button button--red auth-submit" type="submit" disabled={busy}>
            {busy ? t('Подождите…') : mode === 'login' ? t('Войти') : t('Создать аккаунт')}
          </button>
        </form>

        <p className="auth-note">
          {mode === 'register'
            ? t('После регистрации доступ открывает администратор. До этого вы увидите страницу ожидания.')
            : t('Нет аккаунта? Выберите «Регистрация».')}
        </p>
      </div>
      <p className="auth-footer">WAKANDA <span aria-hidden="true">✳</span></p>
    </div>
  );
}
