importScripts('/uv/bundle.js')
importScripts('/uv/config.js')
importScripts('/uv/sw.js')

const sw = new UVServiceWorker()

// The legacy vendored UV worker reads this implicit global.
var userKey = new URL(location).searchParams.get('userkey')

// Take over immediately instead of waiting for every open tab to close, so the
// proxy works on the very first visit (and picks up new worker versions fast).
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => event.respondWith(sw.fetch(event)))
