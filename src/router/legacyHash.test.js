import { describe, expect, it } from 'vitest';
import { LEGACY_HASHES, migrateLegacyHash } from './legacyHash';

describe('migrateLegacyHash', () => {
  it('переводит старые хеши страниц в чистые пути', () => {
    expect(migrateLegacyHash({ pathname: '/', hash: '#daily' })).toBe('/daily');
    expect(migrateLegacyHash({ pathname: '/', hash: '#oneoff' })).toBe('/oneoff');
    expect(migrateLegacyHash({ pathname: '/', hash: '#stats' })).toBe('/stats');
    expect(migrateLegacyHash({ pathname: '/', hash: '#admin' })).toBe('/admin');
    expect(migrateLegacyHash({ pathname: '/index.html', hash: '#daily' })).toBe('/daily');
  });

  it('главную переводит в корень', () => {
    expect(migrateLegacyHash({ pathname: '/', hash: '#home' })).toBe('/');
  });

  it('не трогает уже чистые пути', () => {
    expect(migrateLegacyHash({ pathname: '/daily', hash: '#daily' })).toBeNull();
    expect(migrateLegacyHash({ pathname: '/stats', hash: '' })).toBeNull();
  });

  it('не трогает пустой хеш, якоря и хеши роутера', () => {
    for (const hash of ['', '#', '#section', '#/daily', '#/']) {
      expect(migrateLegacyHash({ pathname: '/', hash })).toBeNull();
    }
  });

  it('знает ровно пять старых страниц', () => {
    expect([...LEGACY_HASHES].sort()).toEqual(['admin', 'daily', 'home', 'oneoff', 'stats']);
  });
});
