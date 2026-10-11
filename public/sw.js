// Имя кэша содержит идентификатор сборки (подставляется скриптом scripts/inject-sw-version.mjs
// при билде): старый кэш удаляется при activate, иначе клиенты получали бы смесь версий.
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = `wakanda-shell-${BUILD_ID}`;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

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
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
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
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((entry) => 'focus' in entry);
    return client ? client.navigate('/#daily').then(() => client.focus()) : self.clients.openWindow('/#daily');
  }));
});

// Periodic Background Sync: напоминание может прийти, даже когда сайт закрыт
// (поддерживается в Chromium-браузерах для установленного PWA).
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'wakanda-daily-reminder') return;
  event.waitUntil(self.registration.showNotification('WakanDa — время свериться', {
    body: 'Загляни в приложение и отметь выполненные привычки за сегодня.',
    icon: '/icons/icon.svg',
  }));
});
