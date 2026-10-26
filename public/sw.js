// Имя кэша содержит идентификатор сборки (подставляется скриптом scripts/inject-sw-version.mjs
// при билде): старый кэш удаляется при activate, иначе клиенты получали бы смесь версий.
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = `wakanda-shell-${BUILD_ID}`;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const response = await fetch('/index.html');
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map((match) => match[1]);
    await Promise.allSettled(assets.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('wakanda-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Запросы к API (вход, данные пользователя) никогда не кэшируем.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      // Кэшируем только успешный ответ: страницу 500/404 иначе запомнит бы
      // как «официальный» офлайн-шелл, и её же отдал бы из кэша.
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
      }
      return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/daily';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((entry) => 'focus' in entry);
    return client ? client.navigate(target).then(() => client.focus()) : self.clients.openWindow(target);
  }));
});

// Web Push: уведомление приходит с сервера, даже когда вкладка (и приложение)
// закрыты. Payload — JSON { title, body, url }.
self.addEventListener('push', (event) => {
  let payload = { title: 'WakanDa', body: 'Пора свериться с планом.', url: '/daily' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    try {
      if (event.data) payload.body = event.data.text();
    } catch {
      // тело уведомления могло быть без данных
    }
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'WakanDa', {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/daily' },
  }));
});

// Periodic Background Sync: напоминание может прийти, даже когда сайт закрыт
// (поддерживается в Chromium-браузерах для установленного PWA).
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'wakanda-daily-reminder') return;
  event.waitUntil(self.registration.showNotification('WakanDa — время свериться', {
    body: 'Загляни в приложение и отметь выполненные привычки за сегодня.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/daily' },
  }));
});
