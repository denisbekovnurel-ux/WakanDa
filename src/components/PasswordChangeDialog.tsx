import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiChangePassword, apiLogoutEverywhere } from '../api/authApi';
import { useAuth } from '../auth/AuthContext';
import { firstError, passwordChangeSchema } from '../validation/schemas';
import { errorMessage } from '../utils/errors';

interface DialogNote {
  ok: boolean;
  text: string;
}

/**
 * Диалог «Аккаунт»: смена пароля и завершение всех остальных сессий.
 */
export function PasswordChangeDialog({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState<DialogNote | null>(null);
  const [busy, setBusy] = useState(false);

  // Фокус внутрь диалога и закрытие по Escape — иначе клавиатурный пользователь
  // остаётся «запертым» за модальным окном.
  useEffect(() => {
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNote(null);
    const parsed = passwordChangeSchema.safeParse({ currentPassword: current, newPassword: next, confirmPassword: confirm });
    if (!parsed.success) {
      setNote({ ok: false, text: firstError(parsed) });
      return;
    }
    setBusy(true);
    try {
      await apiChangePassword(token, parsed.data.currentPassword, parsed.data.newPassword);
      setNote({ ok: true, text: 'Пароль изменён. Сессии на других устройствах завершены.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (error) {
      setNote({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoutEverywhere() {
    setBusy(true);
    setNote(null);
    try {
      const result = await apiLogoutEverywhere(token);
      setNote({ ok: true, text: `Завершено сессий: ${result.sessionsRemoved}.` });
    } catch (error) {
      setNote({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onClick={onClose}>
      <div className="sync-dialog" onClick={(event) => event.stopPropagation()} ref={dialogRef} tabIndex={-1} style={{ outline: 'none' }}>
        <p className="eyebrow">АККАУНТ</p>
        <h2 id="password-dialog-title">Пароль и сессии</h2>
        <p className="section-description">Смена пароля «разлогинивает» все остальные устройства — на этом останешься ты.</p>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label><span>Текущий пароль</span><input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
          <label><span>Новый пароль (от 6 символов)</span><input type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} /></label>
          <label><span>Повтори новый пароль</span><input type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
          {note && <p role={note.ok ? 'status' : 'alert'} style={{ color: note.ok ? '#4c9c57' : '#e0a14a', fontSize: '.72rem', margin: 0 }}>{note.text}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button button--light" type="submit" disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить новый пароль'}</button>
            <button className="text-button" type="button" onClick={handleLogoutEverywhere} disabled={busy} style={{ fontSize: '.72rem' }}>Завершить сессии на других устройствах</button>
          </div>
        </form>
        <p style={{ marginTop: 14 }}><button className="text-button" type="button" onClick={onClose}>Закрыть</button></p>
      </div>
    </div>
  );
}
