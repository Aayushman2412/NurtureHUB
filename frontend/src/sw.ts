/// <reference lib="webworker" />
/**
 * NurtureHUB service worker (injectManifest — built by vite-plugin-pwa).
 *
 * Responsibilities:
 *  - Precache the app shell so the whole SPA opens with no network.
 *  - Runtime-cache learner API GETs (NetworkFirst) so previously seen data —
 *    form definitions, mothers/children, prior responses, metadata lists —
 *    stays readable offline. Admin endpoints are never cached (they stream
 *    multi-hundred-MB pipeline downloads and are desktop/online tools).
 *  - Cache uploaded form media and Google Fonts.
 *  - Web-push: show a system notification for every pushed event and
 *    deep-link into the app when tapped.
 *
 * POSTs/PUTs are deliberately NOT intercepted — offline mutations are handled
 * by the in-app IndexedDB queue (src/offline/), not by the service worker, so
 * queue behaviour is identical on iOS (which lacks Background Sync).
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import type { PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[];
};

// Take over immediately: field devices should always run the newest build.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback — never for API/WS/uploads/docs URLs.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/ws\//, /^\/uploads\//, /^\/docs/, /^\/openapi/],
  }),
);

// Learner/API reads. Matches same-origin prod (/api via nginx) and the
// cross-origin dev/preview backend (localhost:8010) alike via pathname.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/api/admin'),
  new NetworkFirst({
    cacheName: 'nh-api',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// Uploaded form media (learner photos, option images, action videos). Served
// either same-origin from /uploads/ or from the Cloudflare R2 CDN (a *.r2.dev
// bucket URL or the media custom domain) — R2 object keys keep the same
// folder names, so the pathname identifies media on any origin.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (url.pathname.startsWith('/uploads/') ||
      url.hostname.endsWith('.r2.dev') ||
      url.pathname.startsWith('/learner_media/') ||
      url.pathname.startsWith('/form_assets/')),
  new CacheFirst({
    cacheName: 'nh-media',
    plugins: [
      // R2 media loads via plain <img>/<video> tags (no-cors → opaque
      // responses); allow status 0 so those still cache for offline use.
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// Google Fonts: stylesheet revalidates, font files are immutable.
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'nh-fonts-css' }),
);
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'nh-fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// The app posts this on logout so the next user on a shared device cannot
// read the previous user's cached API data offline.
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_API_CACHE') {
    event.waitUntil(Promise.all([caches.delete('nh-api'), caches.delete('nh-media')]));
  }
});

// ---------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------

interface PushPayload {
  title?: string;
  body?: string;
  link?: string;
  tag?: string;
  count?: number;
}

self.addEventListener('push', event => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const title = payload.title || 'NurtureHUB';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      // Same tag -> later pushes replace instead of stacking endlessly.
      tag: payload.tag || 'nh-notification',
      data: { link: payload.link || '/notifications' },
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link: string = event.notification.data?.link || '/';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        // Reuse an open tab: focus it and let the app route itself.
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'PUSH_NAVIGATE', link });
          return;
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
