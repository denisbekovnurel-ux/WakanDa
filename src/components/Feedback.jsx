import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FeedbackContext, useFeedback } from './FeedbackContext';
import { TIMINGS } from '../config/timings';

const MAX_TOASTS = 4;

let toastSequence = 0;

/**
 * Единый слой обратной связи: блоки-уведомления вместо window.alert
 * и встроенные диалоги вместо window.confirm / window.prompt.
 */
export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback((message, options = {}) => {
    const text = String(message ?? '').trim();
    if (!text) return null;
    const id = ++toastSequence;
    const tone = options.tone || 'info';
    setToasts((current) => [...current, { id, text, tone, title: options.title || '' }].slice(-MAX_TOASTS));
    const duration = Number.isFinite(options.duration)
      ? options.duration
      : (tone === 'error' ? TIMINGS.toastErrorDurationMs : TIMINGS.toastDurationMs);
    if (duration > 0) {
      const timer = window.setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const finishDialog = useCallback((result) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  const openDialog = useCallback((options) => new Promise((resolve) => {
    // Если предыдущий диалог ещё открыт, закрываем его как отменённый.
    resolveRef.current?.(null);
    resolveRef.current = resolve;
    setDialog({ ...options });
  }), []);

  const confirm = useCallback((options = {}) => openDialog({
    kind: 'confirm',
    title: 'Подтвердить действие',
    cancelText: 'Отмена',
    confirmText: 'Подтвердить',
    ...options,
  }), [openDialog]);

  const prompt = useCallback((options = {}) => openDialog({
    kind: 'prompt',
    title: 'Введите значение',
    inputLabel: 'Значение',
    inputType: 'text',
    cancelText: 'Отмена',
    confirmText: 'Сохранить',
    ...options,
  }), [openDialog]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    resolveRef.current = null;
  }, []);

  const value = useMemo(() => ({
    notify,
    confirm,
    prompt,
    toasts,
    dismiss,
    dialog,
    finishDialog,
  }), [notify, confirm, prompt, toasts, dismiss, dialog, finishDialog]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

function ToastBlock({ toast, onClose }) {
  return (
    <div className={`feedback-toast feedback-toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <button type="button" className="feedback-toast-close" onClick={() => onClose(toast.id)} aria-label="Закрыть уведомление">×</button>
      {toast.title && <p className="feedback-toast-title">{toast.title}</p>}
      <p className="feedback-toast-text">{toast.text}</p>
    </div>
  );
}

function FeedbackDialog({ dialog, onFinish }) {
  const [value, setValue] = useState(dialog.value ?? '');
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const isPrompt = dialog.kind === 'prompt';

  useEffect(() => {
    const previous = document.activeElement;
    const target = isPrompt ? inputRef.current : confirmRef.current;
    target?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [isPrompt]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onFinish(isPrompt ? null : false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPrompt, onFinish]);

  function cancel() {
    onFinish(isPrompt ? null : false);
  }

  function submit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onFinish(trimmed);
  }

  return (
    <div className="sync-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
      <div className="sync-dialog feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title" aria-describedby="feedback-dialog-message">
        <p className="eyebrow">{isPrompt ? 'ВВОД ДАННЫХ' : 'ПОДТВЕРЖДЕНИЕ'}</p>
        <h2 id="feedback-dialog-title">{dialog.title}</h2>
        {dialog.message && <p id="feedback-dialog-message" className="section-description feedback-dialog-message">{dialog.message}</p>}
        {isPrompt ? (
          <form className="feedback-dialog-form" onSubmit={submit}>
            <label className="feedback-dialog-field">
              <span>{dialog.inputLabel}</span>
              <input
                ref={inputRef}
                type={dialog.inputType || 'text'}
                value={value}
                minLength={dialog.minLength}
                autoComplete={dialog.autoComplete || 'off'}
                onChange={(event) => setValue(event.target.value)}
                required
              />
            </label>
            <div className="feedback-dialog-actions">
              <button type="button" className="button button--light" onClick={cancel}>{dialog.cancelText}</button>
              <button type="submit" className="button button--red" disabled={!value.trim()}>{dialog.confirmText}</button>
            </div>
          </form>
        ) : (
          <div className="feedback-dialog-actions">
            <button type="button" className="button button--light" onClick={cancel}>{dialog.cancelText}</button>
            <button ref={confirmRef} type="button" className="button button--red" onClick={() => onFinish(true)}>{dialog.confirmText}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Рендерится внутри .app-shell, чтобы блоки наследовали светлую/тёмную тему.
 */
export function FeedbackViewport() {
  const { toasts, dismiss, dialog, finishDialog } = useFeedback();
  return (
    <>
      <div className="feedback-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => <ToastBlock key={toast.id} toast={toast} onClose={dismiss} />)}
      </div>
      {dialog && <FeedbackDialog dialog={dialog} onFinish={finishDialog} />}
    </>
  );
}
