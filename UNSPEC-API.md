# Integrasi UNSPEC langsung dari dashboard

## Alur

`/unspec` atau menu UNSPEC → pilih Branch / CETAK SEMUA → ambil data API → buat laporan menggunakan `renderReports()` yang sudah ada → antrekan pengiriman Telegram.

- CSV tidak wajib untuk jalur live. CSV / Arsip dan `/report YYYY-MM-DD` tetap tersedia untuk histori.
- VALINS ODP, VALINS DC, parsing Excel, dan fitur balas laporan dengan foto tetap menggunakan alur sebelumnya.
- Judul, isi, urutan Branch, rumus, pembulatan, daftar STO, serta legenda laporan UNSPEC tidak diubah.
- Cetak Ulang pada menu live mengambil API terbaru. Tombol cetak dari CSV tetap mencetak snapshot CSV sesuai tanggalnya.
- **CETAK TABEL** berada tepat di bawah CETAK SEMUA. Pilihan ini mengambil API sekali, kemudian mengirim gambar PNG dengan header bertingkat SALDO (H/H-1/TARGET/GAP), REAL, ACH, empat Branch, dan total Sulbagsel. Jalur tabel juga tersedia untuk arsip CSV. Laporan teks sebelumnya tetap ada.

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

`current` berisi `countsByWorkzone` (seluruh 50 STO, termasuk saldo nol) serta `total`. `previous` memiliki struktur sama beserta tanggal H-1, atau `null` jika histori tanggal kemarin tidak tersedia. Tidak ada nama, nomor layanan, atau detail pelanggan dalam respons integrasi.

- Pengambilan sumber memakai pagination lengkap, deduplikasi INCIDENT, filter WORKZONE Sulbagsel, dan filter proactive yang sama dengan dashboard.
- Endpoint menyinkronkan data baru sebelum sukses. Snapshot lama tidak dikembalikan seolah-olah hasil live.
- H dan H-1 berdasarkan kalender WITA, bukan REPORTED DATE tiket. Klik menu lama tidak mengubah tanggal data live menjadi tanggal pesan tombol.
- Bot memvalidasi kelengkapan 50 STO, nilai saldo, total, scope, cohort, tanggal, dan kesegaran hasil API. LIS tetap memakai master bot sesuai tanggal masing-masing snapshot.
- `401`: token tidak sesuai. `409`: sinkronisasi lain sedang berjalan, tekan cetak ulang. `503`: konfigurasi, sumber data, atau database belum siap; tidak ada laporan parsial yang dicetak.

## Batas waktu dan retry

Pengambilan sumber dashboard dibatasi 38 detik. Bot membatasi permintaan sesuai sisa waktu webhook (maksimal 42 detik), menyimpan snapshot serta seluruh pesan secara atomik, lalu memakai antrean pengiriman yang sudah ada. Bila sisa durasi pengiriman habis, retry webhook melanjutkan pesan yang belum terkirim tanpa mengambil API lagi. API gagal menghasilkan pesan kegagalan yang aman dan tidak mengganti snapshot valid sebelumnya.

## Pengujian

```sh
npm test
npm run build
npm run db:check
```

Tes mencakup kesamaan penuh empat teks laporan CSV/API, nol tiket, H-1 kosong, mapping/total tidak lengkap, pergantian tahun dan basis LIS, status HTTP gagal, menu tanpa CSV, klik tombol lama, retry, isolasi chat/topic, serta regresi VALINS dan foto. `db:check` melakukan pemeriksaan SQL dalam transaksi yang seluruhnya di-rollback.

Tes tabel memeriksa pembulatan agregat regional, GAP, nilai nol, H-1 kosong, urutan Branch, PNG nyata dengan font bawaan, upload multipart Telegram, serta penyimpanan gambar yang identik pada retry.
