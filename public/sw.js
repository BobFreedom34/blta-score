self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No offline caching — a live-score app showing stale data offline would be
// actively misleading, so every request just goes straight to the network.
// The fetch handler still needs to exist for Chrome/Android to consider the
// app installable.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'BLTA Score', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'BLTA Score';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    // Android's status-bar notification icon isn't drawn in color — it's a
    // solid white silhouette masked from this image's own alpha channel,
    // ignoring every pixel's actual color. icon-192.png is a full-bleed
    // opaque square (the BLTA badge logo, no transparency at all), so using
    // it here made every push notification show as a plain white square —
    // this is a dedicated transparent PNG containing just a tennis-ball
    // silhouette, so the masked result actually reads as a tennis ball.
    badge: '/notification-badge.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
