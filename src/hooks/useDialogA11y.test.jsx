// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogA11y } from './useDialogA11y';

// Общее поведение модальных окон: фон не прокручивается (важно для iOS),
// фокус входит в диалог, Tab не выходит наружу, Escape и возврат фокуса.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('modal-open');
});

function SampleDialog({ onClose, onEscape, closeOnEscape }) {
  const ref = useDialogA11y({ onClose, onEscape, closeOnEscape });
  return (
    <div className="backdrop">
      <div ref={ref} tabIndex={-1} data-testid="dialog">
        <button type="button">первая</button>
        <button type="button" data-autofocus>вторая</button>
      </div>
    </div>
  );
}

describe('useDialogA11y', () => {
  it('блокирует прокрутку фона и возвращает её после закрытия', () => {
    const { unmount } = render(<SampleDialog />);

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.classList.contains('modal-open')).toBe(true);

    unmount();

    expect(document.body.style.position).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.classList.contains('modal-open')).toBe(false);
  });

  it('фокусирует элемент с data-autofocus', () => {
    render(<SampleDialog />);
    expect(document.activeElement).toBe(screen.getByText('вторая'));
  });

  it('держит Tab внутри диалога и замыкает Shift+Tab', () => {
    render(<SampleDialog />);
    const [first, second] = screen.getAllByRole('button');

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    second.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it('Escape закрывает диалог или вызывает свой обработчик', () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    const { rerender } = render(<SampleDialog onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SampleDialog onClose={onClose} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnEscape=false оставляет обязательный диалог открытым', () => {
    const onClose = vi.fn();
    render(<SampleDialog onClose={onClose} closeOnEscape={false} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('возвращает фокус на элемент, открывший диалог', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(<SampleDialog />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
