// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordChangeDialog } from './PasswordChangeDialog.jsx';
import { apiChangePassword, apiLogoutEverywhere } from '../api/authApi';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ token: 'token-1' }),
}));

vi.mock('../api/authApi', () => ({
  apiChangePassword: vi.fn(),
  apiLogoutEverywhere: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(apiChangePassword).mockReset();
  vi.mocked(apiLogoutEverywhere).mockReset();
});

afterEach(() => cleanup());

function fill(current, next, confirm) {
  fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Новый пароль (от 6 символов)'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Повтори новый пароль'), { target: { value: confirm } });
}

function submit() {
  fireEvent.submit(screen.getByText('Сохранить новый пароль').closest('form'));
}

describe('PasswordChangeDialog', () => {
  it('не отправляет слишком короткий пароль и несовпадающие пароли', () => {
    render(<PasswordChangeDialog onClose={vi.fn()} />);

    fill('old-pass', '12345', '12345');
    submit();
    expect(screen.getByRole('alert').textContent).toContain('не короче 6 символов');

    fill('old-pass', 'new-pass-1', 'new-pass-2');
    submit();
    expect(screen.getByRole('alert').textContent).toContain('не совпадают');

    expect(apiChangePassword).not.toHaveBeenCalled();
  });

  it('требует текущий пароль, чтобы не сбросить его вслепую', () => {
    render(<PasswordChangeDialog onClose={vi.fn()} />);

    fill('', 'new-pass-1', 'new-pass-1');
    submit();

    expect(screen.getByRole('alert').textContent).toBe('Введите текущий пароль.');
    expect(apiChangePassword).not.toHaveBeenCalled();
  });

  it('при пустых полях показывает свою ошибку, а не подсказку браузера', () => {
    render(<PasswordChangeDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Сохранить новый пароль'));

    expect(screen.getByRole('alert').textContent).toBe('Введите текущий пароль.');
    expect(apiChangePassword).not.toHaveBeenCalled();
  });

  it('отправляет токен и пароли, затем очищает поля и показывает успех', async () => {
    vi.mocked(apiChangePassword).mockResolvedValue({ ok: true });
    render(<PasswordChangeDialog onClose={vi.fn()} />);

    fill('old-pass', 'new-pass-1', 'new-pass-1');
    submit();

    await waitFor(() => expect(apiChangePassword).toHaveBeenCalledWith('token-1', 'old-pass', 'new-pass-1'));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Пароль изменён');
    expect(screen.getByLabelText('Текущий пароль').value).toBe('');
    expect(screen.getByLabelText('Новый пароль (от 6 символов)').value).toBe('');
  });

  it('показывает ошибку сервера и не врёт про успех', async () => {
    vi.mocked(apiChangePassword).mockRejectedValue(new Error('Текущий пароль указан неверно'));
    render(<PasswordChangeDialog onClose={vi.fn()} />);

    fill('wrong-pass', 'new-pass-1', 'new-pass-1');
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Текущий пароль указан неверно');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('завершает сессии на других устройствах и показывает их число', async () => {
    vi.mocked(apiLogoutEverywhere).mockResolvedValue({ ok: true, sessionsRemoved: 3 });
    render(<PasswordChangeDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Завершить сессии на других устройствах'));

    await waitFor(() => expect(apiLogoutEverywhere).toHaveBeenCalledWith('token-1'));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Завершено сессий: 3');
  });

  it('закрывается по Escape, по кнопке и по клику вне окна', () => {
    const onClose = vi.fn();
    render(<PasswordChangeDialog onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('клик внутри окна не закрывает диалог', () => {
    const onClose = vi.fn();
    render(<PasswordChangeDialog onClose={onClose} />);

    fireEvent.click(screen.getByText('Пароль и сессии'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
