/**
 * Совместимость со старыми ссылками: до перехода на роутер навигация жила
 * в хеше (`/#daily`). Такие закладки, уведомления и установленные PWA ещё
 * какое-то время будут приходить со старым адресом, поэтому один раз
 * переписываем его в чистый путь до старта приложения.
 */

export const LEGACY_HASHES: ReadonlySet<string> = new Set(['home', 'daily', 'oneoff', 'stats', 'admin']);

interface LocationLike {
  pathname?: string;
  hash?: string;
}

/**
 * Возвращает новый путь для replaceState или null, если миграция не нужна.
 */
export function migrateLegacyHash(location: LocationLike): string | null {
  const pathname = location?.pathname ?? '/';
  const hash = (location?.hash ?? '').replace(/^#/, '');

  // Чистый путь уже задан — не трогаем. Хеши вида `#/daily` принадлежат
  // самому роутеру, а `#section` может быть якорем на странице.
  if (pathname !== '/' && pathname !== '/index.html') return null;
  if (!LEGACY_HASHES.has(hash)) return null;

  return hash === 'home' ? '/' : `/${hash}`;
}
