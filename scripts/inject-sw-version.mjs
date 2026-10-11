// Подставляет идентификатор сборки в dist/sw.js, чтобы имя кэша
// менялось при каждом деплое и старые клиенты не залипали на старом HTML.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const swPath = join(process.cwd(), 'dist', 'sw.js');
if (existsSync(swPath)) {
  const html = existsSync(join(process.cwd(), 'dist', 'index.html'))
    ? readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8')
    : '';
  const buildId = createHash('sha1').update(`${html}${Date.now()}`).digest('hex').slice(0, 10);
  const source = readFileSync(swPath, 'utf8');
  writeFileSync(swPath, source.replaceAll('__BUILD_ID__', buildId));
  console.log(`sw.js: CACHE_NAME → wakanda-shell-${buildId}`);
}
