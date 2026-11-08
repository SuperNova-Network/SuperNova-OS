/*
 * SuperNova OS service worker.
 *
 * Requests under a proxy prefix are rewritten and sent through the bare-mux
 * transport by the selected engine (Ultraviolet or Scramjet); everything else is
 * left to the browser untouched.
 */
importScripts('/proxy/config.js')
importScripts('/assets/uv/uv.bundle.js')
importScripts('/proxy/uv.config.js')
importScripts(__uv$config.sw)
importScripts('/assets/scramjet/scramjet.all.js')
importScripts('/proxy/scramjet.config.js')
importScripts('/proxy/scramjet-db.js')

// Must be issued before the constructor below opens the same database.
snEnsureScramjetDb()

const uv = new UVServiceWorker()
const { ScramjetServiceWorker } = $scramjetLoadWorker()
const sj = new ScramjetServiceWorker()

const sjPrefix = location.origin + __scramjet$config.prefix
const sjWasm = location.origin + __scramjet$config.files.wasm

// Scramjet only initialises its internal config singleton when loadConfig()
// reads the config from IndexedDB itself. When the page pushes the config over
// postMessage first (which happens because this worker controls the page),
// sj.config is already set, loadConfig() returns early, and every request then
// fails with "Cannot read properties of undefined (reading 'prefix')". Force one
// real load per worker lifetime.
let scramjetConfigLoaded = false
async function loadScramjetConfig() {
  if (scramjetConfigLoaded) return
  sj.config = undefined
  await sj.loadConfig()
  scramjetConfigLoaded = Boolean(sj.config)
}

// A failed proxied request would otherwise surface as an opaque browser error page.
function errorResponse(error) {
  return new Response(`Proxy error: ${error && (error.stack || error.message || error)}`, {
    status: 502,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

// Take over immediately instead of waiting for every open tab to close, so the
// proxy works on the very first visit (and picks up new worker versions fast).
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  // Not calling respondWith() lets the browser handle non-proxied requests
  // natively, which keeps caching and streaming behaviour intact.
  const url = event.request.url
  if (uv.route(event)) {
    event.respondWith(uv.fetch(event))
  } else if (url.startsWith(sjPrefix) || url.startsWith(sjWasm)) {
    event.respondWith(loadScramjetConfig().then(() => sj.fetch(event)).catch(errorResponse))
  }
})
