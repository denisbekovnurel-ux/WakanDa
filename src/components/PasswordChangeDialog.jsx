import { useState } from 'react';
import { apiChangePassword, apiLogoutEverywhere } from '../api/authApi';
import { useAuth } from '../auth/AuthContext';

/**
 * Диалог «Аккаунт»: смена пароля и завершение всех остальных сессий.
 */
export function PasswordChangeDialog({ onClose }) {
  const { token } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setNote(null);
    if (next.length < 6) {
      setNote({ ok: false, text: 'Новый пароль должен быть не короче 6 символов.' });
      return;
    }
    if (next !== confirm) {
      setNote({ ok: false, text: 'Пароли не совпадают.' });
      return;
    }
    setBusy(true);
    try {
      await apiChangePassword(token, current, next);
      setNote({ ok: true, text: 'Пароль изменён. Сессии на других устройствах завершены.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (error) {
      setNote({ ok: false, text: error.message });
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
      setNote({ ok: false, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onClick={onClose}>
      <div className="sync-dialog" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">АККАУНТ</p>
        <h2 id="password-dialog-title">Пароль и сессии</h2>
        <p className="section-description">Смена пароля «разлогинивает» все остальные устройства — на этом останешься ты.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label><span>Текущий пароль</span><input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
          <label><span>Новый пароль (от 6 символов)</span><input type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} /></label>
          <label><span>Повтори новый пароль</span><input type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
          {note && <p style={{ color: note.ok ? '#4c9c57' : '#e0a14a', fontSize: '.72rem', margin: 0 }}>{note.text}</p>}
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