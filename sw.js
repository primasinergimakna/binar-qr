// Service Worker Binar QR: cache-first, semua aset di-precache saat install.
//
// WAJIB naikkan CACHE_NAME (binar-v4, ...) setiap kali file di ASET berubah.
// Cache-first tidak pernah bertanya ke jaringan untuk file yang sudah
// tersimpan, jadi tanpa kenaikan versi pengguna yang sudah install akan
// terus memakai file lama.
const CACHE_NAME = 'binar-v4';
// Origin yang sama bisa dipakai aplikasi lain (mis. GitHub Pages); hanya cache
// berawalan ini yang boleh dihapus saat activate.
const CACHE_PREFIX = 'binar-';

// Relatif terhadap sw.js agar jalan di root maupun subfolder. Daftar ini sama
// dengan file map; './' ikut dicatat karena start_url manifest adalah './'
// dan permintaannya tidak sama dengan kunci './index.html'.
const ASET = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './scanner.js',
  './utils.js',
  './lib/qrcode-generator.min.js',
  './lib/zxing-browser.min.js',
  './logo/logo-binar.png',
  './manifest.json',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Tanpa skipWaiting: SW baru menunggu sampai semua tab lama tertutup. Halaman

  // yang sudah terbuka memuat scanner/zxing secara malas, dan kalau cache-nya
  // tiba-tiba berganti di tengah sesi, HTML lama bisa bertemu JS baru.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' melewati cache HTTP. Tanpa ini, setelah versi dinaikkan
      // cache baru bisa terisi salinan lama dari cache HTTP browser.
      // addAll bersifat all-or-nothing: satu file gagal = install gagal, jadi
      // tidak pernah ada SW aktif dengan cache setengah jadi.
      cache.addAll(ASET.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nama) =>
      Promise.all(
        nama
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET dan lintas-origin dibiarkan ke browser tanpa respondWith: SW ini
  // tidak pernah memanggil jaringan luar.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;


  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // ignoreSearch hanya untuk navigasi: membuka './?sumber=x' saat offline
      // tetap harus dapat halaman utama, sedangkan aset (css/js/png) tidak
      // punya query sehingga pencocokan ketatnya tetap dipertahankan.
      const tersimpan = await cache.match(request, {
        ignoreSearch: request.mode === 'navigate',
      });
      return tersimpan || fetch(request);
    })
  );
});
