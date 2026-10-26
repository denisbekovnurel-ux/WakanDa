// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider, FeedbackViewport } from './Feedback.jsx';
import { useFeedback } from './FeedbackContext';
import { TIMINGS } from '../config/timings';

// Уведомления и встроенные диалоги заменяют window.alert/confirm/prompt.
// Здесь проверяем именно поведение, на которое опираются все экраны.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness() {
  const { notify, confirm, prompt } = useFeedback();
  const [result, setResult] = useState('ещё нет');
  return (
    <>
      <button type="button" onClick={() => notify('Привычка сохранена', { tone: 'success', title: 'Готово' })}>показать-успех</button>
      <button type="button" onClick={() => notify('Сервер недоступен', { tone: 'error' })}>показать-ошибку</button>
      <button type="button" onClick={() => notify('   ')}>показать-пустое</button>
      <button type="button" onClick={() => notify('Раз', { duration: 10_000 })}>долгое</button>
      <button type="button" onClick={async () => setResult(`${await confirm({ title: 'Удалить привычку?', message: 'Действие необратимо.' })}`)}>спросить</button>
      <button type="button" onClick={async () => setResult(`${await prompt({ title: 'Название', inputLabel: 'Имя', value: '  старое  ' })}`)}>ввести</button>
      <p data-testid="result">{result}</p>
      <FeedbackViewport />
    </>
  );
}

function renderHarness() {
  return render(
    <FeedbackProvider>
      <Harness />
    </FeedbackProvider>,
  );
}

describe('уведомления', () => {
  it('показывают текст и заголовок, а затем исчезают сами', () => {
    vi.useFakeTimers();
    renderHarness();

    fireEvent.click(screen.getByText('показать-успех'));

    expect(screen.getByText('Привычка сохранена')).toBeTruthy();
    expect(screen.getByText('Готово')).toBeTruthy();

    act(() => vi.advanceTimersByTime(TIMINGS.toastDurationMs));

    expect(screen.queryByText('Привычка сохранена')).toBeNull();
  });

  it('ошибки висят дольше обычных уведомлений и имеют роль alert', () => {
    vi.useFakeTimers();
    renderHarness();

    fireEvent.click(screen.getByText('показать-ошибку'));

    expect(screen.getByRole('alert').textContent).toContain('Сервер недоступен');

    act(() => vi.advanceTimersByTime(TIMINGS.toastDurationMs));
    expect(screen.queryByText('Сервер недоступен')).toBeTruthy();

    act(() => vi.advanceTimersByTime(TIMINGS.toastErrorDurationMs));
    expect(screen.queryByText('Сервер недоступен')).toBeNull();
  });

  it('закрываются кнопкой и не создаются из пустой строки', () => {
    renderHarness();
    fireEvent.click(screen.getByText('показать-успех'));

    fireEvent.click(screen.getByLabelText('Закрыть уведомление'));
    expect(screen.queryByText('Привычка сохранена')).toBeNull();

    fireEvent.click(screen.getByText('показать-пустое'));
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('держат не больше четырёх блоков одновременно', () => {
    renderHarness();
    for (let index = 0; index < 6; index += 1) fireEvent.click(screen.getByText('показать-успех'));

    expect(screen.getAllByRole('status')).toHaveLength(4);
  });
});

describe('confirm', () => {
  it('возвращает true по подтверждению и false по отмене', async () => {
    renderHarness();

    fireEvent.click(screen.getByText('спросить'));
    expect(screen.getByRole('dialog').textContent).toContain('Удалить привычку?');
    fireEvent.click(screen.getByText('Подтвердить'));
    expect((await screen.findByTestId('result')).textContent).toBe('true');

    fireEvent.click(screen.getByText('спросить'));
    fireEvent.click(screen.getByText('Отмена'));
    expect((await screen.findByTestId('result')).textContent).toBe('false');
  });

  it('Escape и клик по подложке означают отмену', async () => {
    renderHarness();

    fireEvent.click(screen.getByText('спросить'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect((await screen.findByTestId('result')).textContent).toBe('false');

    fireEvent.click(screen.getByText('спросить'));
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog.parentElement);
    expect((await screen.findByTestId('result')).textContent).toBe('false');
  });

  it('фокус сразу попадает на кнопку подтверждения', () => {
    renderHarness();
    fireEvent.click(screen.getByText('спросить'));

    expect(document.activeElement).toBe(screen.getByText('Подтвердить'));
  });
});

describe('prompt', () => {
  it('возвращает введённое значение без пробелов по краям', async () => {
    renderHarness();

    fireEvent.click(screen.getByText('ввести'));
    const input = screen.getByLabelText('Имя');
    fireEvent.change(input, { target: { value: '  новая привычка  ' } });
    fireEvent.click(screen.getByText('Сохранить'));

    expect((await screen.findByTestId('result')).textContent).toBe('новая привычка');
  });

  it('не даёт сохранить пустое значение, отмена возвращает null', async () => {
    renderHarness();

    fireEvent.click(screen.getByText('ввести'));
    const input = screen.getByLabelText('Имя');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByText('Сохранить').disabled).toBe(true);

    fireEvent.click(screen.getByText('Отмена'));
    expect((await screen.findByTestId('result')).textContent).toBe('null');
  });
});
