import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { SettingsService } from '../src/database/settings.service';

const opened: Array<{ database: DatabaseService; dir: string }> = [];

function makeSettings(): SettingsService {
  const dir = mkdtempSync(join(tmpdir(), 'wakanda-settings-'));
  process.env.WAKANDA_DATA_DIR = dir;
  const database = new DatabaseService();
  opened.push({ database, dir });
  return new SettingsService(database);
}

afterEach(() => {
  while (opened.length) {
    const { database, dir } = opened.pop()!;
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SettingsService', () => {
  it('читает и обновляет значения через единственный владелец таблицы settings', () => {
    const settings = makeSettings();

    expect(settings.get('missing')).toBeUndefined();
    settings.set('vapid_public', 'one');
    expect(settings.get('vapid_public')).toBe('one');
    settings.set('vapid_public', 'two');
    expect(settings.get('vapid_public')).toBe('two');
  });

  it('читает булевы и числа с безопасными значениями по умолчанию', () => {
    const settings = makeSettings();
    settings.set('enabled', '1');
    settings.set('count', '42');
    settings.set('broken', 'NaN');

    expect(settings.getBoolean('enabled')).toBe(true);
    expect(settings.getBoolean('missing')).toBe(false);
    expect(settings.getNumber('count')).toBe(42);
    expect(settings.getNumber('broken', 7)).toBe(7);
  });
});
