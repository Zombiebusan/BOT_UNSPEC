# Integrasi UNSPEC langsung dari dashboard

## Alur

`/unspec` atau menu UNSPEC → pilih Branch / CETAK SEMUA → ambil data API → buat laporan menggunakan `renderReports()` yang sudah ada → antrekan pengiriman Telegram.

- CSV tidak wajib untuk jalur live. CSV / Arsip dan `/report YYYY-MM-DD` tetap tersedia untuk histori.
- VALINS ODP, VALINS DC, parsing Excel, dan fitur balas laporan dengan foto tetap menggunakan alur sebelumnya.
- Judul, isi, urutan Branch, rumus, pembulatan, daftar STO, serta legenda laporan UNSPEC tidak diubah.
- Cetak Ulang pada menu live mengambil API terbaru. Tombol cetak dari CSV tetap mencetak snapshot CSV sesuai tanggalnya.
- **SULBAGSEL REPORT** berada tepat di bawah CETAK SEMUA. Pilihan ini mengambil API sekali, kemudian mengirim satu pesan tabel teks per 21 Service Area dalam empat Branch: BRANCH, SERVICE AREA, SALDO (H/H-1/TARGET/GAP), CLOSE HI, REAL, ACH, dan baris total SULBAGSEL dengan font monospace yang seragam. Pemisah baris dan spasi dipadatkan agar seluruh data muat 4.096 karakter; tombol menu/cetak ulang berada pada pesan yang sama. CLOSE HI memakai penurunan saldo bersih dari snapshot H-1 (`max(0,H-1−H)`), bukan klaim jumlah tiket closed atau posisi tepat 00.00 yang tidak terekam. Jalur tabel juga tersedia untuk arsip CSV. Laporan teks sebelumnya tetap ada.

## Konfigurasi dan deployment

Pada proyek dashboard `UNSPEC-Sulbagsel`:

```text
UNSPEC_BOT_API_TOKEN=<token integrasi minimal 32 karakter>
```

Pada proyek bot `KKP-BOT`:

```text
UNSPEC_API_URL=https://underspec-sulbagsel.vercel.app/api/bot/unspec
UNSPEC_API_TOKEN=<token yang sama>
```

Nilai lokal sudah diisi dalam `.env.local` dashboard dan `.env` bot. Kedua file dikecualikan dari Git. Nilai tersebut tidak otomatis menjadi environment variables Vercel.

Urutan aktivasi:

1. Tambahkan `UNSPEC_BOT_API_TOKEN` ke environment Production proyek dashboard di Vercel.
2. Deploy source dashboard terbaru sehingga `POST /api/bot/unspec` tersedia.
3. Tambahkan `UNSPEC_API_URL` dan `UNSPEC_API_TOKEN` ke environment Production proyek bot.
4. Deploy source bot terbaru. DATABASE_URL bot tetap databasenya sendiri; tidak perlu menyamakan database kedua proyek.
5. Jalankan `npm run webhook:set` bila konfigurasi webhook/menu Telegram perlu diperbarui.
6. Buka bot → `/unspec` → pilih Branch / CETAK SEMUA.

## Kontrak endpoint dashboard

```text
POST /api/bot/unspec
Authorization: Bearer <UNSPEC_BOT_API_TOKEN>
```

Respons sukses memuat `version: 1`, `scope: SULBAGSEL`, `cohort: PROACTIVE_UNSPEC`, `complete: true`, `date`, `fetchedAt`, `current`, dan `previous`.

Bot juga mengirim JSON `{"requestId":"tg-<namespace-bot>-<update-id>"}`. Dashboard menyimpan permintaan ini secara persisten dan memberi HTTP 202 selama data disiapkan di background. Bot memeriksa hasil melalui GET endpoint yang sama dengan query `requestId`. Respons selesai menambahkan `requestId`, `requestedAt`, dan `completedAt`. Pengulangan requestId membaca pekerjaan yang sama, bukan memulai lagi pengambilan sumber.

`current` berisi `countsByWorkzone` (seluruh 50 STO, termasuk saldo nol) serta `total`. `previous` memiliki struktur sama beserta tanggal H-1, atau `null` jika histori tanggal kemarin tidak tersedia. Tidak ada nama, nomor layanan, atau detail pelanggan dalam respons integrasi.

- Pengambilan sumber memakai pagination lengkap, deduplikasi INCIDENT, filter WORKZONE Sulbagsel, dan filter proactive yang sama dengan dashboard.
- Endpoint menyinkronkan data baru sebelum sukses. Snapshot lama tidak dikembalikan seolah-olah hasil live.
- H dan H-1 berdasarkan kalender WITA, bukan REPORTED DATE tiket. Klik menu lama tidak mengubah tanggal data live menjadi tanggal pesan tombol.
- Bot memvalidasi kelengkapan 50 STO, nilai saldo, total, scope, cohort, tanggal, dan kesegaran hasil API. LIS tetap memakai master bot sesuai tanggal masing-masing snapshot.
- `202`: pekerjaan belum selesai, bot menunggu/melanjutkan otomatis. `401`: token tidak sesuai. `503/504`: pekerjaan gagal atau konfigurasi/database belum siap, disertai kode penyebab yang aman. Jalur sinkron lama tanpa requestId tetap dapat mengembalikan `409` saat sibuk. Tidak ada laporan parsial yang dicetak.

## Batas waktu dan retry

Worker dashboard berjalan setelah respons 202, maksimal 210 detik, dalam function berdurasi maksimal 300 detik. Setiap permintaan halaman sumber memiliki batas 45 detik. Worker menunggu lease sinkronisasi yang sedang aktif atau memakai hasil yang diambil sesudah request tersebut, tanpa memulai pekerjaan sumber bersamaan.

Bot menunggu sesuai sisa waktu webhook (maksimal 42 detik). Jika pekerjaan masih pending, bot tidak membuat laporan error permanen; webhook mengembalikan status retry dan update Telegram berikutnya memakai requestId yang sama. Setelah selesai, snapshot serta seluruh pesan disiapkan atomik dan antrean lama melanjutkan pengiriman. Untuk retry yang terlambat, hasil job yang cocok dapat dipakai sampai 24 jam berdasarkan requestedAt/completedAt; payload lama tanpa metadata job tetap dibatasi dua menit. API yang benar-benar gagal memberi pesan spesifik tanpa mengganti snapshot valid sebelumnya.

**Perbaikan HTTP 503 karena timeout:** deploy ulang dashboard dan bot, karena kedua sisi menggunakan protokol pending/result. Tidak ada environment variable tambahan; token integrasi tetap sama. Tabel `unspec_bot_requests` dibuat otomatis saat inisialisasi dashboard.

## Pengujian

```sh
npm test
npm run build
npm run db:check
```

Tes mencakup kesamaan penuh empat teks laporan CSV/API, nol tiket, H-1 kosong, mapping/total tidak lengkap, pergantian tahun dan basis LIS, status HTTP gagal, menu tanpa CSV, klik tombol lama, retry, isolasi chat/topic, serta regresi VALINS dan foto. `db:check` melakukan pemeriksaan SQL dalam transaksi yang seluruhnya di-rollback.

Tes tabel memeriksa pembulatan agregat regional, GAP, nilai nol, H-1 kosong, urutan Branch, kesejajaran semua baris, panjang pesan Telegram, penggunaan HTML `<pre>` melalui sendMessage, serta penyimpanan teks yang identik pada retry.
