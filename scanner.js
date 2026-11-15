// scanner.js — Logika scanner Binar QR (T2)
// Scan hanya dari file gambar, semua diproses di perangkat.
// Library ZXing dimuat malas (lazy) saat tab Scan pertama kali dibuka.
// Memakai salinKeClipboard() dari utils.js.

(function () {
  'use strict';

  // ---------- Konstanta ----------
  var LOKASI_PUSTAKA = 'lib/zxing-browser.min.js';
  var BATAS_UKURAN = 10 * 1024 * 1024; // 10 MB
  var JEDA_LABEL_MS = 2000;

  var PESAN_FILE_TIDAK_VALID = 'File harus berupa gambar (PNG/JPG/WEBP) dan maksimal 10 MB.';
  var PESAN_TIDAK_TERBACA = 'Tidak ada QR/barcode yang terbaca di gambar ini. Coba gambar yang lebih jelas, lebih besar, atau tidak terpotong.';
  var PESAN_GAGAL_MUAT = 'Gagal memuat scanner. Coba muat ulang halaman.';
  var PESAN_GAMBAR_RUSAK = 'Gambar tidak bisa dibuka. Coba file gambar lain.';
  var STATUS_MEMUAT = 'Memuat scanner...';
  var STATUS_MEMBACA = 'Membaca gambar...';

  // ---------- Elemen ----------
  var dropzone = document.getElementById('dropzone');
  var teksDropzone = document.getElementById('dropzone-teks');
  var btnPilih = document.getElementById('btn-pilih-file');
  var inputFile = document.getElementById('input-file');
  var areaThumbnail = document.getElementById('area-thumbnail');
  var pesanError = document.getElementById('pesan-error');
  var labelHasil = document.getElementById('label-hasil');
  var kotakHasil = document.getElementById('hasil-scan');
  var btnSalin = document.getElementById('btn-salin');
  var btnBukaLink = document.getElementById('btn-buka-link');
  var btnHapus = document.getElementById('btn-hapus');

  // Teks awal diambil dari HTML supaya tidak ditulis dua kali
  var TEKS_DROPZONE_AWAL = teksDropzone.textContent;
  var LABEL_SALIN_AWAL = btnSalin.textContent;

  // ---------- Status (hanya di memori, tidak disimpan) ----------
  var promisePustaka = null;   // promise pemuatan ZXing, null kalau belum / gagal
  var pembaca = null;          // instance BrowserMultiFormatReader
  var hasilTerakhir = null;    // teks hasil scan persis seperti dibaca ZXing
  var urlGambar = null;        // object URL gambar yang sedang ditampilkan
  var idProses = 0;            // penanda proses terbaru; proses lama diabaikan
  var sedangProses = false;
  var timerLabelSalin = null;

  // =====================================================================
  // Lazy load ZXing
  // =====================================================================

  function pustakaSiap() {
    return !!(window.ZXing && window.ZXing.BrowserMultiFormatReader);
  }

  // Muat lib/zxing-browser.min.js sekali saja. Gagal → boleh dicoba lagi nanti.
  function muatPustaka() {
    if (pustakaSiap()) return Promise.resolve();
    if (promisePustaka) return promisePustaka;

    promisePustaka = new Promise(function (selesai, gagal) {
      var s = document.createElement('script');
      s.src = LOKASI_PUSTAKA;
      s.onload = function () {
        if (pustakaSiap()) selesai();
        else gagal(new Error('ZXing tidak ditemukan'));
      };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        gagal(new Error('Gagal memuat ZXing'));
      };
      document.head.appendChild(s);
    });

    promisePustaka.catch(function () { promisePustaka = null; });
    return promisePustaka;
  }

  // ZXing 0.23.0 memanggil console.warn setiap kali salah satu reader gagal
  // (NotFoundException bukan turunan ReaderException di library itu), padahal
  // itu hal normal saat mencoba beberapa jenis kode. Hanya pesan itu yang disaring;
  // peringatan lain tetap diteruskan.
  function senyapkanPeringatanZXing() {
    var asli = console.warn;
    console.warn = function () {
      if (typeof arguments[0] === 'string' &&
          arguments[0].indexOf('MultiFormatReader: non-ReaderException') === 0) {
        return;
      }
      return asli.apply(console, arguments);
    };
  }

  // Satu pembaca untuk semua scan; hanya jenis kode yang diminta
  function ambilPembaca() {
    if (pembaca) return pembaca;
    senyapkanPeringatanZXing();
    var Z = window.ZXing;
    var petunjuk = new Map();
    petunjuk.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      Z.BarcodeFormat.QR_CODE,
      Z.BarcodeFormat.CODE_128,
      Z.BarcodeFormat.CODE_39,
      Z.BarcodeFormat.EAN_13,
      Z.BarcodeFormat.EAN_8,
      Z.BarcodeFormat.UPC_A
    ]);
    petunjuk.set(Z.DecodeHintType.TRY_HARDER, true);
    pembaca = new Z.BrowserMultiFormatReader(petunjuk);
    return pembaca;
  }

  // =====================================================================
  // Tampilan
  // =====================================================================

  function setStatus(teks) {
    teksDropzone.textContent = teks;
  }

  function pulihkanDropzone() {
    setStatus(TEKS_DROPZONE_AWAL);
    dropzone.hidden = false;
  }

  function tampilkanError(teks) {
    pesanError.textContent = teks;
    pesanError.hidden = false;
  }

  function sembunyikanError() {
    pesanError.textContent = '';
    pesanError.hidden = true;
  }

  function sembunyikanHasil() {
    hasilTerakhir = null;
    kotakHasil.value = '';
    kotakHasil.hidden = true;
    labelHasil.hidden = true;
    btnSalin.hidden = true;
    btnBukaLink.hidden = true;
    btnHapus.hidden = true;
    clearTimeout(timerLabelSalin);
    btnSalin.textContent = LABEL_SALIN_AWAL;
  }

  function bersihkanGambar() {
    areaThumbnail.replaceChildren();
    if (urlGambar) {
      URL.revokeObjectURL(urlGambar);
      urlGambar = null;
    }
  }

  // Kembali ke keadaan kosong awal
  function resetSemua() {
    idProses++; // batalkan proses yang masih jalan
    sedangProses = false;
    bersihkanGambar();
    sembunyikanHasil();
    sembunyikanError();
    inputFile.value = ''; // supaya file yang sama bisa dipilih lagi
    pulihkanDropzone();
  }

  function tampilkanHasil(teks) {
    hasilTerakhir = teks;
    kotakHasil.value = teks;
    labelHasil.hidden = false;
    kotakHasil.hidden = false;
    btnSalin.hidden = false;
    btnBukaLink.hidden = !adalahLink(teks);
    btnHapus.hidden = false;
    sembunyikanError();
    dropzone.hidden = true;
  }

  function tampilkanGagal(pesan) {
    tampilkanError(pesan);
    dropzone.hidden = true;
    btnHapus.hidden = false;
  }

  // =====================================================================
  // Validasi dan proses
  // =====================================================================

  function adalahLink(teks) {
    return /^https?:\/\//i.test(teks);
  }

  // Tipe harus image/* dan ukuran maksimal 10 MB
  function fileValid(file) {
    return !!file && typeof file.type === 'string' &&
      file.type.indexOf('image/') === 0 && file.size <= BATAS_UKURAN;
  }

  function muatGambar(img, url) {
    return new Promise(function (selesai, gagal) {
      img.onload = function () { selesai(); };
      img.onerror = function () { gagal(new Error('Gambar rusak')); };
      img.src = url;
    });
  }

  async function prosesFile(file) {
    var id = ++idProses;
    bersihkanGambar();
    sembunyikanHasil();
    sembunyikanError();
    pulihkanDropzone();

    if (!fileValid(file)) {
      sedangProses = false;
      tampilkanError(PESAN_FILE_TIDAK_VALID);
      return;
    }

    sedangProses = true;

    // Thumbnail kecil dari gambar yang diunggah
    urlGambar = URL.createObjectURL(file);
    var img = document.createElement('img');
    img.alt = 'Gambar yang dipindai';
    areaThumbnail.replaceChildren(img);

    setStatus(STATUS_MEMBACA);

    try {
      await muatGambar(img, urlGambar);
    } catch (e) {
      if (id !== idProses) return;
      sedangProses = false;
      pulihkanDropzone();
      tampilkanGagal(PESAN_GAMBAR_RUSAK);
      return;
    }
    if (id !== idProses) return;

    // Pastikan ZXing sudah termuat (kalau belum, tunggu)
    if (!pustakaSiap()) setStatus(STATUS_MEMUAT);
    try {
      await muatPustaka();
    } catch (e) {
      if (id !== idProses) return;
      sedangProses = false;
      pulihkanDropzone();
      tampilkanGagal(PESAN_GAGAL_MUAT);
      return;
    }
    if (id !== idProses) return;
    setStatus(STATUS_MEMBACA);

    var teks = null;
    try {
      var hasil = await ambilPembaca().decodeFromImageElement(img);
      teks = hasil.getText();
    } catch (e) {
      teks = null; // tidak ada kode terbaca
    }
    if (id !== idProses) return;

    sedangProses = false;
    pulihkanDropzone();
    if (teks) tampilkanHasil(teks);
    else tampilkanGagal(PESAN_TIDAK_TERBACA);
  }

  // Lebih dari satu file → ambil yang pertama saja
  function terimaFile(daftarFile) {
    if (!daftarFile || daftarFile.length === 0) return;
    prosesFile(daftarFile[0]);
  }

  // =====================================================================
  // Init: dipanggil app.js saat tab Scan dibuka
  // =====================================================================

  function initScanner() {
    if (pustakaSiap() || promisePustaka) return;

    setStatus(STATUS_MEMUAT);
    btnPilih.disabled = true;
    muatPustaka().then(function () {
      btnPilih.disabled = false;
      if (!sedangProses) pulihkanDropzone();
    }, function () {
      btnPilih.disabled = false;
      if (!sedangProses) {
        pulihkanDropzone();
        tampilkanError(PESAN_GAGAL_MUAT);
      }
    });
  }

  window.initScanner = initScanner;

  // =====================================================================
  // Event
  // =====================================================================

  // Klik di drop zone (termasuk tombol Pilih file) membuka file picker
  dropzone.addEventListener('click', function (e) {
    if (e.target === inputFile) return;
    inputFile.click();
  });

  inputFile.addEventListener('change', function () {
    var daftar = Array.prototype.slice.call(inputFile.files);
    inputFile.value = '';
    terimaFile(daftar);
  });

  // Drag and drop
  ['dragenter', 'dragover'].forEach(function (nama) {
    dropzone.addEventListener(nama, function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dropzone.classList.add('is-dragover');
    });
  });

  dropzone.addEventListener('dragleave', function (e) {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('is-dragover');
  });

  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    if (e.dataTransfer) terimaFile(e.dataTransfer.files);
  });

  // Salin teks hasil scan (teks asli dari ZXing, bukan dari kotak teks)
  btnSalin.addEventListener('click', async function () {
    if (hasilTerakhir === null) return;
    var berhasil = await salinKeClipboard(hasilTerakhir);
    clearTimeout(timerLabelSalin);
    btnSalin.textContent = berhasil ? 'Disalin ✓' : 'Gagal menyalin';
    timerLabelSalin = setTimeout(function () {
      btnSalin.textContent = LABEL_SALIN_AWAL;
    }, JEDA_LABEL_MS);
  });

  // Buka link: HANYA saat tombol ditekan pengguna
  btnBukaLink.addEventListener('click', function () {
    if (hasilTerakhir !== null && adalahLink(hasilTerakhir)) {
      window.open(hasilTerakhir, '_blank', 'noopener');
    }
  });

  btnHapus.addEventListener('click', function () {
    resetSemua();
    btnPilih.focus(); // tombol Hapus tersembunyi, pindahkan fokus ke Pilih file
  });
})();
