// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Страховка от «белого экрана»: ошибка рендера должна превращаться в
// понятный экран, а «Попробовать снова» — возвращать приложение к жизни.

let consoleError;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

function Boom() {
  throw new Error('Тестовое падение рендера');
}

describe('ErrorBoundary', () => {
  it('обычных детей рендерит без изменений', () => {
    render(<ErrorBoundary><p>Всё хорошо</p></ErrorBoundary>);

    expect(screen.getByText('Всё хорошо')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('на ошибке рендера показывает экран восстановления, а не пустоту', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);

    expect(screen.getByRole('alert').textContent).toContain('Приложение не смогло отрисоваться');
    expect(screen.getByRole('alert').textContent).toContain('Тестовое падение рендера');
    expect(screen.getByText('Перезагрузить')).toBeTruthy();
    expect(screen.getByText('Попробовать снова')).toBeTruthy();
  });

  it('«Попробовать снова» перерисовывает детей после устранения причины', () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('Временная поломка');
      return <p>Снова работает</p>;
    }

    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Попробовать снова'));

    expect(screen.getByText('Снова работает')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('логирует ошибку вместе со стеком компонентов', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);

    expect(consoleError).toHaveBeenCalledWith(
      'Ошибка интерфейса:',
      expect.objectContaining({ message: 'Тестовое падение рендера' }),
      expect.anything(),
    );
  });
});
