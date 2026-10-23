/*
 * Service worker Konten POS — agar halaman kasir (/pos) bisa dibuka ulang saat internet putus.
 * Strategi:
 *  - Navigasi /pos   : network-first, cadangan = shell kasir terakhir yang tersimpan.
 *  - Navigasi lain   : network-only, cadangan = /offline.html (back-office butuh koneksi).
 *  - /_next/static, font, ikon, manifest : cache-first (nama file ber-hash / tidak berubah).
 *  - /api/*          : TIDAK pernah di-cache (data offline dikelola aplikasi di IndexedDB),
 *                      KECUALI thumbnail produk ber-versi (/api/v1/products/{id}/thumbnail?v=…): gambar
 *                      tidak sensitif & URL berubah saat diganti → cache-first agar katalog kasir tetap bergambar offline.
 *  - Gambar Cloudinary (res.cloudinary.com/…/image/upload/…/v{versi}/…): cache-first dengan alasan yang sama.
 * Shell kasir berisi nama & hak akses pengguna → dihapus saat keluar (pesan "clear-shell").
 */
const VERSION = "v2";
const SHELL = `konten-pos-shell-${VERSION}`;
const STATIC = `konten-pos-static-${VERSION}`;
const IMAGES = "konten-pos-images-v1";
const MAX_IMAGES = 400;
const THUMBNAIL = /^\/api\/v1\/products\/[0-9a-f-]{36}\/thumbnail$/;
const POS_PATH = "/pos";
const OFFLINE_PAGE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE_PAGE, "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, STATIC, IMAGES]);
      for (const key of await caches.keys()) if (key.startsWith("konten-pos-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
      await warmPosShell();
    })(),
  );
});

/**
 * Halaman kasir yang layak disimpan: bukan redirect. Dengan Cache Components, redirect ke /login terjadi di
 * dalam stream (HTTP tetap 200) dan muncul sebagai digest NEXT_REDIRECT di payload — jangan disimpan.
 */
function isUsableShell(html) {
  return !html.includes("NEXT_REDIRECT");
}

/** Simpan shell /pos beserta semua aset statis yang dirujuknya (dipanggil saat aktif & atas permintaan halaman). */
async function warmPosShell() {
  try {
    const res = await fetch(POS_PATH, { credentials: "include", redirect: "manual", cache: "no-store" });
    if (!res.ok || res.type === "opaqueredirect") return;
    const html = await res.clone().text();
    if (!isUsableShell(html)) return;
    await (await caches.open(SHELL)).put(POS_PATH, res);
    const assets = [...new Set([...html.matchAll(/["'](\/_next\/static\/[^"'\s]+)["']/g)].map((m) => m[1].replace(/\\u0026/g, "&")))];
    const cache = await caches.open(STATIC);
    await Promise.all(
      assets.map(async (url) => {
        if (await cache.match(url)) return;
        const r = await fetch(url).catch(() => null);
        if (r && r.ok) await cache.put(url, r);
      }),
    );
  } catch {
    /* offline / belum login: coba lagi lain kali */
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "warm-pos") event.waitUntil(warmPosShell());
  if (event.data === "clear-shell") event.waitUntil(caches.delete(SHELL));
});

async function cacheImage(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Gambar lintas origin dari <img> tanpa CORS berupa respons "opaque" (status 0) — tetap aman disimpan.
  if (res.ok || res.type === "opaque") {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(old);
  }
  return res;
}

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/__nextjs_font/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ownThumbnail = url.origin === self.location.origin && THUMBNAIL.test(url.pathname) && url.searchParams.has("v");
  const cloudinary = url.hostname === "res.cloudinary.com" && /\/image\/upload\/.*\/v\d+\//.test(url.pathname);
  if (ownThumbnail || cloudinary) {
    event.respondWith(cacheImage(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    if (url.pathname === POS_PATH) {
      event.respondWith(
        (async () => {
          try {
            const res = await fetch(req);
            // Hanya simpan halaman kasir yang benar-benar tampil (bukan redirect ke login).
            if (res.ok && !res.redirected) {
              const copy = res.clone();
              event.waitUntil(
                copy.text().then(async (html) => {
                  if (isUsableShell(html)) await (await caches.open(SHELL)).put(POS_PATH, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
                }),
              );
            }
            return res;
          } catch {
            return (await caches.match(POS_PATH, { cacheName: SHELL })) ?? (await caches.match(OFFLINE_PAGE)) ?? Response.error();
          }
        })(),
      );
      return;
    }
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_PAGE)) ?? Response.error()));
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});
