# Integrasi UNSPEC langsung dari dashboard

## Alur

`/unspec` atau menu UNSPEC → pilih Branch / CETAK SEMUA → ambil data API → buat laporan menggunakan `renderReports()` yang sudah ada → antrekan pengiriman Telegram.

- CSV tidak wajib untuk jalur live. CSV / Arsip dan `/report YYYY-MM-DD` tetap tersedia untuk histori.
- VALINS ODP, VALINS DC, parsing Excel, dan fitur balas laporan dengan foto tetap menggunakan alur sebelumnya.
- Judul, isi, urutan Branch, rumus, pembulatan, daftar STO, serta legenda laporan UNSPEC tidak diubah.
- Cetak Ulang pada menu live mengambil API terbaru. Tombol cetak dari CSV tetap mencetak snapshot CSV sesuai tanggalnya.
- **SULBAGSEL REPORT** berada tepat di bawah CETAK SEMUA. Pilihan ini mengambil API sekali, kemudian mengirim satu pesan tabel teks per 21 Service Area dalam empat Branch: BRANCH/SA (satu kolom untuk nama SA dan subtotal Branch), SALDO (H/H-1/TARGET/GAP), CLOSE HI, REAL, ACH, dan baris total SULBAGSEL dengan font monospace yang seragam. Pemisah baris dan spasi dipadatkan agar seluruh data muat 4.096 karakter; tombol menu/cetak ulang berada pada pesan yang sama. Khusus CLOSE HI, rumusnya **saldo pagi 08.00 WITA − saldo terkini**, terpisah dari H-1 dan tanpa clamp nol. Jalur tabel juga tersedia untuk arsip CSV. Laporan teks sebelumnya tetap ada.

## Hari operasional dan baseline CLOSE HI pada bot

- **Hari operasional berjalan dari 08.00 WITA sampai sebelum 08.00 hari berikutnya.** Contoh: tanggal 7 pukul 02.00 masih report tanggal 6 dan memakai acuan awal tanggal 6. Pada tanggal 7 pukul 08.00, tanggal report dan acuannya beralih ke tanggal 7.
- API dashboard tetap memakai tanggal kalender untuk kontrak datanya. Bot memvalidasi tanggal kalender tersebut lalu mengubah tanggal report mengikuti waktu `fetchedAt`. Basis LIS juga mengikuti hari operasional. Sebelum 08.00, `previous` kalender API yang sebenarnya masih hari operasional yang sama tidak dipakai sebagai H-1; bot mengutamakan arsip operasional dan metadata pembanding yang tersimpan.
- `unspec_opening_balances` di **database bot** menyimpan agregat 21 SA, waktu aktual, dan asal acuan. Normalisasi ini tidak memerlukan endpoint baru atau deploy dashboard. Field `morning` dari versi dashboard yang menyediakannya tetap didukung secara opsional.
- Sesuai keputusan pengguna, jika rekaman tepat 08.00 belum tersedia, dipakai **rekaman API lengkap pertama yang tersedia** pada hari operasional itu. Label `Acuan awal tersedia: ... WITA` mencantumkan jam aktual. Data siang tidak diklaim sebagai rekaman tepat 08.00.
- Acuan dapat dipulihkan dari snapshot API yang tersimpan atau tabel report API lengkap di antrean. Parser memerlukan seluruh 21 SA dan total Sulbagsel yang cocok; tidak menebak saldo dari persentase yang dibulatkan. Sumber CSV tidak boleh membentuk acuan global.
- Rekaman yang lebih baru tidak menimpa acuan. Bila backfill menemukan rekaman yang benar-benar lebih awal, nilai tersebut dapat menjadi acuan yang lebih tepat untuk report selanjutnya. Pesan yang sudah disiapkan tetap frozen pada retry.
- Bot menjadwalkan **`GET /api/unspec-morning`** pada **`0 0 * * *` UTC = 08.00 WITA**. Isi `CRON_SECRET` minimal 32 karakter pada Production **proyek bot**. Jadwal mengambil API yang sudah ada, menyimpan acuan, dan tidak mengirim pesan Telegram. Endpoint ini berdurasi maksimal 300 detik serta dapat melanjutkan request API persisten.
- Jadwal Vercel Hobby mungkin terlambat dalam jam yang dijadwalkan. Jam aktual tetap ditulis dan fallback rekaman pertama tetap berfungsi. Untuk ketepatan menit 08.00, gunakan penjadwal yang mendukung presisi tersebut.
- Jalankan `npm run db:setup` jika memakai database bot lain. Pemulihan manual tanpa kirim laporan: `npm run unspec:opening:backfill -- YYYY-MM-DD`.

## Konfigurasi dan deployment

Pada proyek dashboard `UNSPEC-Sulbagsel`:

```text
UNSPEC_BOT_API_TOKEN=<token integrasi minimal 32 karakter>
```

Pada proyek bot `KKP-BOT`:

```text
UNSPEC_API_URL=https://underspec-sulbagsel.vercel.app/api/bot/unspec
UNSPEC_API_TOKEN=<token yang sama>
CRON_SECRET=<secret acak minimal 32 karakter untuk jadwal pada bot>
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
- Kontrak tanggal API berdasarkan kalender WITA, lalu bot memetakannya ke hari operasional 08.00–07.59. REPORTED DATE tiket tidak menjadi tanggal report. Klik menu lama tidak mengubah waktu posisi data live menjadi waktu pesan tombol.
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
