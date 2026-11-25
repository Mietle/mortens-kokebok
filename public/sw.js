// Mortens Kokebok – offline-støtte. Sider og data hentes ferskt når du er på nett, bilder lagres lokalt.
const V = "mk-20261125204702";
const CORE = ["/", "/index.html", "/recipes.json", "/wines.json", "/vinregister.json", "/webapp.js", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  const isAsset = /^\/(blob|img|icons)\//.test(u.pathname);
  if (isAsset) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); } return r; })));
  } else {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html"))));
  }
});
