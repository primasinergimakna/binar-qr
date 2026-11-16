// Service Worker Binar QR: online-first — kalau online, ambil dari jaringan
// dulu (jadi refresh selalu menampilkan versi terbaru); kalau jaringan gagal
// atau lambat, pakai cache (jadi offline atau koneksi jelek tetap menampilkan
// versi yang sudah ada). Semua aset di-precache saat install.
//
// WAJIB naikkan CACHE_NAME (binar-1.1, binar-1.2, ...) setiap kali file di ASET berubah.
// Kalau isi sw.js tidak berubah, browser tidak memasang SW baru — dan tanpa
// SW baru, cache lama tidak pernah dibersihkan.
const CACHE_NAME = 'binar-1.4';
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
  './lib/jsqr.min.js',
  './logo/logo-binar.png',
  './manifest.json',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // skipWaiting: SW baru langsung mengambil alih begitu install selesai,
  // tanpa menunggu semua tab lama tertutup. Aman di sini karena cache
  // berversi (CACHE_NAME naik tiap perubahan) dan halaman yang sudah terbuka
  // tetap menjalankan JS yang sudah dimuat di memori; muatan malas
  // (scanner/zxing) mengambil library yang sama dari cache baru.
  self.skipWaiting();
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
    (async () => {
      const nama = await caches.keys();
      const lama = nama.filter(
        (n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME
      );
      await Promise.all(lama.map((n) => caches.delete(n)));
      // claim: SW baru langsung mengendalikan halaman yang sudah terbuka,
      // jadi update tampil tanpa perlu menutup tab dulu.
      await self.clients.claim();
    })()
  );
});

// Batas waktu jaringan: kalau dalam 3 detik tidak ada jawaban (koneksi jelek),
// anggap gagal dan pakai cache — jangan biarkan halaman menunggu lama.
const BATAS_JARINGAN_MS = 3000;

function ambilJaringan(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('jaringan lambat')), BATAS_JARINGAN_MS);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET dan lintas-origin dibiarkan ke browser tanpa respondWith: SW ini
  // tidak pernah memanggil jaringan luar.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await ambilJaringan(request);
        // Simpan salinan yang bagus ke cache supaya offline berikutnya
        // menampilkan versi terbaru; kembalikan isi jaringan.
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        // Jaringan gagal/lambat: tampilkan yang sudah ada di cache.
        // ignoreSearch hanya untuk navigasi: membuka './?sumber=x' saat
        // offline tetap harus dapat halaman utama, sedangkan aset
        // (css/js/png) tidak punya query sehingga pencocokan ketatnya
        // tetap dipertahankan.
        const tersimpan = await cache.match(request, {
          ignoreSearch: request.mode === 'navigate',
        });
        if (tersimpan) return tersimpan;
        throw new Error('offline dan tidak ada di cache');
      }
    })()
  );
});
