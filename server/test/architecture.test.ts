import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const srcDir = new URL('../src/', import.meta.url);

function listTypeScriptFiles(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    const path = new URL(name, dir);
    return statSync(path).isDirectory() ? listTypeScriptFiles(new URL(`${name}/`, dir)) : name.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture boundaries', () => {
  it('таблицу settings читает и пишет только SettingsService', () => {
    const violations: string[] = [];
    for (const file of listTypeScriptFiles(srcDir)) {
      const relative = file.pathname.replace(srcDir.pathname, '').replaceAll('\\', '/');
      if (relative === 'database/settings.service.ts' || relative === 'database/migrations.ts') continue;
      const source = readFileSync(file, 'utf8');
      if (/\b(?:FROM|INTO)\s+settings\b/.test(source)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });

  it('контроллеры не обращаются к базе напрямую', () => {
    const violations: string[] = [];
    for (const file of listTypeScriptFiles(srcDir)) {
      const relative = file.pathname.replace(srcDir.pathname, '').replaceAll('\\', '/');
      if (!relative.endsWith('.controller.ts')) continue;
      const source = readFileSync(file, 'utf8');
      if (/better-sqlite3|\.prepare\(|\.connection\b/.test(source)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });
});
