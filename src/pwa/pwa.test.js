// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'));
const serviceWorker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const clientEntry = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const serverEntry = readFileSync(new URL('../../server/src/main.ts', import.meta.url), 'utf8');

describe('PWA installability', () => {
  it('манифест содержит обязательные поля Chrome', () => {
    expect(manifest.name).toContain('WakanDa');
    expect(manifest.short_name).toBe('WakanDa');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('иконки 192/512 и maskable существуют на диске', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => String(icon.purpose).includes('maskable'))).toBe(true);

    for (const icon of manifest.icons) {
      const path = new URL(`../../public${icon.src}`, import.meta.url);
      expect(existsSync(path), `${icon.src} должен существовать`).toBe(true);
    }
  });

  it('быстрые действия ведут на реальные разделы', () => {
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(['/daily', '/oneoff', '/stats']);
  });

  it('service worker обрабатывает fetch и не кэширует API', () => {
    expect(serviceWorker).toContain("self.addEventListener('install'");
    expect(serviceWorker).toContain("self.addEventListener('fetch'");
    expect(serviceWorker).toContain("url.pathname.startsWith('/api/')");
    expect(serviceWorker).toContain("self.addEventListener('push'");
  });

  it('index.html подключает манифест и iOS-метаданные', () => {
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain('application/manifest+json');
    expect(indexHtml).toContain('apple-mobile-web-app-capable');
    expect(indexHtml).toContain('apple-mobile-web-app-title');
    expect(indexHtml).toContain('apple-touch-icon');
  });

  it('service worker регистрируется только в production-сборке', () => {
    expect(clientEntry).toContain("import.meta.env.PROD");
    expect(clientEntry).toContain("navigator.serviceWorker.register('/sw.js')");
  });

  it('сервер отдаёт манифест и service worker с правильными заголовками', () => {
    expect(serverEntry).toContain('application/manifest+json');
    expect(serverEntry).toContain('Service-Worker-Allowed');
    expect(serverEntry).toContain('no-store');
  });
});
