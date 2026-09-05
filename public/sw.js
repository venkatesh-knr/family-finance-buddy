/*
 * The service worker exists to make the app installable, and does nothing else.
 *
 * Chrome will not offer to install a site without one that handles fetch. So
 * this handles fetch — by passing every request straight to the network and
 * caching nothing at all.
 *
 * That is deliberate. A caching worker is the classic way to strand people on a
 * stale bundle, and worse here than in most apps: a household whose figures are
 * a version behind has no way to tell. Real offline support is a dated design
 * decision of its own — an IndexedDB cache with a sync queue that drains on
 * reconnect, and last-write-wins conflicts written to the audit log
 * (docs/blueprint.md §803 and the offline-conflicts note in §12). It belongs
 * with that work, not smuggled in behind an install prompt.
 */

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No respondWith: the browser performs its own default fetch. The handler is
  // present, which is all the install criteria require, and nothing is
  // intercepted, which is what keeps the bundle honest.
});
