# Sniper Lelang

Aplikasi lokal untuk menawar otomatis di **detik-detik terakhir** lelang online (target awal: [lelang.go.id](https://lelang.go.id)). Anda mengisi data lot dan batas harga lewat tampilan web, lalu bot menunggu dan mengirim penawaran tepat pada waktu yang ditentukan.

> Penawaran di lelang bersifat mengikat. Baca bagian [Keamanan dan tanggung jawab](#keamanan-dan-tanggung-jawab) sebelum memakai mode nyata.

## Daftar isi

1. [Tujuan dan kegunaan](#tujuan-dan-kegunaan)
2. [Fitur](#fitur)
3. [Cara kerja singkat](#cara-kerja-singkat)
4. [Persyaratan](#persyaratan)
5. [Struktur folder](#struktur-folder)
6. [Menjalankan aplikasi](#menjalankan-aplikasi)
7. [Panduan pemakaian lengkap](#panduan-pemakaian-lengkap)
8. [Penjelasan semua pengaturan](#penjelasan-semua-pengaturan)
9. [Arti status hasil](#arti-status-hasil)
10. [Pemecahan masalah](#pemecahan-masalah)
11. [Keamanan dan tanggung jawab](#keamanan-dan-tanggung-jawab)
12. [Batasan saat ini](#batasan-saat-ini)
13. [Pengembangan dan pengujian](#pengembangan-dan-pengujian)
14. [Rencana berikutnya](#rencana-berikutnya)

## Tujuan dan kegunaan

**Masalah yang diselesaikan.** Di banyak lelang, harga baru bergerak serius di menit dan detik terakhir. Menawar manual di saat itu sulit: koneksi bisa lambat, waktu klik tidak presisi, dan Anda harus menunggu di depan layar.

**Tujuan aplikasi.** Menembakkan satu penawaran yang lebih tinggi dari harga terakhir pada detik akhir yang Anda tentukan, dengan batas harga yang tidak akan dilewati, sehingga peluang menang lebih besar tanpa harus menunggui layar.

**Cocok untuk:**
- Peserta lelang yang sudah punya akun dan sudah menentukan harga maksimal.
- Pengguna yang ingin penawaran terkirim tepat waktu, bukan terlalu cepat (memancing penawar lain) atau terlalu lambat (kalah).

## Fitur

- **Dua mode penawaran.** *Auto*: harga terakhir + kelipatan kenaikan. *Custom*: nominal tetap yang Anda tentukan.
- **Batas harga (`maxBid`).** Bot tidak pernah menembak di atas batas ini. Bila tidak cukup, bot membatalkan diri dan tidak mengirim apa pun.
- **Mode uji (dry-run) aktif secara default.** Semua langkah berjalan, kecuali pengiriman bid.
- **Waktu tembak presisi.** Bot menyinkronkan jam dengan server, menghitung latensi jaringan, lalu menunggu sampai milidetik yang tepat.
- **Impor dari cURL.** Tempel hasil *Copy as cURL* dari DevTools (format bash maupun Windows cmd); URL, cookie, header, dan body terisi otomatis.
- **Pilih path dengan klik.** Aplikasi menampilkan isi respons JSON dan menebak field harga dan waktu tutup.
- **Tes koneksi dengan simulasi.** Menampilkan harga dan waktu tutup yang terbaca, nominal yang akan ditembak, dan peringatan bila ada yang janggal.
- **Hitung mundur dan log langsung**, serta tombol **Berhenti** kapan saja.
- **Berjalan lokal.** Server hanya menerima sambungan dari komputer Anda sendiri (`127.0.0.1`). Tanpa dependency tambahan.

## Cara kerja singkat

```
Sinkron jam server  ->  Pantau harga & waktu tutup (tiap 15 detik)
        ->  Masuk jendela tembak (4 detik sebelum waktu tembak)
        ->  Ambil harga terbaru, hitung nominal, validasi terhadap maxBid
        ->  Tunggu presisi  ->  Kirim bid  ->  Catat hasil
```

Waktu tembak dihitung sebagai: `waktu tutup - fireBeforeMs - latensi satu arah`. Dengan pengaturan bawaan, bid dikirim sekitar 2,5 detik sebelum lelang tutup. Bila waktu tutup diperpanjang oleh situs, jadwal ikut menyesuaikan selama bot masih memantau.

## Persyaratan

| Kebutuhan | Keterangan |
|---|---|
| Sistem operasi | Windows 10 atau lebih baru (macOS dan Linux juga bisa menjalankan Node) |
| Node.js | Versi 18 atau lebih baru (disarankan LTS terbaru dari [nodejs.org](https://nodejs.org)) |
| Browser | Chrome, Edge, atau Brave, untuk membuka tampilan dan mengambil data lewat DevTools |
| Akun | Akun lelang yang sudah terdaftar dan memenuhi syarat ikut lot (misalnya setoran jaminan) |
| Jaringan | Stabil. Kabel LAN lebih baik daripada Wi-Fi |

Tidak perlu `npm install`. Proyek ini tidak memakai dependency.

**Tips Windows saat bot berjalan:** matikan sleep dan hibernate, colokkan charger, dan aktifkan sinkron waktu otomatis (Settings, Time and language, Date and time, Sync now).

## Struktur folder

```
sniper-bot\
├── package.json
├── config.json            # dipakai mode CLI (opsional)
├── README.md
├── public\
│   └── index.html         # tampilan web
├── src\
│   ├── core.js            # inti bot (sinkron jam, hitung bid, tembak)
│   ├── server.js          # server web lokal
│   └── cli.js             # mode baris perintah
└── test\
    └── selftest.js        # tes mandiri dengan server lelang tiruan
```

## Menjalankan aplikasi

Buka PowerShell di folder proyek, lalu:

```powershell
node -v          # pastikan v18 atau lebih baru
npm run ui       # menjalankan server lokal
```

Buka **http://localhost:3210** di browser. Biarkan jendela PowerShell tetap terbuka selama bot bekerja, karena bot berjalan di sana, bukan di tab browser.

Untuk menghentikan server, tekan `Ctrl + C` di PowerShell.

Jika port 3210 sudah terpakai:

```powershell
$env:PORT = 3300
npm run ui
```

## Panduan pemakaian lengkap

### Langkah 0: Siapkan lot

1. Login ke situs lelang di browser.
2. Buka halaman lot yang akan diikuti dan pastikan Anda memang boleh menawar di lot itu.
3. Tentukan **harga maksimal** yang siap Anda bayar. Angka ini akan menjadi `maxBid`.
4. Catat **kelipatan kenaikan** yang berlaku pada lot tersebut (lihat aturan lot di situs).

### Langkah 1: Ambil data lot (harga dan waktu tutup)

1. Di halaman lot, tekan `F12` untuk membuka DevTools, lalu pilih tab **Network** dan filter **Fetch/XHR**.
2. Muat ulang halaman. Cari request yang respons JSON-nya memuat **harga tertinggi saat ini** dan **waktu selesai**.
3. Klik kanan request itu, pilih **Copy**, lalu **Copy as cURL (cmd)** (di Windows).
4. Di aplikasi, bagian **1. Data lot**, tempel ke kotak cURL lalu klik **Isi otomatis dari cURL**. Kolom `stateUrl`, cookie, dan header terisi.
5. Klik **Lihat isi respons dan pilih path**. Daftar field muncul. Pada baris yang benar, klik **Harga** untuk mengisi `pricePath`, dan **Waktu tutup** untuk mengisi `endTimePath`. Tombol hijau adalah tebakan otomatis, tetapi periksa nilainya, terutama bila ada beberapa field harga (misalnya harga limit dan harga penawaran tertinggi).

Catatan: `stateUrl` harus mengembalikan **JSON** dan memakai metode **GET**. Jika yang Anda isi adalah alamat halaman web biasa, aplikasi akan memberi tahu bahwa responsnya bukan JSON. Pada kasus itu, cari request XHR lain di tab Network.

### Langkah 2: Ambil format request penawaran

Bot perlu tahu persis bagaimana situs menerima penawaran. Cara paling mudah adalah merekam satu request penawaran yang asli.

> Merekam request penawaran berarti melakukan **satu penawaran sungguhan**, dan penawaran itu mengikat. Lakukan hanya di lot yang memang ingin Anda ikuti, dengan nominal yang siap Anda bayar.

1. Dengan DevTools (tab Network) tetap terbuka dan opsi **Preserve log** aktif, lakukan satu penawaran manual.
2. Cari request penawarannya (biasanya berjenis POST), lalu **Copy as cURL (cmd)**.
3. Di bagian **2. Kirim bid**, tempel ke kotak cURL.
4. Isi kolom **Nominal yang Anda tawar saat merekam** dengan angka yang tadi Anda tawar, lalu klik **Isi otomatis dari cURL**. Angka itu otomatis diganti penanda `{{amount}}` di `bidBody`.
5. Periksa `bidBody`: harus memuat `{{amount}}`. Jika angka nominal tidak terganti, ganti manual.

Jika Anda sudah tahu format request-nya, `bidUrl`, metode, dan `bidBody` boleh diisi langsung tanpa cURL.

### Langkah 3: Atur strategi

Bagian **3. Strategi**:

- **Mode Auto**: isi `increment` (kelipatan kenaikan lot) dan `maxBid`. Bid = harga terakhir + `increment` (dikali `stepsAbove`, lihat lanjutan). Jika `maxBid` tidak cukup untuk menaikkan harga, bot membatalkan diri.
- **Mode Custom**: isi `customBid` (nominal tetap) dan `maxBid`. Bot hanya menembak bila `customBid` lebih tinggi dari harga terakhir dan tidak melebihi `maxBid`.

Angka boleh ditulis dengan titik pemisah ribuan, misalnya `2.000.000`.

**Pengaturan lanjutan** (klik tulisan "Pengaturan lanjutan"):

- `stepsAbove`: naik berapa kelipatan di atas harga terakhir. Nilai 2 atau 3 memberi ruang bila ada penawar lain masuk antara pengambilan harga dan saat tembak. Nominal akhir tetap dibatasi `maxBid`.
- `fireBeforeMs`: berapa milidetik sebelum tutup bid dikirim (bawaan 2500).
- `refreshBeforeMs`: berapa milidetik sebelum waktu tembak harga diambil ulang (bawaan 4000).
- Zona waktu server, `serverTimePath`, dan header tambahan.

### Langkah 4: Tes koneksi

Klik **Tes koneksi**. Hasilnya menampilkan:

- harga terakhir dan waktu tutup yang terbaca (cocokkan dengan yang tampil di situs),
- selisih jam komputer dengan jam server dan latensi,
- **simulasi bid**: nominal yang akan ditembak bila bot jalan sekarang,
- **peringatan** (tulisan berwarna kuning), misalnya jam komputer melenceng, latensi tinggi, atau `maxBid` terlalu rendah.

Perbaiki semua peringatan yang relevan sebelum lanjut.

### Langkah 5: Latihan dengan mode uji

Pastikan kotak **Mode uji: jangan kirim bid** tercentang, lalu klik **Mulai**. Perhatikan:

- hitung mundur **Tembak dalam** dan **Lelang tutup dalam**,
- log di panel bawah,
- status akhir **Selesai (mode uji, tidak dikirim)**.

Latihan ini memastikan jadwal, nominal, dan koneksi berjalan benar tanpa risiko. Lakukan di lot yang waktu tutupnya dekat bila memungkinkan.

### Langkah 6: Mode nyata

1. Pastikan cookie masih berlaku. Bila sudah lama, login ulang di situs lalu salin cookie terbaru (lihat Langkah 1 atau 2).
2. Hilangkan centang **Mode uji**, lalu klik **Mulai**.
3. Aplikasi meminta konfirmasi yang menyebut batas `maxBid`. Teliti angkanya, lalu lanjutkan.
4. Biarkan komputer menyala, tersambung internet, dan jendela PowerShell tetap terbuka sampai status akhir muncul.
5. Setelah selesai, **cek hasilnya langsung di situs lelang** (apakah penawaran Anda tercatat dan siapa pemenangnya). Status di aplikasi hanya menunjukkan respons yang diterima dari server.

Kapan saja Anda ingin membatalkan, klik **Berhenti**. Bot berhenti dan tidak mengirim bid.

## Penjelasan semua pengaturan

| Pengaturan | Fungsi | Bawaan |
|---|---|---|
| `stateUrl` | Alamat (GET, JSON) yang memberi harga dan waktu tutup | wajib |
| `pricePath` | Letak harga di JSON, misalnya `data.harga_tertinggi` | wajib |
| `endTimePath` | Letak waktu tutup di JSON | wajib |
| `serverTimePath` | Letak jam server di JSON (opsional, meningkatkan akurasi) | kosong |
| `bidUrl` | Alamat tujuan pengiriman penawaran | wajib |
| Metode | POST, PUT, PATCH, atau GET | POST |
| `bidBody` | Isi request penawaran, harus memuat `{{amount}}` | wajib |
| Cookie sesi | Bukti login Anda | wajib untuk situs yang butuh login |
| Mode | `auto` atau `custom` | auto |
| `increment` | Kelipatan kenaikan (mode auto) | wajib di mode auto |
| `customBid` | Nominal tetap (mode custom) | wajib di mode custom |
| `maxBid` | Batas harga yang tidak akan dilewati | wajib |
| `stepsAbove` | Naik berapa kelipatan di atas harga terakhir | 1 |
| `fireBeforeMs` | Tembak sekian ms sebelum tutup | 2500 |
| `refreshBeforeMs` | Ambil harga ulang sekian ms sebelum waktu tembak | 4000 |
| Zona waktu | Dipakai bila waktu dari server tidak membawa zona | +07:00 |
| Header tambahan | Header lain dari cURL (JSON) | `{}` |

**Format yang dikenali otomatis:**
- Waktu: ISO (`2026-10-05T14:00:00+07:00`), `2026-10-05 14:00:00`, `05/10/2026 14:00:00`, serta epoch detik atau milidetik. Waktu tanpa zona dianggap WIB (sesuai pengaturan zona waktu).
- Harga: angka, `Rp 1.500.000,00`, atau `1,500,000.50`.

## Arti status hasil

| Status di aplikasi | Artinya |
|---|---|
| Siap tembak Rp ... | Nominal sudah dihitung, bot menunggu waktu tembak |
| Bid terkirim | Server menerima request dengan respons sukses (HTTP 2xx). Tetap cek di situs |
| Bid ditolak server (HTTP ...) | Request terkirim tetapi ditolak (nominal tidak valid, sesi habis, lelang tutup, dan sebagainya) |
| Selesai (mode uji, tidak dikirim) | Latihan selesai, tidak ada bid yang dikirim |
| Lelang sudah berakhir | Waktu tutup sudah lewat, bot tidak menembak |
| Dibatalkan: ... | Bot sengaja tidak menembak, misalnya `maxBid` tidak cukup atau waktu habis sebelum sempat kirim |
| Dihentikan | Anda menekan tombol Berhenti |
| Error: ... | Terjadi kesalahan (konfigurasi, jaringan, atau respons server). Baca pesannya |

## Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| "Respons stateUrl bukan JSON" | `stateUrl` berupa alamat halaman, atau cookie kedaluwarsa | Pakai request XHR yang membalas JSON; perbarui cookie |
| "stateUrl membalas HTTP 401/403" | Cookie tidak valid atau kedaluwarsa | Login ulang di situs, salin cookie baru |
| "pricePath ... tidak ditemukan di respons" | Path salah | Pakai tombol **Lihat isi respons** dan pilih dengan klik; pesan error juga menyebut contoh path |
| "pricePath ... bukan angka" | Path menunjuk ke field teks | Pilih field harga yang lain |
| "endTimePath ... bukan waktu yang dikenali" | Format waktu tidak umum | Pilih field waktu lain, atau kirim contoh formatnya untuk ditambahkan |
| Waktu tutup meleset 7 jam | Server mengirim waktu tanpa zona | Samakan **Zona waktu server** (WIB `+07:00`, UTC `+00:00`) |
| Peringatan "Jam komputer berbeda ... detik" | Jam Windows tidak akurat | Settings, Time and language, Sync now |
| "Simulasi bid gagal" | `maxBid` terlalu rendah, atau `increment` salah | Periksa kedua angka dan aturan kelipatan lot |
| "bidBody harus memuat {{amount}}" | Nominal contoh tidak terganti | Ganti angka nominal di `bidBody` dengan `{{amount}}` |
| "Bid ditolak server (HTTP 4xx)" | Format body salah, token (CSRF) sudah basi, atau sesi habis | Rekam ulang request penawaran dan impor lagi |
| Halaman tidak terbuka | Server belum jalan atau port berbeda | Jalankan `npm run ui`, cek alamat dan port |
| Pesan "Host tidak diizinkan" | Akses lewat alamat selain `localhost` atau `127.0.0.1` | Buka dengan `http://localhost:3210` |
| `node` tidak dikenali | Node.js belum terpasang atau PowerShell belum dibuka ulang | Pasang Node.js LTS lalu buka ulang PowerShell |

## Keamanan dan tanggung jawab

- **Cookie sama dengan akses ke akun Anda.** Jangan membagikannya dan jangan menaruhnya di tempat yang bisa dilihat orang lain. Aplikasi tidak menyimpan cookie di browser; cookie hanya ada di memori selama aplikasi dipakai.
- Pengaturan lain di formulir **tersimpan otomatis di browser lokal** Anda, termasuk *header tambahan* yang bisa memuat token. Bila komputer dipakai bersama, kosongkan data situs `localhost:3210` setelah selesai.
- Server hanya menerima sambungan dari komputer ini dan menolak akses dari situs lain.
- Mode CLI (`config.json`) bisa memuat cookie. Jangan menyalin atau mengunggah file itu ke tempat umum. Sebagai gantinya, pakai variabel lingkungan `LELANG_COOKIE`.
- **Penawaran bersifat mengikat.** Selalu isi `maxBid` dengan angka yang siap Anda bayar, dan latih dulu dengan mode uji.
- Periksa **syarat dan ketentuan** situs lelang. Penggunaan otomasi bisa dibatasi, dan pelanggaran dapat berujung pada sanksi akun. Bila situs menampilkan CAPTCHA atau verifikasi tambahan, itu tanda otomasi tidak diinginkan; aplikasi ini tidak dirancang untuk menembusnya.
- Aplikasi ini alat bantu. Hasil lelang tidak dijamin, dan Anda bertanggung jawab penuh atas penawaran yang dikirim.

## Batasan saat ini

- Permintaan data lot hanya mendukung **GET**.
- Login **belum otomatis**: cookie ditempel manual dan harus masih berlaku saat bot menembak.
- CAPTCHA, OTP, dan token yang berubah tiap request **tidak ditangani**. Bila request penawaran memuat token sekali pakai, hasil rekaman tidak bisa dipakai ulang.
- Bila waktu lelang diperpanjang **setelah** harga terakhir diambil (beberapa detik sebelum tembak), jadwal tidak lagi menyesuaikan.
- Satu bot berjalan pada satu waktu (satu lot).
- Bot bergantung pada struktur API situs. Bila situs berubah, impor ulang request-nya.
- Timing sudah diuji dengan server tiruan (bid mendarat sesuai target), tetapi **belum diuji di situs lelang asli**. Gunakan mode uji untuk melihat selisih jam dan latensi yang sebenarnya.

## Pengembangan dan pengujian

```powershell
npm test               # 14 kelompok tes dengan server lelang tiruan
npm run ui             # tampilan web
npm start              # mode CLI: membaca config.json
npm run test:koneksi   # mode CLI: tes koneksi saja
```

Mode CLI memakai `config.json` di folder utama. Cookie dikirim lewat variabel lingkungan:

```powershell
$env:LELANG_COOKIE = "isi-cookie-anda"
npm run test:koneksi
```

Inti bot ada di `src/core.js` dan bisa dipanggil dari kode lain:

```js
const { runSniper, testConnection, inspectState } = require('./src/core');
```

- `testConnection(config)`: tes koneksi dengan simulasi dan peringatan.
- `inspectState(config)`: daftar field respons beserta tebakan jenisnya.
- `runSniper(config, { onLog, onEvent, signal })`: menjalankan bot; `signal` (AbortController) untuk menghentikan.

## Rencana berikutnya

- Profil tersimpan (beberapa lot tanpa isi ulang) dengan cookie terenkripsi.
- Dibungkus menjadi aplikasi Windows (`.exe`) agar tanpa Node.js dan terminal.
- Login otomatis.
- Beberapa lot sekaligus dan notifikasi hasil.
- Penyesuaian tampilan.
