// Minimal service worker for PWA install prompt support.
// Does not cache — all requests pass through to the network.
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
