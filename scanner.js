// scanner.js — Logika scanner Binar QR
// Scan dari file gambar atau kamera live, semua diproses di perangkat.
// Urutan baca: jsQR dulu (QR), baru ZXing (barcode) kalau jsQR tidak menemukan apa-apa.
// Kedua library dimuat malas (lazy) saat tab Scan pertama kali dibuka.
// Memakai salinKeClipboard() dari utils.js.

(function () {
  'use strict';

  // ---------- Konstanta ----------
  var LOKASI_JSQR = 'lib/jsqr.min.js';
  var LOKASI_ZXING = 'lib/zxing-browser.min.js';
  var BATAS_UKURAN = 10 * 1024 * 1024; // 10 MB
  var JEDA_LABEL_MS = 2000;
  var BATAS_ZXING_MS = 10000; // satu percobaan decode ZXing
  var JEDA_FRAME_MS = 300;    // jeda antar percobaan baca frame kamera

  var PESAN_FILE_TIDAK_VALID = 'File harus berupa gambar (PNG/JPG/WEBP) dan maksimal 10 MB.';
  var PESAN_TIDAK_TERBACA = 'Tidak ada QR/barcode yang terbaca di gambar ini. Coba gambar yang lebih jelas, lebih besar, atau tidak terpotong.';
  var PESAN_GAGAL_MUAT = 'Gagal memuat scanner. Coba muat ulang halaman.';
  var PESAN_GAMBAR_RUSAK = 'Gambar tidak bisa dibuka. Coba file gambar lain.';
  var PESAN_KAMERA = 'Kamera tidak bisa dibuka. Periksa izin kamera di browser, lalu coba lagi — scan dari file tetap bisa dipakai.';
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
  var panelScan = document.getElementById('panel-scan');
  var tabBuat = document.getElementById('tab-buat');
  var btnKamera = document.getElementById('btn-kamera');
  var areaKamera = document.querySelector('.area-kamera');
  var video = document.getElementById('video-kamera');
  var btnTutupKamera = document.getElementById('btn-tutup-kamera');

  // Teks awal diambil dari HTML supaya tidak ditulis dua kali
  var TEKS_DROPZONE_AWAL = teksDropzone.textContent;
  var LABEL_SALIN_AWAL = btnSalin.textContent;

  // ---------- Status (hanya di memori, tidak disimpan) ----------
  var promiseMuat = {};        // lokasi skrip → promise pemuatan; dihapus kalau gagal
  var sedangMemuatAwal = false; // initScanner sedang menunggu kedua library
  var pembaca = null;          // instance BrowserMultiFormatReader
  var hasilTerakhir = null;    // teks hasil scan persis seperti dibaca decoder
  var urlGambar = null;        // object URL gambar yang sedang ditampilkan
  var idProses = 0;            // penanda proses file terbaru; proses lama diabaikan
  var sedangProses = false;
  var timerLabelSalin = null;
  // Satu-satunya pemilik status kamera: null = mati. Siapa pun yang membatalkan
  // (tombol, tab, halaman tersembunyi, scan file) cukup memanggil hentikanKamera();
  // kerja async yang tertunda membandingkan sesi-nya dengan ini lalu berhenti sendiri.
  var sesiKamera = null;       // { stream, timer } selama kamera dibuka / aktif
  // true dari saat hasil/kegagalan scan tampil sampai "Scan lagi". Bersama sesiKamera,
  // inilah satu-satunya bahan keputusan tampilnya tombol Buka kamera.
  var scanSelesai = false;
  // field-sizing: content (CSS) mengatur tinggi kotak hasil; JS hanya mengisi kekosongan
  // di peramban yang belum mendukungnya (mis. Safari sebelum 26.2).
  var FIELD_SIZING_ADA = !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));

  // Satu kanvas dipakai ulang untuk jsQR (butuh piksel) dan ZXing frame kamera
  var kanvasBaca = document.createElement('canvas');
  var ctxBaca = null;

  // =====================================================================
  // Lazy load jsQR dan ZXing
  // =====================================================================

  function jsqrSiap() { return typeof window.jsQR === 'function'; }

  function zxingSiap() {
    return !!(window.ZXing && window.ZXing.BrowserMultiFormatReader);
  }

  // Muat satu skrip sekali saja. Gagal → boleh dicoba lagi nanti.
  function muatSkrip(lokasi, siap) {
    if (siap()) return Promise.resolve();
    if (promiseMuat[lokasi]) return promiseMuat[lokasi];

    var p = new Promise(function (selesai, gagal) {
      var s = document.createElement('script');
      s.src = lokasi;
      s.onload = function () {
        if (siap()) selesai();
        else gagal(new Error('Global library tidak ditemukan: ' + lokasi));
      };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        gagal(new Error('Gagal memuat ' + lokasi));
      };
      document.head.appendChild(s);
    });

    promiseMuat[lokasi] = p;
    p.catch(function () { promiseMuat[lokasi] = null; });
    return p;
  }

  function muatJsQR() { return muatSkrip(LOKASI_JSQR, jsqrSiap); }
  function muatZXing() { return muatSkrip(LOKASI_ZXING, zxingSiap); }
  function muatKeduanya() { return Promise.all([muatJsQR(), muatZXing()]); }

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
  // Decode
  // =====================================================================

  // Gambar ke kanvas bersama dan kembalikan pikselnya. Latar putih dulu: piksel
  // transparan di PNG akan terbaca hitam oleh jsQR dan menenggelamkan QR-nya.
  function ambilPiksel(sumber, lebar, tinggi) {
    if (!ctxBaca) ctxBaca = kanvasBaca.getContext('2d', { willReadFrequently: true });
    if (kanvasBaca.width !== lebar) kanvasBaca.width = lebar;
    if (kanvasBaca.height !== tinggi) kanvasBaca.height = tinggi;
    ctxBaca.fillStyle = '#ffffff';
    ctxBaca.fillRect(0, 0, lebar, tinggi);
    ctxBaca.drawImage(sumber, 0, 0, lebar, tinggi);
    return ctxBaca.getImageData(0, 0, lebar, tinggi);
  }

  // jsQR: null kalau tidak ada QR (atau kanvas gagal, mis. gambar terlalu besar
  // untuk memori — lanjut saja ke ZXing).
  function dekodeJsQR(sumber, lebar, tinggi) {
    try {
      var piksel = ambilPiksel(sumber, lebar, tinggi);
      // jsQR menerima array piksel (.data), bukan objek ImageData-nya
      var hasil = window.jsQR(piksel.data, piksel.width, piksel.height,
        { inversionAttempts: 'attemptBoth' });
      return hasil && hasil.data ? hasil.data : null;
    } catch (e) {
      return null;
    }
  }

  // Semua decode ZXing lewat sini. Timer hanya bisa memutus decode yang menunggu
  // secara async; decode yang berjalan sinkron di main thread tidak bisa dipotong
  // dari sini (batas library, bukan kelalaian) — yang dijamin: promise ini selalu selesai.
  // Lewat batas → ditolak, pemanggil menganggapnya "tidak terbaca".
  function dekodeZXing(kerja) {
    return new Promise(function (selesai, gagal) {
      var timer = setTimeout(function () {
        gagal(new Error('Decode ZXing melewati batas waktu'));
      }, BATAS_ZXING_MS);
      Promise.resolve().then(kerja).then(
        function (hasil) { clearTimeout(timer); selesai(hasil.getText()); },
        function (e) { clearTimeout(timer); gagal(e); }
      );
    });
  }

  // ZXing dari kanvas bersama (frame yang sama dengan yang baru dibaca jsQR).
  // BrowserMultiFormatReader tidak punya decode-dari-kanvas; urutan binarizer
  // sama dengan decode() bawaannya: Hybrid dulu, Global Histogram sebagai cadangan.
  function dekodeKanvasZXing() {
    var Z = window.ZXing;
    var sumber = new Z.HTMLCanvasElementLuminanceSource(kanvasBaca, false);
    var galat = null;
    var binarizer = [Z.HybridBinarizer, Z.GlobalHistogramBinarizer];
    for (var i = 0; i < binarizer.length; i++) {
      try {
        return ambilPembaca().decodeBitmap(new Z.BinaryBitmap(new binarizer[i](sumber)));
      } catch (e) {
        galat = e;
      }
    }
    throw galat;
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

  // Pemilik tunggal tampilnya tombol Buka kamera: tampil hanya di keadaan awal,
  // yaitu tidak ada kamera yang sedang menampilkan stream dan tidak ada scan yang selesai.
  function perbaruiTombolKamera() {
    var kameraTampil = !!(sesiKamera && sesiKamera.stream);
    btnKamera.hidden = kameraTampil || scanSelesai;
  }

  // Cadangan tinggi kotak hasil tanpa field-sizing. Batas maksimum (4 baris) tetap
  // milik CSS (max-block-size), jadi di sini cukup ukur isi penuhnya. Kotak yang
  // sedang tidak terlihat (tab lain) tidak bisa diukur — dilewati, diukur lagi saat tampil.
  function sesuaikanKotakHasil() {
    if (FIELD_SIZING_ADA || kotakHasil.hidden || !kotakHasil.clientWidth) return;
    kotakHasil.style.height = 'auto';
    var gaya = getComputedStyle(kotakHasil);
    var garis = parseFloat(gaya.borderTopWidth) + parseFloat(gaya.borderBottomWidth);
    kotakHasil.style.height = (kotakHasil.scrollHeight + garis) + 'px';
  }

  function sembunyikanHasil() {
    hasilTerakhir = null;
    scanSelesai = false;
    perbaruiTombolKamera();
    kotakHasil.value = '';
    kotakHasil.style.height = '';
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

  // Kembali ke keadaan kosong awal (kamera tidak disentuh; lihat hentikanKamera)
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
    scanSelesai = true;
    perbaruiTombolKamera();
    sesuaikanKotakHasil(); // setelah kotak terlihat; tinggi tidak bisa diukur saat hidden
  }

  function tampilkanGagal(pesan) {
    tampilkanError(pesan);
    dropzone.hidden = true;
    btnHapus.hidden = false;
    scanSelesai = true;
    perbaruiTombolKamera();
  }

  // =====================================================================
  // Validasi dan proses file
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
    hentikanKamera(); // satu scan aktif: scan file menghentikan kamera
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

    // Tahap 1: jsQR untuk QR (tunggu kalau belum termuat)
    if (!jsqrSiap()) setStatus(STATUS_MEMUAT);
    try {
      await muatJsQR();
    } catch (e) {
      if (id !== idProses) return;
      sedangProses = false;
      pulihkanDropzone();
      tampilkanGagal(PESAN_GAGAL_MUAT);
      return;
    }
    if (id !== idProses) return;
    setStatus(STATUS_MEMBACA);

    var teks = dekodeJsQR(img, img.naturalWidth, img.naturalHeight);

    // Tahap 2: ZXing untuk barcode, hanya kalau jsQR tidak menemukan apa-apa
    if (!teks) {
      if (!zxingSiap()) setStatus(STATUS_MEMUAT);
      try {
        await muatZXing();
      } catch (e) {
        if (id !== idProses) return;
        sedangProses = false;
        pulihkanDropzone();
        tampilkanGagal(PESAN_GAGAL_MUAT);
        return;
      }
      if (id !== idProses) return;
      setStatus(STATUS_MEMBACA);

      try {
        teks = await dekodeZXing(function () {
          return ambilPembaca().decodeFromImageElement(img);
        });
      } catch (e) {
        teks = null; // tidak ada kode terbaca, atau melewati batas waktu
      }
      if (id !== idProses) return;
    }

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
  // Kamera live
  // =====================================================================

  function hentikanStream(stream) {
    stream.getTracks().forEach(function (t) { t.stop(); });
  }

  // Satu-satunya jalan mematikan kamera. Aman dipanggil kapan saja, berulang kali.
  function hentikanKamera() {
    if (!sesiKamera) return;
    var sesi = sesiKamera;
    sesiKamera = null; // dulu: kerja async yang tertunda melihat sesinya sudah bukan yang aktif
    clearTimeout(sesi.timer);
    if (sesi.stream) hentikanStream(sesi.stream);
    video.srcObject = null;
    areaKamera.hidden = true;
    perbaruiTombolKamera();
  }

  // Baca satu frame: jsQR dulu, ZXing di frame yang sama kalau kosong.
  async function bacaFrame() {
    // Frame belum tersedia (stream baru mulai): lewati, putaran berikut mencoba lagi
    if (video.readyState < 2 || !video.videoWidth) return null;
    var teks = dekodeJsQR(video, video.videoWidth, video.videoHeight);
    if (teks) return teks;
    try {
      return await dekodeZXing(() => dekodeKanvasZXing());
    } catch (e) {
      return null;
    }
  }

  // Putaran berikutnya baru dijadwalkan setelah decode sebelumnya selesai, jadi
  // tidak pernah ada dua decode bersamaan (tidak memakai setInterval).
  async function putaranKamera(sesi) {
    if (sesiKamera !== sesi) return;
    var teks = await bacaFrame();
    if (sesiKamera !== sesi) return;
    if (teks) {
      hentikanKamera();
      tampilkanHasil(teks);
      return;
    }
    sesi.timer = setTimeout(function () { putaranKamera(sesi); }, JEDA_FRAME_MS);
  }

  async function mulaiKamera() {
    if (sesiKamera) return; // sudah membuka / aktif
    resetSemua(); // satu scan aktif: membuka kamera mengosongkan hasil file

    var sesi = { stream: null, timer: null };
    sesiKamera = sesi;

    try {
      await muatKeduanya();
    } catch (e) {
      if (sesiKamera === sesi) {
        sesiKamera = null;
        tampilkanError(PESAN_GAGAL_MUAT);
      }
      return;
    }
    if (sesiKamera !== sesi) return;

    var stream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia tidak tersedia');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch (e) {
      if (sesiKamera === sesi) {
        sesiKamera = null;
        tampilkanError(PESAN_KAMERA);
      }
      return;
    }
    // Dibatalkan selagi menunggu izin: stream yang baru datang tidak boleh dibiarkan hidup
    if (sesiKamera !== sesi) {
      hentikanStream(stream);
      return;
    }

    sesi.stream = stream;
    video.srcObject = stream;
    areaKamera.hidden = false;
    perbaruiTombolKamera();

    try {
      await video.play();
    } catch (e) {
      if (sesiKamera === sesi) {
        hentikanKamera();
        tampilkanError(PESAN_KAMERA);
      }
      return;
    }
    if (sesiKamera !== sesi) return;

    putaranKamera(sesi);
  }

  // =====================================================================
  // Init: dipanggil app.js saat tab Scan dibuka
  // =====================================================================

  function initScanner() {
    if ((jsqrSiap() && zxingSiap()) || sedangMemuatAwal) return;

    sedangMemuatAwal = true;
    setStatus(STATUS_MEMUAT);
    btnPilih.disabled = true;
    muatKeduanya().then(function () {
      sedangMemuatAwal = false;
      btnPilih.disabled = false;
      if (!sedangProses) setStatus(TEKS_DROPZONE_AWAL);
    }, function () {
      sedangMemuatAwal = false;
      btnPilih.disabled = false;
      if (!sedangProses) {
        setStatus(TEKS_DROPZONE_AWAL);
        if (hasilTerakhir === null) tampilkanError(PESAN_GAGAL_MUAT);
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

  // Salin teks hasil scan (teks asli dari decoder, bukan dari kotak teks)
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
    resetSemua(); // kembali ke tampilan awal Scan, termasuk tombol Buka kamera
    btnPilih.focus(); // tombol Scan lagi tersembunyi, pindahkan fokus ke Pilih file
  });

  // ----- Kamera -----
  btnKamera.addEventListener('click', mulaiKamera);
  btnTutupKamera.addEventListener('click', hentikanKamera);

  // app.js tidak boleh diubah, jadi kamera dimatikan dari sini. Klik tab Buat QR
  // saja tidak cukup: perpindahan tab lewat keyboard bisa memanggil pilihTab()
  // tanpa klik, maka panel Scan yang tersembunyi diawasi juga.
  tabBuat.addEventListener('click', hentikanKamera);
  new MutationObserver(function () {
    if (panelScan.hidden) hentikanKamera();
    else sesuaikanKotakHasil(); // lebar bisa berubah selagi tab lain terbuka
  }).observe(panelScan, { attributes: true, attributeFilter: ['hidden'] });

  // Lebar berubah (putar layar) → pembungkusan baris berubah → tinggi diukur ulang
  window.addEventListener('resize', sesuaikanKotakHasil);

  // Halaman disembunyikan (ganti aplikasi, kunci layar): lepas kamera
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hentikanKamera();
  });
})();
