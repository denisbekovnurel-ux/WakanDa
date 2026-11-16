import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const topbar = readFileSync(new URL('./components/Shell/Topbar.tsx', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('./components/Shell/navigation.ts', import.meta.url), 'utf8');
const pwaProvider = readFileSync(new URL('./pwa/PwaInstallProvider.tsx', import.meta.url), 'utf8');
const installBanner = readFileSync(new URL('./components/Install/InstallBanner.tsx', import.meta.url), 'utf8');

describe('frontend architecture boundaries', () => {
  it('App использует Shell/Topbar и не владеет разметкой шапки', () => {
    expect(app).toContain("from './components/Shell/Topbar'");
    expect(app).toContain("from './components/Shell/navigation'");
    expect(app).not.toContain('<header className="topbar">');
    expect(app).not.toContain('const pages: Record<PageKey, PageMeta>');
  });

  it('навигация и шапка разделены по владельцам', () => {
    expect(navigation).toContain('export const pages');
    expect(navigation).toContain('export function pathForPage');
    expect(topbar).toContain("from './navigation'");
    expect(topbar).toContain('export function Topbar');
  });

  it('beforeinstallprompt слушается только в PwaInstallProvider', () => {
    expect(pwaProvider).toContain("addEventListener('beforeinstallprompt'");
    expect(app).not.toContain('beforeinstallprompt');
    expect(topbar).not.toContain('beforeinstallprompt');
    expect(installBanner).not.toContain('beforeinstallprompt');
  });
});
