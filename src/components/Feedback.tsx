import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { FeedbackContext, useFeedback } from './FeedbackContext';
import { TIMINGS } from '../config/timings';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useI18n } from '../i18n';
import type { DialogOptions, FeedbackContextValue, NotifyOptions, Toast, ToastTone } from '../types';

const MAX_TOASTS = 4;

let toastSequence = 0;

/**
 * Единый слой обратной связи: блоки-уведомления вместо window.alert
 * и встроенные диалоги вместо window.confirm / window.prompt.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogOptions | null>(null);
  const resolveRef = useRef<((result: unknown) => void) | null>(null);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback((message: unknown, options: NotifyOptions = {}) => {
    const text = String(message ?? '').trim();
    if (!text) return null;
    const id = ++toastSequence;
    const tone: ToastTone = options.tone || 'info';
    setToasts((current) => [...current, { id, text, tone, title: options.title || '' }].slice(-MAX_TOASTS));
    const duration = Number.isFinite(options.duration)
      ? Number(options.duration)
      : (tone === 'error' ? TIMINGS.toastErrorDurationMs : TIMINGS.toastDurationMs);
    if (duration > 0) {
      const timer = window.setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const finishDialog = useCallback((result: unknown) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  function openDialog<T>(options: DialogOptions): Promise<T> {
    return new Promise<T>((resolve) => {
      // Если предыдущий диалог ещё открыт, закрываем его как отменённый.
      resolveRef.current?.(null);
      resolveRef.current = (result: unknown) => resolve(result as T);
      setDialog({ ...options });
    });
  }

  const confirm = useCallback((options: Partial<Omit<DialogOptions, 'kind'>> = {}) => openDialog<boolean>({
    kind: 'confirm',
    title: 'Подтвердить действие',
    cancelText: 'Отмена',
    confirmText: 'Подтвердить',
    ...options,
  }), []);

  const prompt = useCallback((options: Partial<Omit<DialogOptions, 'kind'>> = {}) => openDialog<string | null>({
    kind: 'prompt',
    title: 'Введите значение',
    inputLabel: 'Значение',
    inputType: 'text',
    cancelText: 'Отмена',
    confirmText: 'Сохранить',
    ...options,
  }), []);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    resolveRef.current = null;
  }, []);

  const value = useMemo<FeedbackContextValue>(() => ({
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

function ToastBlock({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const { t } = useI18n();
  const icons: Record<ToastTone, string> = { info: 'i', success: '✓', warning: '!', error: '!' };
  return (
    <div className={`feedback-toast feedback-toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span className="toast-icon" aria-hidden="true">{icons[toast.tone]}</span>
      <div className="feedback-toast-body">
        {toast.title && <p className="feedback-toast-title">{t(toast.title)}</p>}
        <p className="feedback-toast-text">{t(toast.text)}</p>
      </div>
      <button type="button" className="feedback-toast-close" onClick={() => onClose(toast.id)} aria-label={t('Закрыть уведомление')}>×</button>
    </div>
  );
}

function FeedbackDialog({ dialog, onFinish }: { dialog: DialogOptions; onFinish: (result: unknown) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(dialog.value ?? '');
  const isPrompt = dialog.kind === 'prompt';

  function cancel() {
    onFinish(isPrompt ? null : false);
  }

  // Фокус, Escape, Tab и блокировка фона — в общем хуке диалогов.
  // data-autofocus на поле/кнопке задаёт правильную стартовую точку.
  const dialogRef = useDialogA11y({ onEscape: cancel });

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onFinish(trimmed);
  }

  return (
    <div className="sync-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
      <div
        className="sync-dialog feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        aria-describedby={dialog.message ? 'feedback-dialog-message' : undefined}
        ref={dialogRef}
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        <p className="eyebrow">{isPrompt ? t('ВВОД ДАННЫХ') : t('ПОДТВЕРЖДЕНИЕ')}</p>
        <h2 id="feedback-dialog-title">{t(dialog.title)}</h2>
        {dialog.message && <p id="feedback-dialog-message" className="section-description feedback-dialog-message">{t(dialog.message)}</p>}
        {isPrompt ? (
          <form className="feedback-dialog-form" onSubmit={submit}>
            <label className="feedback-dialog-field">
              <span>{t(dialog.inputLabel || 'Значение')}</span>
              <input
                data-autofocus
                type={dialog.inputType || 'text'}
                value={value}
                minLength={dialog.minLength}
                autoComplete={dialog.autoComplete || 'off'}
                onChange={(event) => setValue(event.target.value)}
                required
              />
            </label>
            <div className="feedback-dialog-actions">
              <button type="button" className="button button--light" onClick={cancel}>{t(dialog.cancelText || 'Отмена')}</button>
              <button type="submit" className="button button--red" disabled={!value.trim()}>{t(dialog.confirmText || 'Сохранить')}</button>
            </div>
          </form>
        ) : (
          <div className="feedback-dialog-actions">
            <button type="button" className="button button--light" onClick={cancel}>{t(dialog.cancelText || 'Отмена')}</button>
            <button data-autofocus type="button" className="button button--red" onClick={() => onFinish(true)}>{t(dialog.confirmText || 'Подтвердить')}</button>
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
