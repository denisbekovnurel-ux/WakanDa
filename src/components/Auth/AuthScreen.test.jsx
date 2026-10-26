// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen.jsx';

// Форма входа и регистрации проверяется теми же zod-схемами, что и на сервере.

const mocks = vi.hoisted(() => ({ login: null, register: null }));

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => mocks }));

beforeEach(() => {
  mocks.login = vi.fn(async () => {});
  mocks.register = vi.fn(async () => {});
});

afterEach(() => cleanup());

function fill(field, value) {
  fireEvent.change(screen.getByLabelText(field), { target: { value } });
}

describe('AuthScreen', () => {
  it('при пустых полях показывает ошибку и не дёргает сервер', () => {
    render(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(screen.getByRole('alert').textContent).toBe('Введите логин');
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('не пускает короткий логин при регистрации', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }));
    fill('Логин', 'ab');
    fill('Пароль', 'secret1');
    fill('Повтор пароля', 'secret1');

    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(screen.getByRole('alert').textContent).toBe('Логин: 3–24 символа, буквы, цифры, точка, дефис или подчёркивание');
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('ловит несовпадение паролей до запроса к серверу', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }));
    fill('Логин', 'ivan_01');
    fill('Пароль', 'secret1');
    fill('Повтор пароля', 'secret2');

    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(screen.getByRole('alert').textContent).toBe('Пароли не совпадают');
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('входит с обрезанным логином', async () => {
    render(<AuthScreen />);
    fill('Логин', '  waka_admin  ');
    fill('Пароль', 'secret1');

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('waka_admin', 'secret1'));
  });

  it('регистрирует с обрезанным логином', async () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }));
    fill('Логин', '  ivan_01  ');
    fill('Пароль', 'secret1');
    fill('Повтор пароля', 'secret1');

    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('ivan_01', 'secret1'));
  });

  it('показывает ошибку сервера и снимает блокировку кнопки', async () => {
    mocks.login.mockRejectedValue(new Error('Неверный логин или пароль'));
    render(<AuthScreen />);
    fill('Логин', 'waka_admin');
    fill('Пароль', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Неверный логин или пароль'));
    expect(screen.getByRole('button', { name: 'Войти' }).disabled).toBe(false);
  });

  it('убирает ошибку, когда пользователь правит поле', async () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByRole('alert')).toBeTruthy();

    fill('Логин', 'w');

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('переключение режима сбрасывает ошибку и не теряет введённое', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Повтор пароля')).toBeTruthy();
  });
});
