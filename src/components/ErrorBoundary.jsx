import { Component } from 'react';

/**
 * Страховка от «белого экрана»: любая ошибка рендера внутри приложения
 * показывается понятным экраном с кнопками восстановления, а не оставляет
 * пользователя без интерфейса. Данные при этом никуда не пропадают — они
 * лежат в localStorage и на сервере.
 *
 * Ошибки обработчиков событий и асинхронного кода сюда не попадают — их
 * по-прежнему нужно ловить в коде.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = this.handleReload.bind(this);
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Ошибка интерфейса:', error, info?.componentStack);
  }

  handleReload() {
    window.location.reload();
  }

  handleRetry() {
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="fatal-error" role="alert">
        <p className="eyebrow">ЧТО-ТО ПОШЛО НЕ ТАК</p>
        <h1>Приложение не смогло отрисоваться</h1>
        <p className="section-description">
          Данные не потеряны: они остаются в браузере и на сервере. Перезагрузи страницу
          или вернись на главную.
        </p>
        <div className="fatal-error-actions">
          <button className="button button--red" type="button" onClick={this.handleReload}>Перезагрузить</button>
          <button className="button button--light" type="button" onClick={this.handleRetry}>Попробовать снова</button>
          <a className="button button--light" href="#home">На главную</a>
        </div>
        <pre className="fatal-error-details">{String(this.state.error?.message || this.state.error)}</pre>
      </div>
    );
  }
}
