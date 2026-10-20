import { describe, expect, it } from 'vitest';
import type { HelmetOptions } from 'helmet';
import {
  buildContentSecurityPolicy,
  buildHelmetOptions,
  parseCorsOrigins,
  parseTrustProxy,
} from '../src/security/security.config';

describe('parseTrustProxy', () => {
  it('по умолчанию не доверяет прокси', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
  });

  it('принимает число хопов', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('пропускает пресеты и списки подсетей express как есть', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
  });
});

describe('parseCorsOrigins', () => {
  it('закрыт по умолчанию', () => {
    expect(parseCorsOrigins(undefined)).toBe(false);
    expect(parseCorsOrigins('')).toBe(false);
    expect(parseCorsOrigins(' , ')).toBe(false);
  });

  it('разбивает список и убирает пробелы', () => {
    expect(parseCorsOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

function directives(isProduction: boolean): Record<string, string[]> {
  return buildContentSecurityPolicy(isProduction).directives;
}

describe('buildContentSecurityPolicy', () => {
  it('разрешает скрипты только со своего домена', () => {
    const csp = directives(false);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['script-src-attr']).toEqual(["'none'"]);
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
  });

  it('запрещает фреймы, объекты и сторонние формы', () => {
    const csp = directives(false);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
  });

  it('разрешает только известные источники для стилей и шрифтов', () => {
    const csp = directives(false);
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
    expect(csp['font-src']).toEqual(["'self'", 'data:', 'https://fonts.gstatic.com']);
    expect(csp['style-src']).not.toContain('https:');
    expect(csp['font-src']).not.toContain('https:');
    expect(csp['connect-src']).toEqual(["'self'"]);
  });

  it('включает upgrade-insecure-requests только в проде', () => {
    expect(directives(true)['upgrade-insecure-requests']).toEqual([]);
    expect(directives(false)['upgrade-insecure-requests']).toBeUndefined();
  });
});

describe('buildHelmetOptions', () => {
  it('включает HSTS только в проде', () => {
    expect(buildHelmetOptions(true).strictTransportSecurity).toMatchObject({
      maxAge: 15_552_000,
      includeSubDomains: true,
    });
    expect(buildHelmetOptions(false).strictTransportSecurity).toBe(false);
  });

  it('не ломает сторонние ресурсы через COEP и запрещает фрейминг', () => {
    const options: HelmetOptions = buildHelmetOptions(false);
    expect(options.crossOriginEmbedderPolicy).toBe(false);
    expect(options.frameguard).toEqual({ action: 'deny' });
    expect(options.referrerPolicy).toEqual({ policy: 'strict-origin-when-cross-origin' });
  });
});
