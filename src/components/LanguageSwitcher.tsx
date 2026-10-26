import { useI18n } from '../i18n';

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className = '' }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={`lang-switch ${className}`.trim()} role="group" aria-label={t('Язык интерфейса')}>
      <button
        className={`lang-switch__button ${locale === 'ru' ? 'is-active' : ''}`}
        type="button"
        aria-pressed={locale === 'ru'}
        title={t('Русский')}
        onClick={() => setLocale('ru')}
      >
        RU
      </button>
      <button
        className={`lang-switch__button ${locale === 'en' ? 'is-active' : ''}`}
        type="button"
        aria-pressed={locale === 'en'}
        title={t('Английский')}
        onClick={() => setLocale('en')}
      >
        EN
      </button>
    </div>
  );
}
