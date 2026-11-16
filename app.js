// app.js — Logika Binar QR
// T0: pindah tab dan fokus awal. T1/T2-fix: generator QR berbasis tombol (tab Buat QR).
// Helper bersama (hitungByteUTF8, teksKeByteUTF8, buatSlugNamaFile) ada di utils.js.

(function () {
  'use strict';

  // ---------- Konstanta generator ----------
  var BATAS_BYTE = 2331;        // kapasitas QR versi 40, level koreksi M, mode byte
  var QUIET_ZONE = 4;           // modul putih di tiap sisi
  var UKURAN_DOWNLOAD = 1024;   // px
  var UKURAN_PREVIEW_MAKS = 512; // px, kira-kira (dibulatkan ke kelipatan modul)
  var MAKS_TEKS_TAMPIL = 60;

  // ---------- Elemen ----------
  var tabBuat = document.getElementById('tab-buat');
  var tabScan = document.getElementById('tab-scan');
  var panelBuat = document.getElementById('panel-buat');
  var panelScan = document.getElementById('panel-scan');
  var inputTeks = document.getElementById('input-teks');
  var infoByte = document.getElementById('info-byte');
  var pesanPreview = document.getElementById('preview-kosong');
  var wadahQR = document.getElementById('qr-wadah');
  var namaFileEl = document.getElementById('nama-file');
  var btnDownload = document.getElementById('btn-download');
  var btnBuat = document.getElementById('btn-buat');
  var btnBuatBaru = document.getElementById('btn-buat-baru');
  var kolomKanan = panelBuat.querySelector('.kolom-kanan');
  var aksiBuat = panelBuat.querySelector('.aksi-buat');
  var dialogQR = document.getElementById('dialog-qr');
  var dialogCanvas = document.getElementById('dialog-qr-canvas');
  var btnTutupDialog = document.getElementById('btn-tutup-dialog');

  // Teks empty state dibaca dari HTML, bukan ditulis ulang di sini, supaya
  // hanya ada satu sumber kebenaran untuk kalimat itu.
  var PESAN_KOSONG = pesanPreview.textContent;


  // Tidak ada objek QR atau nama file yang disimpan di variabel. Preview adalah canvas
  // yang membawa teks sumbernya sendiri (data-teks) dan lenyap bersamanya; Download dan
  // dialog membuat ulang QR dari teks itu saat ditekan, jadi keduanya selalu mengikuti
  // QR yang tampil — bukan isi kolom ketik, yang bisa sudah berubah.

  // =====================================================================
  // QR diperbesar (integrasi)
  // =====================================================================

  // Klik QR di preview → tampil besar di dialog. QR dibuat ulang dari teks sumber
  // QR yang sedang tampil (buatDariTampil), bukan dari kolom ketik, supaya yang
  // diperbesar sama dengan yang terlihat — tidak ada QR yang disimpan di variabel.
  function bukaQRBesar() {
    var hasil = buatDariTampil();
    if (hasil.kosong || hasil.galat) return;
    gambarQR(dialogCanvas, hasil.qr, 640);
    if (typeof dialogQR.showModal === 'function') dialogQR.showModal();
  }

  wadahQR.addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'CANVAS') bukaQRBesar();
  });

  // Canvas preview bisa difokuskan keyboard; Enter/Spasi membukanya juga
  wadahQR.addEventListener('keydown', function (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || e.target.tagName !== 'CANVAS') return;
    e.preventDefault();
    bukaQRBesar();
  });

  // Klik latar dialog menutupnya; tombol Tutup juga; Esc ditangani <dialog>
  // (guard typeof: browser sangat lama tanpa <dialog> tetap tidak error)
  dialogQR.addEventListener('click', function (e) {
    if (e.target === dialogQR && typeof dialogQR.close === 'function') dialogQR.close();
  });
  btnTutupDialog.addEventListener('click', function () {
    if (typeof dialogQR.close === 'function') dialogQR.close();
  });

  // =====================================================================
  // Pindah tab (T0)
  // =====================================================================
  var daftarTab = [
    { tab: tabBuat, panel: panelBuat },
    { tab: tabScan, panel: panelScan }
  ];

  // Tampilkan satu tab, sembunyikan yang lain
  function pilihTab(tabTerpilih) {
    daftarTab.forEach(function (item) {
      var aktif = item.tab === tabTerpilih;
      item.tab.classList.toggle('is-active', aktif);
      item.tab.setAttribute('aria-selected', aktif ? 'true' : 'false');
      item.tab.tabIndex = aktif ? 0 : -1;
      item.panel.hidden = !aktif;
    });

    // Muat scanner (ZXing) saat tab Scan pertama kali dibuka; fungsi ada di scanner.js
    if (tabTerpilih === tabScan && typeof window.initScanner === 'function') {
      window.initScanner();
    }
  }

  daftarTab.forEach(function (item, i) {
    item.tab.addEventListener('click', function () {
      pilihTab(item.tab);
    });


    // Panah kanan = tab berikutnya, panah kiri = tab sebelumnya (berputar di ujung)
    item.tab.addEventListener('keydown', function (e) {
      var n = daftarTab.length;
      var arah;
      if (e.key === 'ArrowRight') arah = 1;
      else if (e.key === 'ArrowLeft') arah = -1;
      else return;
      var tujuan = daftarTab[(i + arah + n) % n].tab;
      pilihTab(tujuan);
      tujuan.focus();
      e.preventDefault();
    });
  });

  // =====================================================================
  // Generator QR (T1)
  // =====================================================================

  // Buat objek QR dari teks. Level koreksi M, ukuran otomatis (tipe 0).
  // Encoder bawaan library memotong karakter non-ASCII (c & 0xff), jadi
  // diganti ke UTF-8 supaya isi QR persis sama dengan teks input.
  function buatQR(teks) {
    qrcode.stringToBytes = teksKeByteUTF8;
    var qr = qrcode(0, 'M');
    qr.addData(teks, 'Byte');
    qr.make();
    return qr;
  }

  // Gambar QR ke canvas ukuran persegi `ukuran` px.
  // Dipakai preview dan download supaya quiet zone dihitung dengan cara sama.
  function gambarQR(canvas, qr, ukuran) {

    var jumlah = qr.getModuleCount();
    var total = jumlah + QUIET_ZONE * 2;
    var ukuranModul = ukuran / total;

    canvas.width = ukuran;
    canvas.height = ukuran;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ukuran, ukuran);
    ctx.fillStyle = '#000000';

    for (var baris = 0; baris < jumlah; baris++) {
      var y0 = Math.round((baris + QUIET_ZONE) * ukuranModul);
      var y1 = Math.round((baris + QUIET_ZONE + 1) * ukuranModul);
      var kol = 0;
      while (kol < jumlah) {
        if (!qr.isDark(baris, kol)) { kol++; continue; }
        // Gabungkan modul hitam berurutan jadi satu persegi panjang
        var mulai = kol;
        while (kol < jumlah && qr.isDark(baris, kol)) kol++;
        var x0 = Math.round((mulai + QUIET_ZONE) * ukuranModul);
        var x1 = Math.round((kol + QUIET_ZONE) * ukuranModul);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  // Ukuran preview: kelipatan bulat dari jumlah modul supaya tepinya tajam
  function ukuranPreview(qr) {
    var total = qr.getModuleCount() + QUIET_ZONE * 2;
    return total * Math.max(1, Math.floor(UKURAN_PREVIEW_MAKS / total));

  }

  // Potong teks untuk ditampilkan di bawah QR (hanya tampilan, bukan isi QR)
  function potongUntukTampil(teks) {
    var huruf = Array.from(teks);
    if (huruf.length <= MAKS_TEKS_TAMPIL) return teks;
    return huruf.slice(0, MAKS_TEKS_TAMPIL).join('') + '...';
  }

  function setInfoByte(byte) {
    infoByte.textContent = byte + ' / ' + BATAS_BYTE + ' byte';
    infoByte.classList.toggle('is-over', byte > BATAS_BYTE);
  }

  // Kosongkan QR, matikan tombol Download, kembalikan nama file ke "—"
  function resetHasil() {
    wadahQR.replaceChildren();
    namaFileEl.textContent = 'Nama file: —';
    btnDownload.disabled = true;
  }

  // Tampilkan pesan di area preview (empty state atau error)
  function tampilkanPesan(teks, adalahError) {
    pesanPreview.textContent = teks;
    pesanPreview.classList.toggle('is-error', !!adalahError);
    pesanPreview.hidden = false;
  }

  function tampilkanKosong() {
    resetHasil();
    setInfoByte(0);
    tampilkanPesan(PESAN_KOSONG, false);

  }

  function tampilkanQR(teks, qr) {
    var canvas = document.createElement('canvas');
    canvas.className = 'qr-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Kode QR dari teks yang kamu masukkan — ketuk untuk memperbesar');
    canvas.setAttribute('title', 'Ketuk untuk memperbesar');
    canvas.setAttribute('tabindex', '0');
    // Teks sumber QR ini, menempel pada elemen yang menampilkannya: satu pemilik, dan
    // ikut hilang saat preview dikosongkan (Buat Baru, gagal) sehingga tidak bisa basi
    canvas.dataset.teks = teks;
    gambarQR(canvas, qr, ukuranPreview(qr));

    var teksTampil = document.createElement('p');
    teksTampil.className = 'qr-teks';
    teksTampil.textContent = potongUntukTampil(teks);

    wadahQR.replaceChildren(canvas, teksTampil);
    pesanPreview.hidden = true;
  }

  // Pemilik tunggal tampilan tab Buat QR. Kolom ketik (label, textarea, info byte)
  // selalu terlihat di desktop; empat keadaan menentukan sisanya, semuanya turunan dari satu
  // argumen sehingga bagian-bagiannya tidak bisa saling bertentangan:
  //   'awal'         — tombol Buat QR saja (kolom hasil dan aksi tersembunyi)
  //   'hasil'        — QR berhasil: tombol Buat QR hilang; Download + Buat Baru tampil;
  //                    QR + teks + nama file tampil di kolom hasil
  //   'hasil-diubah' — teks diedit setelah 'hasil': Buat QR muncul lagi di tempatnya
  //                    (di bawah info byte); QR di preview tetap yang lama sampai Buat
  //                    ditekan lagi, yang membawa kembali ke 'hasil'
  //   'gagal'        — Buat QR tetap tampil supaya teks bisa diperbaiki dan dibuat ulang;
  //                    pesan (kosong/terlalu panjang) ada di preview, di kolom hasil
  // class mode-hasil (hasil dan hasil-diubah) hanya dipakai CSS layar sempit (<900px):
  // kolom ketik disembunyikan, QR di atas dan tombol tepat di bawahnya. "Kolom ketik
  // selalu terlihat" di atas berlaku untuk desktop.
  var keadaanBuat = 'awal';

  function aturTampilanBuat(keadaan) {
    keadaanBuat = keadaan;
    btnBuat.hidden = keadaan === 'hasil';
    aksiBuat.hidden = keadaan === 'awal';
    kolomKanan.hidden = keadaan === 'awal';
    panelBuat.classList.toggle('mode-hasil', keadaan === 'hasil' || keadaan === 'hasil-diubah');
  }

  // Hanya spasi/newline di awal dan akhir yang dibuang; isi tengah tidak diubah
  function bacaInput() {
    return inputTeks.value.trim();
  }

  // Pintu untuk "Buat QR": validasi + buat QR dari isi kolom ketik saat ini. Satu-satunya
  // tempat batas byte diperiksa; Download dan dialog tidak lewat sini (lihat buatDariTampil).
  // Hasil: { kosong: true } | { galat: pesan } | { teks, qr }
  function buatDariInput() {
    var teks = bacaInput();
    if (teks === '') return { kosong: true };

    var byte = hitungByteUTF8(teks);
    if (byte > BATAS_BYTE) {
      return { galat: 'Teks terlalu panjang (' + byte + ' / ' + BATAS_BYTE +

        ' byte). QR tidak bisa dibuat — pendekkan dulu teksnya.' };
    }

    return buatQRAman(teks);
  }

  // Buat QR dari teks; galat library dibungkus jadi pesan, sama untuk semua pemanggil
  function buatQRAman(teks) {
    try {
      return { teks: teks, qr: buatQR(teks) };
    } catch (e) {
      return { galat: 'QR gagal dibuat. Coba pendekkan teksnya.' };
    }
  }

  // Pintu untuk Download dan dialog: QR yang SEDANG TAMPIL, dibuat ulang dari teks
  // sumbernya (batas byte sudah lolos saat Buat). Kolom ketik tidak dibaca di sini.
  // Hasil: { kosong: true } (tidak ada QR tampil) | { galat: pesan } | { teks, qr }
  function buatDariTampil() {
    var canvas = wadahQR.querySelector('canvas');
    if (!canvas) return { kosong: true };
    return buatQRAman(canvas.dataset.teks);
  }

  // Penghitung byte ikut isi input (tanpa debounce, tidak membuat QR)
  function perbaruiByte() {
    setInfoByte(hitungByteUTF8(bacaInput()));
  }

  // Tombol "Buat QR": satu-satunya tempat QR di preview dibuat
  btnBuat.addEventListener('click', function () {
    var hasil = buatDariInput();

    if (hasil.kosong) {
      tampilkanKosong();
      aturTampilanBuat('gagal');
      inputTeks.focus();
      return;
    }
    if (hasil.galat) {
      resetHasil();
      tampilkanPesan(hasil.galat, true);
      aturTampilanBuat('gagal');
      return;
    }

    // Semua bahan (QR, nama file) sudah jadi sebelum DOM disentuh
    var namaFile = buatSlugNamaFile(hasil.teks) + '.png';

    tampilkanQR(hasil.teks, hasil.qr);
    namaFileEl.textContent = 'Nama file: ' + namaFile;
    btnDownload.disabled = false;

    // Tombol Buat (yang sedang fokus) ikut hilang, jadi fokus dipindah ke Download.
    // Urutan penting: Download baru bisa difokus setelah grupnya tampil
    // (focus() pada elemen display:none diam-diam gagal).
    aturTampilanBuat('hasil');
    // preventScroll: fokus tidak boleh menggulung halaman; hasil harus terlihat dari atas
    btnDownload.focus({ preventScroll: true });
  });

  // Setiap perubahan teks memperbarui penghitung byte; kalau QR sedang tampil, tombol
  // Buat QR muncul lagi. Cukup satu event: tidak membandingkan dengan teks lama, jadi
  // tidak ada salinan teks/QR yang disimpan (aturan stateless).
  inputTeks.addEventListener('input', function () {
    perbaruiByte();
    if (keadaanBuat === 'hasil') aturTampilanBuat('hasil-diubah');
  });

  // Unduh blob lewat tautan sementara; tidak ada request ke server
  function unduhBlob(blob, namaFile) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = namaFile;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Beri jeda singkat supaya browser sempat memulai unduhan
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Download PNG 1024×1024. Dibuat dari QR yang sedang tampil (teks sumbernya dibawa
  // canvas preview), bukan dari kolom ketik: kalau teks diedit setelah "Buat QR", yang
  // terunduh tetap QR lama sampai Buat ditekan lagi.
  btnDownload.addEventListener('click', function () {
    var hasil = buatDariTampil();
    if (hasil.kosong) {
      namaFileEl.textContent = 'Isi link atau teks dulu, lalu tekan Download.';
      return;
    }
    if (hasil.galat) {
      namaFileEl.textContent = hasil.galat;
      return;

    }

    var nama = buatSlugNamaFile(hasil.teks) + '.png';
    var canvas = document.createElement('canvas');
    gambarQR(canvas, hasil.qr, UKURAN_DOWNLOAD);
    canvas.toBlob(function (blob) {
      if (!blob) {
        namaFileEl.textContent = 'Gagal membuat file PNG. Coba lagi.';
        return;
      }
      // Label menunjukkan nama file yang benar-benar terunduh
      namaFileEl.textContent = 'Nama file: ' + nama;
      unduhBlob(blob, nama);
    }, 'image/png');
  });

  // Tombol "Buat Baru": kosongkan input dan kembali ke keadaan awal
  btnBuatBaru.addEventListener('click', function () {
    inputTeks.value = '';
    tampilkanKosong();
    aturTampilanBuat('awal');
    inputTeks.focus();
  });

  // =====================================================================
  // Awal
  // =====================================================================

  // Keadaan awal ditetapkan lewat pemiliknya juga (HTML sudah menyembunyikan
  // kolom hasil dan aksi supaya tidak berkedip sebelum skrip jalan)
  aturTampilanBuat('awal');

  // Fokus otomatis ke kolom input saat halaman dimuat
  inputTeks.focus();

  // Kalau browser memulihkan isi textarea, penghitung byte ikut disesuaikan.
  // QR sengaja TIDAK dibuat otomatis; tetap menunggu tombol "Buat QR".

  perbaruiByte();
})();

// Pendaftaran Service Worker (snippet dari T3, verbatim): ditunda sampai load
// agar tidak bersaing dengan muat awal tab Buat QR.
if ('serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
