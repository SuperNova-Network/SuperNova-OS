/*
 * SuperNova OS service worker.
 *
 * Requests under a proxy prefix are rewritten and sent through the bare-mux
 * transport; everything else is left to the browser untouched.
 */
importScripts('/proxy/config.js')
importScripts('/assets/uv/uv.bundle.js')
importScripts('/proxy/uv.config.js')
importScripts(__uv$config.sw)

const uv = new UVServiceWorker()

// Take over immediately instead of waiting for every open tab to close, so the
// proxy works on the very first visit (and picks up new worker versions fast).
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  // Not calling respondWith() lets the browser handle non-proxied requests
  // natively, which keeps caching and streaming behaviour intact.
  if (uv.route(event)) event.respondWith(uv.fetch(event))
})
