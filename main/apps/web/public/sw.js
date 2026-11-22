// main/apps/web/public/sw.js
/**
 * Service Worker for PWA Fingerprinted Asset Caching & Web Push
 *
 * Security & caching invariants (restructure plan §11.3):
 * 1. Caches ONLY fingerprinted immutable static assets (`/assets/<name>-<hash>.<ext>`
 *    or `<name>.<hexhash>.<ext>`) plus install-time PWA manifest & icons;
 * 2. Never caches un-fingerprinted JS/CSS, HTML documents, or `/api/*` responses;
 * 3. Honours `Cache-Control: no-store` and `Cache-Control: private` on every write;
 * 4. Clears all caches when receiving `{ type: 'CLEAR_CACHE' }` on logout.
 *
 * @version 2.0.0
 */

const CACHE_VERSION = 'v5';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const ASSET_CACHE = `assets-${CACHE_VERSION}`;

const PRECACHE_ASSETS = ['/manifest.json', '/icons/logo192.png', '/icons/logo512.png'];

/**
 * Matches Vite's content-hashed `/assets/<name>-<hash>.<ext>` bundles as well
 * as dot-hashed `<name>.<hex8+>.<ext>` immutable assets.
 */
const VITE_FINGERPRINTED_PATTERN = /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i;
const DOT_FINGERPRINTED_PATTERN = /\.[a-f0-9]{8,}\.[a-z0-9]+$/i;
const UNCACHEABLE_DIRECTIVE_PATTERN = /\b(?:no-store|private)\b/i;

function isFingerprintedPathname(pathname) {
  return VITE_FINGERPRINTED_PATTERN.test(pathname) || DOT_FINGERPRINTED_PATTERN.test(pathname);
}

function isPrecachedPathname(pathname) {
  return PRECACHE_ASSETS.includes(pathname);
}

function isCacheableResponse(response) {
  if (!response || !response.ok || response.status !== 200) {
    return false;
  }
  const cacheControl = response.headers.get('Cache-Control') || '';
  if (UNCACHEABLE_DIRECTIVE_PATTERN.test(cacheControl)) {
    return false;
  }
  return true;
}

async function cleanupOldCaches() {
  const validCaches = [STATIC_CACHE, ASSET_CACHE];
  const cacheNames = await caches.keys();
  const deletions = cacheNames
    .filter((name) => !validCaches.includes(name))
    .map((name) => caches.delete(name));
  return Promise.all(deletions);
}

async function cacheFirstFingerprinted(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (isCacheableResponse(networkResponse)) {
    await cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

// ============================================================================
// Service Worker Lifecycle Events
// ============================================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // Retry on next load if offline during install
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    cleanupOldCaches()
      .then(() => self.clients.claim())
      .catch(() => {
        // Retry cleanup on next activation
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isFingerprintedPathname(url.pathname)) {
    event.respondWith(cacheFirstFingerprinted(request, ASSET_CACHE));
    return;
  }

  if (isPrecachedPathname(url.pathname)) {
    event.respondWith(cacheFirstFingerprinted(request, STATIC_CACHE));
  }
});

self.addEventListener('message', (event) => {
  if (!event.source) return;
  if (event.origin && event.origin !== self.location.origin) return;

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches
        .keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ cleared: true });
          }
        }),
    );
  }
});

// ============================================================================
// Push Notification Events
// ============================================================================

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'New Notification',
      body: event.data.text() || 'You have a new notification',
    };
  }

  const { title, ...options } = payload;
  const notificationOptions = {
    body: options.body || '',
    icon: options.icon || '/icons/logo192.png',
    badge: options.badge || '/icons/badge72.png',
    image: options.image,
    tag: options.tag,
    data: {
      ...options.data,
      url: options.url || options.data?.url,
      timestamp: options.timestamp || Date.now(),
    },
    actions: options.actions || [],
    requireInteraction: options.requireInteraction || false,
    renotify: options.renotify || false,
    silent: options.silent || false,
    vibrate: options.vibrate,
    timestamp: options.timestamp,
  };

  Object.keys(notificationOptions).forEach((key) => {
    if (notificationOptions[key] === undefined) {
      delete notificationOptions[key];
    }
  });

  event.waitUntil(self.registration.showNotification(title || 'Notification', notificationOptions));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  notification.close();

  let targetUrl = data.url || '/';
  if (action && data.actions) {
    const clickedAction = data.actions.find((a) => a.action === action);
    if (clickedAction && clickedAction.url) {
      targetUrl = clickedAction.url;
    }
  }

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            action,
            data,
            url: targetUrl,
          });
          await client.focus();
          if (clientUrl.pathname !== targetUrl && !targetUrl.startsWith('http')) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }

      const fullUrl = targetUrl.startsWith('http') ? targetUrl : self.location.origin + targetUrl;
      await self.clients.openWindow(fullUrl);
    })(),
  );
});

self.addEventListener('notificationclose', (event) => {
  void event.notification;
});
