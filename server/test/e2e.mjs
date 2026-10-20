// Полноценный e2e-тест сервера: сам поднимает изолированный экземпляр
// (свой временный каталог данных, свой порт и свой пароль администратора),
// прогоняет сценарии и убирает за собой. Пароль реального админа здесь не нужен.
//
// Запуск: npm run test:e2e (из корня) или node test/e2e.mjs (из server/).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 3900 + Math.floor(Math.random() * 90);
const API = `http://localhost:${port}/api`;
const ADMIN_USER = 'e2e_admin';
const ADMIN_PASS = 'e2e_admin_secret';

let failures = 0;
function check(name, condition, extra = '') {
  if (condition) {
    console.log('PASS', name);
  } else {
    failures += 1;
    console.error('FAIL', name, extra);
  }
}

async function req(path, { method = 'GET', token, body, origin } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // пустое тело
  }
  return { status: res.status, data, headers: res.headers };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    const health = await req('/health').catch(() => null);
    if (health?.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('сервер не поднялся');
}

const dataDir = mkdtempSync(join(tmpdir(), 'wakanda-e2e-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(port),
    WAKANDA_DATA_DIR: dataDir,
    WAKANDA_ADMIN_USER: ADMIN_USER,
    WAKANDA_ADMIN_PASS: ADMIN_PASS,
    // Явно закрываем CORS и не доверяем прокси: тесты должны быть
    // детерминированными даже если эти переменные заданы в оболочке.
    WAKANDA_CORS_ORIGINS: '',
    WAKANDA_TRUST_PROXY: '',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

function stopServer() {
  if (!child.killed) child.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // временный каталог мог не создаться
  }
}

const run = String(Date.now()).slice(-6);
const username = `e2e_${run}`;

async function main() {
  await waitForServer();
  check('health endpoint responds ok', true);

  const security = await req('/health');
  const csp = security.headers.get('content-security-policy') ?? '';
  check('security headers: nosniff', security.headers.get('x-content-type-options') === 'nosniff');
  check('security headers: CSP present', csp.includes("default-src 'self'") && csp.includes("script-src 'self'"), csp);
  check('security headers: framing denied', csp.includes("frame-ancestors 'none'"), csp);
  check('security headers: referrer policy', security.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');
  check('security headers: x-powered-by hidden', !security.headers.get('x-powered-by'));

  const corsProbe = await req('/health', { origin: 'https://evil.example' });
  check('CORS closed by default (no reflected origin)', !corsProbe.headers.get('access-control-allow-origin'));

  const admin = await req('/auth/login', { method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASS } });
  check('admin login', admin.status === 200 || admin.status === 201, JSON.stringify(admin.data));
  const adminToken = admin.data?.token;

  const reg = await req('/auth/register', { method: 'POST', body: { username, password: 'secret123' } });
  check('register', reg.status === 200 || reg.status === 201, JSON.stringify(reg.data));
  const userToken = reg.data?.token;
  const userId = reg.data?.user?.id;
  check('registered user is pending', reg.data?.user?.status === 'pending');

  const list = await req('/admin/users', { token: adminToken });
  check('admin sees user list', Array.isArray(list.data?.users));

  const approve = await req(`/admin/users/${userId}/approve`, { method: 'POST', token: adminToken });
  check('approve user', approve.status === 200 || approve.status === 201, JSON.stringify(approve.data));

  const empty = await req('/state', { token: userToken });
  check('GET state returns {state,updatedAt}', Boolean(empty.data && 'state' in empty.data && 'updatedAt' in empty.data), JSON.stringify(empty.data));
  check('empty state initially', empty.data.state.tasks.length === 0);

  const validState = {
    version: 2,
    tasks: [{ id: 'h1', title: 'Бег', history: { '2026-10-01': 'done' }, pauseRanges: [{ from: '2026-10-10', to: '2026-10-12' }] }],
    oneOffTasks: [{ id: 'o1', title: 'Позвонить', done: false, priority: 'high', deadline: '2026-10-30' }],
    notes: { '2026-10-01': 'заметка' },
    theme: 'system',
    reminderTime: '20:00',
    reminderEnabled: false,
    lastAutoBackupAt: 0,
  };

  const save1 = await req('/state', { method: 'PUT', token: userToken, body: validState });
  check('save valid state', save1.status === 200, JSON.stringify(save1.data));
  check('save returns savedAt', typeof save1.data?.savedAt === 'string');

  const invalid = await req('/state', { method: 'PUT', token: userToken, body: { ...validState, tasks: [{ id: 'x', title: '', history: {} }] } });
  check('reject invalid state (400)', invalid.status === 400, `${invalid.status} ${JSON.stringify(invalid.data)}`);
  check('reject has message', typeof invalid.data?.message === 'string');

  const invalidDate = await req('/state', { method: 'PUT', token: userToken, body: { ...validState, tasks: [{ title: 'x', history: { notadate: 'done' } }] } });
  check('reject invalid history date (400)', invalidDate.status === 400);

  const invalidPause = await req('/state', { method: 'PUT', token: userToken, body: { ...validState, tasks: [{ title: 'x', pauseRanges: [{ from: '2026-10-10', to: '2026-10-01' }] }] } });
  check('reject invalid pause range (400)', invalidPause.status === 400, String(invalidPause.status));

  const bigTasks = [];
  for (let i = 0; i < 1000; i += 1) {
    bigTasks.push({ id: `big-${i}`, title: `Привычка ${String(i).padStart(4, '0')} ${'x'.repeat(150)}`, history: {} });
  }
  const bigState = { ...validState, tasks: bigTasks };
  const bigBytes = Buffer.byteLength(JSON.stringify(bigState));
  check(`big payload is over 100 KB (${Math.round(bigBytes / 1024)} KB)`, bigBytes > 100 * 1024);
  const saveBig = await req('/state', { method: 'PUT', token: userToken, body: bigState });
  check(`save big state (${Math.round(bigBytes / 1024)} KB)`, saveBig.status === 200, `${saveBig.status} ${JSON.stringify(saveBig.data)}`);

  const huge = { ...validState, tasks: [{ id: 'x', title: 'ok' }], junk: 'z'.repeat(3 * 1024 * 1024) };
  const saveHuge = await req('/state', { method: 'PUT', token: userToken, body: huge });
  check('oversized body rejected (413)', saveHuge.status === 413, String(saveHuge.status));

  const save2 = await req('/state', { method: 'PUT', token: userToken, body: validState });
  check('save again', save2.status === 200);

  const hist = await req('/state/history', { token: userToken });
  check('history endpoint', Array.isArray(hist.data?.history), JSON.stringify(hist.data));
  const entries = hist.data?.history ?? [];
  check('history has an auto snapshot', entries.length >= 1, `len=${entries.length}`);
  const newest = entries[0];

  const entry = await req(`/state/history/${newest?.id}`, { token: userToken });
  check('history entry has state', entry.data?.state?.tasks?.length >= 1, JSON.stringify(entry.data));

  const snap = await req('/state/snapshot', { method: 'POST', token: userToken, body: { reason: 'import' } });
  check('manual/import snapshot', snap.status === 200 || snap.status === 201, JSON.stringify(snap.data));

  const restore = await req(`/state/history/${newest?.id}/restore`, { method: 'POST', token: userToken });
  check('restore snapshot', restore.status === 200 || restore.status === 201, JSON.stringify(restore.data));

  const after = await req('/state', { token: userToken });
  check('state still readable after restore', after.data?.state?.tasks?.length >= 1);
  const restoredPause = after.data?.state?.tasks?.find((task) => task.id === 'h1')?.pauseRanges;
  check('pause ranges survive snapshot restore', Array.isArray(restoredPause) && restoredPause.length === 1, JSON.stringify(restoredPause));

  const badChange = await req('/auth/password', { method: 'POST', token: userToken, body: { currentPassword: 'wrongpass', newPassword: 'newsecret456' } });
  check('change password rejects wrong current', badChange.status === 400, `${badChange.status} ${JSON.stringify(badChange.data)}`);

  const change = await req('/auth/password', { method: 'POST', token: userToken, body: { currentPassword: 'secret123', newPassword: 'newsecret456' } });
  check('change password', change.status === 200 || change.status === 201, JSON.stringify(change.data));

  const loginNew = await req('/auth/login', { method: 'POST', body: { username, password: 'newsecret456' } });
  check('login with new password', loginNew.status === 200 || loginNew.status === 201, `${loginNew.status}`);

  const everywhere = await req('/auth/logout-everywhere', { method: 'POST', token: userToken });
  check('logout everywhere', everywhere.status === 200 || everywhere.status === 201, JSON.stringify(everywhere.data));

  const adminReset = await req(`/admin/users/${userId}/password`, { method: 'POST', token: adminToken, body: { password: 'resetpass789' } });
  check('admin reset password', adminReset.status === 200 || adminReset.status === 201, JSON.stringify(adminReset.data));

  const loginAfterReset = await req('/auth/login', { method: 'POST', body: { username, password: 'resetpass789' } });
  check('login with admin-reset password', loginAfterReset.status === 200 || loginAfterReset.status === 201, `${loginAfterReset.status}`);
  const userToken2 = loginAfterReset.data?.token;

  const pushKey = await req('/push/key');
  check('push public key available', typeof pushKey.data?.publicKey === 'string' && pushKey.data.publicKey.length > 10, JSON.stringify(pushKey.data));

  const badSub = await req('/push/subscribe', { method: 'POST', token: userToken2, body: { subscription: { endpoint: 'not-a-url' } } });
  check('reject invalid push subscription (400)', badSub.status === 400, String(badSub.status));

  const sub = await req('/push/subscribe', { method: 'POST', token: userToken2, body: { subscription: { endpoint: 'https://127.0.0.1:1/push', keys: { p256dh: 'BExampleKeyExampleKeyExampleKeyExampleKeyExampleKeyExampleKey', auth: 'authsecret' } }, timezoneOffset: 180 } });
  check('push subscribe', sub.status === 200 || sub.status === 201, JSON.stringify(sub.data));

  const pushStatus = await req('/push/status', { token: userToken2 });
  check('push status counts subscription', pushStatus.data?.subscriptions === 1, JSON.stringify(pushStatus.data));

  const pushTest = await req('/push/test', { method: 'POST', token: userToken2 });
  check('push test attempts delivery', (pushTest.status === 200 || pushTest.status === 201) && typeof pushTest.data?.sent === 'number', JSON.stringify(pushTest.data));

  const unsub = await req('/push/unsubscribe', { method: 'POST', token: userToken2, body: { endpoint: 'https://127.0.0.1:1/push' } });
  check('push unsubscribe', unsub.status === 200 || unsub.status === 201, JSON.stringify(unsub.data));

  const foreign = await req(`/state/history/${newest?.id}`, { token: adminToken });
  check('foreign snapshot not readable (404)', foreign.status === 404, String(foreign.status));

  // Per-user лимит на запись: 10 снимков в минуту, 11-й должен получить 429.
  // userToken2 ещё не делал snapshot-запросов, поэтому счёт начинается с нуля.
  let rateLimited = false;
  for (let i = 0; i < 12; i += 1) {
    const burst = await req('/state/snapshot', {
      method: 'POST',
      token: userToken2,
      body: { reason: 'manual' },
    });
    if (burst.status === 429) {
      rateLimited = true;
      break;
    }
  }
  check('write rate limit returns 429 after burst', rateLimited);

  const del = await req(`/admin/users/${userId}`, { method: 'DELETE', token: adminToken });
  check('cleanup delete test user', del.status === 200, JSON.stringify(del.data));

  console.log(failures === 0 ? '\nALL GOOD' : `\n${failures} FAILURES`);
}

main()
  .catch((error) => {
    console.error('E2E crashed:', error);
    failures += 1;
  })
  .finally(() => {
    stopServer();
    process.exit(failures === 0 ? 0 : 1);
  });
