# Deployment manual ke Vercel

## Yang sudah disiapkan

- Source bot berada di folder proyek ini.
- Token bot **@reportsulbagsel_bot**, koneksi Neon, dan webhook secret sudah diisi dalam **`.env` lokal**.
- Tabel Neon sudah dibuat: `daily_snapshots` dan `telegram_jobs`.
- Bot terbuka untuk semua pengguna, tanpa ID akun yang perlu didaftarkan.
- Snapshot dashboard lama tidak dimasukkan ke database.

## 1. Deploy source proyek

Sebelum deploy pembaruan ini, jalankan pada database bot yang dikonfigurasi di `.env`:

```powershell
npm run db:setup
npm run db:check
```

Setup menambahkan kolom `awaiting_upload` dan `upload_requested_at` pada `report_preferences` tanpa menghapus snapshot. Bot memakai kolom ini untuk menerima file hanya setelah pengguna memilih menu upload. `db:check` memeriksa izin upload, kedaluwarsa, isolasi pengguna/topic, dan retry dalam transaksi yang di-rollback.

Anda dapat menghubungkan repository proyek ke Vercel, atau menjalankan Vercel CLI sendiri:

```powershell
npx vercel
```

Gunakan konfigurasi berikut:

| Pengaturan | Nilai |
|---|---|
| Framework | Other |
| Root Directory | Folder yang berisi `package.json` |
| Node.js | 24.x |
| Build Command | `npm run build` |
| Output Directory | `public` |

Deploy **source proyek**, bukan hanya folder `dist`. File `.env`, CSV pelanggan, JSON riwayat, dan dashboard lama dikecualikan dari repository/upload CLI oleh file ignore.

## 2. Isi environment variable Vercel

Buka **Project → Settings → Environment Variables**. Salin nilai dari `.env` lokal untuk environment **Production**:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
DATABASE_URL
UNSPEC_API_URL
UNSPEC_API_TOKEN
CRON_SECRET
```

Tidak perlu mengisi `PGHOST`, `PGPASSWORD`, `POSTGRES_URL`, atau variable koneksi alternatif; aplikasi cukup menggunakan `DATABASE_URL`.

Untuk UNSPEC langsung dari API, deploy dashboard lebih dahulu dengan `UNSPEC_BOT_API_TOKEN`. Nilainya harus sama dengan `UNSPEC_API_TOKEN` bot. URL endpoint bot adalah `https://underspec-sulbagsel.vercel.app/api/bot/unspec`. Lihat [UNSPEC-API.md](UNSPEC-API.md).

Setelah environment tersimpan, lakukan **Redeploy**, atau jika menggunakan CLI:

```powershell
npx vercel --prod
```

Pastikan endpoint production dapat diakses Telegram; Vercel Authentication/Deployment Protection tidak boleh memblokir webhook production.

## 3. Daftarkan webhook

Setelah mendapatkan domain production Vercel, isi baris ini di `.env` lokal:

```dotenv
APP_URL=https://nama-project-anda.vercel.app
```

Kemudian jalankan dari folder proyek:

```powershell
npm run webhook:set
```

Command ini menghubungkan bot ke `https://nama-project-anda.vercel.app/api/telegram`. Token dan webhook secret lokal harus sama dengan yang Anda masukkan di Vercel.

## 4. Uji bot

1. Buka **https://t.me/reportsulbagsel_bot**.
2. Kirim `/start`.
3. Pilih UNSPEC, lalu langsung pilih Branch atau Cetak Semua tanpa upload CSV.
4. Bot mengambil API terbaru, kemudian mencetak laporan dengan struktur sebelumnya.
5. Gunakan Cetak Ulang untuk mengambil posisi API terbaru. CSV / Arsip tetap tersedia bila ingin upload historis.

H-1 otomatis tersedia setelah ada snapshot hari sebelumnya di chat yang sama. Untuk mengupload dua file historis hari ini:

1. Pilih **CSV / Arsip**, lalu kirim `export (35).csv` dengan caption **`tanggal=2026-10-25`**.
2. Pilih **Upload File Baru**, lalu kirim `export (36).csv` dengan caption **`tanggal=2026-10-26`**.
3. Laporan tanggal 26 akan menggunakan data tanggal 25 sebagai H-1.

Tanpa caption, **CSV UNSPEC dianggap data kemarin WITA**: upload tanggal 27 berarti data tanggal 26 dengan pembanding tanggal 25; upload tanggal 28 berarti data tanggal 27 dengan pembanding tanggal 26. Untuk tanggal lain, isi caption. Jika file hari sebelumnya diupload belakangan, gunakan `/report 2026-10-26` untuk melihat pembanding yang telah diperbarui.

Anda juga bisa menulis caption tanggal saja, misalnya `2026-10-25` atau `2026-10-26`.

Semua anggota dalam satu grup menggunakan snapshot grup tersebut; chat lain memiliki riwayat sendiri.

Bot menunggu satu file yang sesuai selama **15 menit** dari pengguna dan chat/topic yang membuka menu upload. Setelah berhasil, pilih **Upload File Baru** untuk file berikutnya. Chat biasa, perintah untuk bot lain, foto acak, file salah jenis, dan file tanpa permintaan aktif tidak dibalas. Untuk menguji foto laporan, balas pesan laporan bot sendiri dengan satu foto.

## Pemeriksaan lokal opsional

```powershell
npm run connections:check
npm run db:check
npm test
npm run build
```

`connections:check` memeriksa koneksi Neon dan token Telegram. `db:check` menguji penyimpanan dalam transaksi yang di-rollback. Kedua command tidak mendaftarkan webhook atau mengirim laporan ke pengguna.

## Fitur baru VALINS

Setelah source terbaru diupload dan di-deploy, jalankan `npm run webhook:set` untuk memperbarui menu command. Tabel `valins_snapshots` sudah dibuat pada database proyek; jika menggunakan database lain, jalankan `npm run db:setup` terlebih dahulu.

Kirim `/start`, lalu pilih jenis laporan. **UNSPEC langsung dapat dicetak dari API**. Untuk **VALINS ODP / VALINS DC / VALINS ODP DAN DC**, upload Excel terlebih dahulu, lalu pilih Branch atau CETAK SEMUA. Tombol cetak VALINS/CSV memakai tanggal file yang diupload. CSV tanpa caption tetap memakai tanggal data kemarin WITA; H-1 upload tidak berubah menjadi unggahan sebelumnya pada hari yang sama. H-1 VALINS berasal dari kolom Excel. Panduan rumus dan contoh command tersedia di [VALINS.md](VALINS.md).

Versi menu tombol memerlukan tabel `report_preferences` dan update webhook **`callback_query`**. Jalankan `npm run db:setup` untuk database lain dan `npm run webhook:set` setelah deploy. Tabel proyek saat ini sudah disiapkan.

## Fitur laporan bergambar

UNSPEC **Cetak Semua** kini otomatis mengirim **4 laporan teks + 4 gambar tabel lengkap**, satu gambar untuk setiap Branch. Cetak satu Branch mengirim satu laporan + satu gambar. Gambar menggunakan snapshot yang sama dengan teks dan tersimpan dalam job retry. Deploy bot dengan `package.json` dan `package-lock.json` terbaru agar dependency `sharp` tersedia di Vercel. Tidak perlu mengubah endpoint API dashboard atau skema database untuk gambar Branch.

Deploy source terbaru untuk mengaktifkan fitur **Reply/Balas laporan dengan foto**. Tidak ada environment variable atau migrasi database tambahan untuk fitur ini. Setelah bot mencetak laporan, balas pesan laporan tersebut dengan satu foto; bot mengirim ulang foto dengan caption teks laporan. Jika teks melebihi 1.024 karakter, foto dan laporan lengkap dikirim sebagai dua pesan yang dapat diteruskan bersama.
