// utils.js — Helper bersama untuk Binar QR
// Satu tempat, satu tanggung jawab. Dipakai oleh app.js dan scanner.js.

/**
 * Hitung jumlah byte UTF-8 dari string.
 * @param {string} str
 * @returns {number}
 */
function hitungByteUTF8(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  // Fallback hitung manual per code point
  let total = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7f) total += 1;
    else if (cp <= 0x7ff) total += 2;
    else if (cp <= 0xffff) total += 3;
    else total += 4;
  }
  return total;
}

/**
 * Ubah string menjadi array byte UTF-8 (jumlahnya sama dengan hitungByteUTF8).
 * Dipakai generator QR supaya isi QR persis sama dengan teks input,
 * termasuk karakter non-ASCII (é, €, emoji).
 * @param {string} str
 * @returns {number[]}
 */
function teksKeByteUTF8(str) {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(str));
  }
  // Fallback: encodeURIComponent menghasilkan UTF-8 yang di-escape
  var hasil = [];
  var kode = encodeURIComponent(String(str));
  for (var i = 0; i < kode.length; i++) {
    if (kode.charAt(i) === '%') {
      hasil.push(parseInt(kode.substr(i + 1, 2), 16));
      i += 2;
    } else {
      hasil.push(kode.charCodeAt(i));
    }
  }
  return hasil;
}

/**
 * Buat slug nama file dari input (teks atau URL).
 * Aturan:
 * - Kalau input berupa URL (diawali http:// atau https://):
 *   ambil domain (tanpa www.) + segmen path, gabung dengan '-',
 *   buang query (?...) dan fragment (#...).
 *   Contoh: https://contoh.com/panduan-azan?page=2 → contoh-com-panduan-azan
 * - Kalau input berupa teks biasa:
 *   ambil 4 kata pertama, gabung dengan '-'.
 *   Contoh: Jadwal Sholat Pontianak November → jadwal-sholat-pontianak-november
 * - Sanitasi: huruf kecil semua, karakter selain a-z 0-9 - diganti '-',
 *   '-' beruntun dijadikan satu, '-' di awal/akhir dibuang,
 *   maks 50 karakter (potong di 50 lalu buang '-' di ujung).
 * - Kalau hasil kosong → fallback 'qr-YYYYMMDD-HHMMSS' (waktu perangkat).
 * - Return TANPA ekstensi .png (ekstensi ditambah pemanggil).
 * @param {string} input
 * @returns {string}
 */
function buatSlugNamaFile(input) {
  const teks = String(input == null ? '' : input).trim();
  let mentah;

  if (/^https?:\/\//i.test(teks)) {
    // Buang skema, query, dan fragment; sisanya: domain + path
    const tanpaSkema = teks.replace(/^https?:\/\//i, '').split(/[?#]/)[0];
    const bagian = tanpaSkema.split('/').filter(Boolean);
    if (bagian.length > 0) bagian[0] = bagian[0].replace(/^www\./i, '');
    mentah = bagian.join('-');
  } else {
    mentah = teks.split(/\s+/).filter(Boolean).slice(0, 4).join('-');
  }

  const bersihkan = (s) => s.replace(/^-+|-+$/g, '');

  let slug = mentah
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
  slug = bersihkan(slug);
  slug = bersihkan(slug.slice(0, 50));

  if (slug) return slug;

  // Fallback: qr-YYYYMMDD-HHMMSS dari waktu perangkat
  const d = new Date();
  const dua = (n) => String(n).padStart(2, '0');
  return 'qr-' + d.getFullYear() + dua(d.getMonth() + 1) + dua(d.getDate()) +
    '-' + dua(d.getHours()) + dua(d.getMinutes()) + dua(d.getSeconds());
}

/**
 * Salin teks ke clipboard. Coba navigator.clipboard.writeText dulu,
 * kalau gagal fallback ke cara lama (textarea tersembunyi + execCommand).
 * @param {string} teks
 * @returns {Promise<boolean>} true kalau berhasil
 */
async function salinKeClipboard(teks) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(teks);
      return true;
    } catch (e) {
      // lanjut ke fallback
    }
  }

  const ta = document.createElement('textarea');
  ta.value = teks;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  let berhasil = false;
  try {
    berhasil = document.execCommand('copy');
  } catch (e) {
    berhasil = false;
  }
  document.body.removeChild(ta);
  return berhasil;
}
