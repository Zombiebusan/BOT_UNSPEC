# Bot Telegram Laporan UNSPEC & VALINS Sulbagsel

Pilih **UNSPEC** → pilih branch atau **Cetak Semua** → bot mengambil data API terbaru dari dashboard dan membuat laporan dengan format yang sama. Upload CSV tidak lagi wajib untuk UNSPEC; opsi **CSV / Arsip** tetap tersedia. Branch tersedia: **BONE, KENDARI, MAKASSAR, PARE-PARE**.

Konfigurasi kedua proyek, kontrak API, tanggal WITA, dan langkah aktivasi dijelaskan di **[UNSPEC-API.md](UNSPEC-API.md)**.

Upload Excel `.xlsx` → bot membaca **Sheet1** → pilih branch untuk mencetak **VALINS VISIT ODP**, **VALINS DC QR CODE & SERVICE**, atau keduanya. Panduan penggunaan dan rumus lengkap tersedia di **[VALINS.md](VALINS.md)**.

Panduan singkat untuk deployment proyek yang sudah dikonfigurasi tersedia di **[DEPLOY.md](DEPLOY.md)**.

## Menu tombol

1. Kirim **`/start`** atau **`/menu`**.
2. Tekan **UNSPEC**, **VALINS ODP**, **VALINS DC**, atau **VALINS ODP DAN DC**.
3. **UNSPEC langsung menampilkan pilihan Branch**, tanpa meminta CSV. VALINS tetap meminta **Excel XLSX** terlebih dahulu.
4. Tekan **PARE-PARE**, **BONE**, **KENDARI**, **MAKASSAR**, atau **CETAK SEMUA**. Pada UNSPEC live, setiap cetak mengambil posisi terbaru hari ini WITA.

Tombol **Cetak Ulang** UNSPEC live mengambil API lagi; **Ganti Branch** membuka pilihan live; **CSV / Arsip** membuka alur upload historis. Tombol VALINS dan cetak dari CSV tetap terikat tanggal upload. Tombol upload lama ditolak setelah ada upload bertanggal lain. Setiap upload baru kembali menampilkan pilihan cetak.

`/start` membuka menu utama dan mereset pilihan Anda di chat/topic tersebut tanpa menghapus snapshot harian. Pilihan setiap pengguna dipisahkan, sedangkan riwayat data tetap milik chat/grup yang sama.

**CETAK SEMUA** menghasilkan 4 laporan untuk UNSPEC, 4 laporan untuk salah satu jenis VALINS, atau 8 laporan untuk VALINS ODP DAN DC. File historis tetap dapat diberi caption tanggal. File yang tidak sesuai jenis pilihan ditolak dengan petunjuk yang benar.

Setelah deploy versi menu tombol, jalankan **`npm run webhook:set`** agar Telegram mengirim update `callback_query` dari tombol. Database menu dibuat dengan `npm run db:setup` (sudah dijalankan pada database proyek saat fitur dibangun).

## SULBAGSEL REPORT — tabel UNSPEC

Menu UNSPEC memiliki tombol **📊 SULBAGSEL REPORT** tepat di bawah **CETAK SEMUA**. Tombol mengirim satu pesan teks tabel monospace Telegram, dengan garis dan header SALDO bertingkat. Laporan teks lama tetap tersedia melalui pilihan Branch dan CETAK SEMUA.

- Header: **BRANCH/SA**, **SALDO** (H, H-1, TARGET, GAP), **CLOSE HI**, **REAL**, **ACH**.
- Nama SA dan subtotal Branch menggunakan satu kolom **BRANCH/SA**. Rincian 21 Service Area mengikuti urutan **MAKASSAR, BONE, PARE PARE, KENDARI**, diikuti subtotal masing-masing Branch di bawah kelompok SA-nya. Garis penuh memisahkan baris subtotal. Baris terakhir adalah total **SULBAGSEL**. Seluruh 50 STO masuk tepat satu SA; subtotal tidak dihitung lagi dalam total regional.
- Jalur API mengambil satu snapshot terbaru beserta H-1. Menekan SULBAGSEL REPORT kembali mengambil API lagi.
- Label SULBAGSEL pada baris total memakai huruf standar dengan font monospace yang sama seperti semua kolom. Huruf Unicode bergaya tebal tidak digunakan karena dapat memicu font fallback dan membuat garis tabel tidak sejajar pada klien Telegram.
- Menu UNSPEC dari unggahan CSV juga memiliki tombol tabel yang memakai arsip pada tanggal upload tersebut.
- H-1 yang tidak tersedia ditampilkan `—`. Target = floor(LIS / 1000); GAP = max(0, H − target); REAL = H / LIS × 100%; ACH = min(100%, 0,10% / REAL × 100%), dengan ACH saldo nol = 100%.
- Target dan GAP baris Sulbagsel dihitung dari total regional, bukan penjumlahan pembulatan atau GAP tiap Branch.
- CLOSE HI adalah penurunan saldo bersih `max(0, H-1 − H)`: misalnya 18 menjadi 17 menghasilkan 1; jika saldo naik menghasilkan 0. Ini bukan hitungan INCIDENT closed sebenarnya. Acuan mengikuti snapshot H-1 tersimpan, bukan rekonstruksi posisi tepat 00.00 jika data saat itu tidak pernah direkam. Jika H-1 tidak tersedia, CLOSE HI juga `—`.
- Seluruh report dikirim dalam **satu pesan**, maksimal 4.096 karakter. Garis horizontal dipadatkan ke header dan subtotal Branch; seluruh baris SA dan total Sulbagsel tetap ada. Spasi dipadatkan lagi bila angkanya panjang. Tombol menu/cetak ulang ditempel pada pesan report yang sama, tanpa pesan konfirmasi terpisah.
- Teks tabel disiapkan dan disimpan dalam job pengiriman; retry tidak mengganti angka pada laporan yang sudah disiapkan.

Tabel dikirim melalui `sendMessage` dengan HTML `<pre>`, sehingga spasi, garis, dan kolom tetap sejajar. Tidak ada gambar atau font khusus yang diperlukan. Preview tanpa mengirim Telegram:

```powershell
npm run unspec:table:preview -- "hari-ini.csv" "hari-kemarin.csv" "2026-11-05"
```

Gunakan `-` untuk CSV H-1 jika belum tersedia. Tidak ada environment variable tambahan untuk fitur tabel; lakukan deploy ulang proyek bot agar format teks baru aktif.

## Laporan bergambar melalui Reply/Balas

1. Buat laporan UNSPEC atau VALINS seperti biasa.
2. Pada **pesan laporan bot** yang ingin diberi gambar, pilih **Reply/Balas**.
3. Kirim **satu foto** dari galeri Telegram.
4. Bot membalas foto Anda dengan **foto yang sama dan teks laporan sebagai caption**. Pesan hasil bot dapat diteruskan/forward.

Teks diambil dari laporan yang Anda balas, termasuk tanggal dan angka aslinya. Caption yang Anda tulis pada foto tidak mengganti teks laporan. Balasan ke menu, pesan pengguna, atau bot lain akan diberi petunjuk untuk membalas laporan bot ini.

Jika teks laporan melampaui batas caption Telegram (**1.024 karakter**), bot mengirim **foto dan teks laporan lengkap sebagai dua pesan**, tanpa memotong isi. Untuk meneruskannya, pilih kedua pesan. Pengiriman menggunakan `file_id` foto Telegram, sehingga aplikasi tidak perlu mengunduh atau menyimpan gambar mentah. Grup/topic tetap didukung dan bot membalas di tempat foto dikirim.

Laporan bergambar tidak mengubah snapshot data, tanggal laporan, H-1, atau pilihan menu. Status pengiriman memakai mekanisme retry yang sama dengan laporan biasa; jika foto sudah tercatat terkirim tetapi teks panjang gagal, retry melanjutkan teksnya.

## Perilaku laporan UNSPEC

- **API live:** SALDO H memakai posisi terbaru hari ini WITA. H-1 memakai tepat tanggal kemarin dari histori dashboard, dengan fallback arsip chat pada tanggal yang sama bila dashboard belum mempunyai H-1. Satu pengambilan dipakai untuk seluruh branch; retry pengiriman memakai pesan yang sudah disiapkan, tidak mengambil API ulang di tengah rangkaian.
- `/report [YYYY-MM-DD]` tetap mengambil arsip. Aturan upload CSV di bawah berlaku untuk opsi **CSV / Arsip**.
- CSV baru maupun lama diterima. Tanggal tiket tidak dijadikan tanggal laporan.
- Bot terbuka untuk **semua pengguna Telegram**, tanpa pendaftaran ID akun. Riwayat dipisahkan per chat.
- Tanpa caption, tanggal data CSV adalah **sehari sebelum tanggal pengiriman dokumen, zona WITA (Asia/Makassar)**, mengikuti pola export rutin. Upload tanggal 27 → data tanggal 26 → H-1 tanggal 25. Upload tanggal 28 → data tanggal 27 → H-1 tanggal 26. Jika webhook terlambat diproses, tanggal tetap dihitung dari pengiriman awal, bukan waktu retry.
- Untuk file hari lain, beri caption **`tanggal=YYYY-MM-DD`** saat mengirim dokumen. Contoh: upload `export (35).csv` dengan `tanggal=2026-10-25`, lalu `export (36).csv` dengan `tanggal=2026-10-26`. H-1 laporan tanggal 26 berasal dari snapshot tanggal 25 meskipun keduanya diupload pada hari yang sama.
- Caption tanggal tanpa awalan juga diterima, misalnya **`2026-10-25`**. Tanggal tidak valid seperti `2026-02-30` tetap ditolak.
- Jika snapshot hari sebelumnya baru diupload/dikoreksi belakangan, laporan hari berikutnya yang tersimpan otomatis diperbarui. Gunakan `/report YYYY-MM-DD` untuk mengambil versi terbaru; pesan lama yang sudah dikirim tidak diedit.
- Setiap upload adalah snapshot lengkap, bukan penambahan tiket ke snapshot sebelumnya.
- Upload berulang pada hari yang sama memperbarui data dan menampilkan pilihan cetak lagi. Pesan upload terakhir menjadi snapshot acuan hari itu, walaupun proses upload sebelumnya baru selesai belakangan.
- H-1 menggunakan snapshot terakhir pada **tepat satu hari sebelumnya di chat yang sama**. Jika tidak tersedia, saldo H-1 dan growth bertuliskan `Belum tersedia`.
- Snapshot lama dari HTML/JSON tidak diimpor. Hanya master STO dan LIS yang diambil dari dashboard.
- Jika Anda mengirim ulang file identik melalui pesan baru, bot tetap membuat laporan. Pengulangan webhook untuk pesan yang sama dilanjutkan dari status pengiriman terakhir.
- Tombol Cetak Semua mengirim empat laporan sebagai pesan terpisah. Catatan tiket di luar cakupan, duplikat, atau tiket tersaring ditampilkan pada konfirmasi upload.

## 1. Persiapan lokal

Gunakan **Node.js 24**. Buka terminal di folder proyek:

```powershell
npm install
```

Buat file `.env` dengan menyalin isi `.env.example`, lalu isi nilainya:

| Variable | Isi |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token bot dari **@BotFather** |
| `TELEGRAM_WEBHOOK_SECRET` | String acak 16–256 karakter; hanya huruf, angka, `_`, `-` |
| `DATABASE_URL` | Connection string PostgreSQL, misalnya Neon dengan SSL |
| `APP_URL` | Domain production Vercel, misalnya `https://kkp-bot.vercel.app` |
| `UNSPEC_API_URL` | `https://underspec-sulbagsel.vercel.app/api/bot/unspec` |
| `UNSPEC_API_TOKEN` | Token yang sama dengan `UNSPEC_BOT_API_TOKEN` pada proyek dashboard |

Tidak perlu mengisi ID pengguna atau ID chat. Setiap pengguna dapat mengirim CSV ke bot; semua anggota di grup yang sama menggunakan riwayat snapshot grup tersebut.

Contoh membuat webhook secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

## 2. Buat database PostgreSQL

Contoh menggunakan [Neon](https://neon.tech):

1. Buat project/database dan salin connection string **pooled** yang disediakan.
2. Masukkan connection string itu sebagai `DATABASE_URL` dalam `.env`.
3. Buat tabel:

```powershell
npm run db:setup
```

Alternatif: jalankan isi `db/schema.sql` di SQL Editor database Anda. Setup dapat diulang tanpa menghapus snapshot yang sudah ada.

Database hanya menyimpan ringkasan jumlah tiket per STO, LIS, teks laporan, dan status pengiriman; CSV mentah serta nama/nomor pelanggan tidak disimpan oleh aplikasi.

Untuk memeriksa koneksi database, tabel, dan token Telegram:

```powershell
npm run connections:check
```

Untuk menguji penyimpanan H/H-1, update harian, retry, dan isolasi chat langsung di database:

```powershell
npm run db:check
```

Uji database menggunakan transaksi sementara; seluruh data uji di-rollback dan tidak menjadi saldo harian pengguna.

## 3. Periksa aplikasi sebelum upload

```powershell
npm test
npm run build
npm run report:preview -- "export (36).csv"
```

Preview tidak memerlukan token atau database. Untuk mencoba growth dengan dua CSV:

```powershell
npm run report:preview -- "hari-ini.csv" "hari-sebelumnya.csv"
```

`npm run build` menghasilkan kompilasi TypeScript di `dist/`. Saat deploy, gunakan **folder proyek/source**, bukan hanya folder `dist`, karena Vercel membangun endpoint dari `api/`.

## 4. Deploy manual ke Vercel

### Melalui dashboard Vercel + repository Git

1. Upload source proyek ke repository Git milik Anda. File CSV, JSON riwayat, HTML dashboard lama, `.env`, `node_modules`, dan `dist` sudah masuk daftar ignore.
2. Vercel → **Add New → Project** → pilih repository tersebut.
3. Framework preset: **Other**.
4. Root Directory: folder tempat `package.json` berada.
5. Build Command: `npm run build`.
6. Output Directory: `public`.
7. Node.js Version: **24.x**.
8. Tambahkan environment variable dari `.env`: token, webhook secret, dan database. `APP_URL` bisa dilengkapi setelah domain tersedia.
9. Klik **Deploy**.
10. Pastikan `https://domain-anda.vercel.app/api/health` mengembalikan `{"ok":true,...}`. Endpoint health hanya mengecek bahwa function dapat diakses, bukan koneksi database/token.

### Melalui terminal, jika Anda memilih Vercel CLI

```powershell
npx vercel
```

Setelah project terhubung, atur environment variable pada dashboard Vercel, kemudian deploy production:

```powershell
npx vercel --prod
```

`.vercelignore` mengecualikan CSV, JSON riwayat, dan dashboard lama dari upload CLI. Jangan meletakkan file pelanggan di dalam `public/`.

Jika environment variable diubah setelah deployment, lakukan **Redeploy**. Pastikan domain production dapat menerima request Telegram; Deployment Protection/Vercel Authentication tidak boleh memblokir endpoint webhook production.

## 5. Hubungkan webhook Telegram

Setelah deploy selesai:

1. Isi `APP_URL` di `.env` lokal dengan domain **production**, bukan preview deployment sementara.
2. Pastikan token dan webhook secret di `.env` lokal sama dengan environment production Vercel.
3. Jalankan:

```powershell
npm run webhook:set
```

Script mendaftarkan `/api/telegram`, secret verifikasi, serta menu command bot. Tidak perlu menaruh token dalam URL browser. Satu bot Telegram hanya dapat memiliki satu webhook aktif.

## 6. Penggunaan

1. Buka bot dan kirim `/start`.
2. Pilih jenis laporan, lalu kirim CSV/Excel sebagai **dokumen/file**, bukan screenshot.
3. Setelah file selesai diproses, pilih branch atau Cetak Semua. Laporan baru dikirim setelah pilihan ini ditekan.
4. Upload CSV lagi jika ada perubahan hari yang sama. Untuk data tanggal lain, isi caption `tanggal=YYYY-MM-DD` ketika mengirim file; caption lain yang tidak sesuai format akan ditolak agar tanggal tidak keliru.

Command:

```text
/start
/help
/report
/report 2026-10-27
```

Untuk grup, tambahkan bot dan izinkan mengirim pesan. Jika dokumen grup tidak diterima, nonaktifkan **Group Privacy** melalui @BotFather (`/setprivacy`) atau jadikan bot admin sesuai kebutuhan. Semua anggota grup dapat mengirim CSV. Untuk topic grup, balasan mengikuti topic tempat CSV dikirim; snapshot tetap dipisahkan per chat/grup, bukan per topic.

## Aturan CSV dan perhitungan

- Maksimum file **10 MB / 100.000 baris**. Mendukung delimiter koma/titik koma, UTF-8/BOM, dan UTF-16 dengan BOM untuk dokumen Telegram.
- Kolom wajib: `INCIDENT`, `WORKZONE`.
- Jika `SUMMARY` tersedia, hanya baris dengan kata `UNSPEC` yang dihitung.
- Jika `STATUS` tersedia, `CLOSED`, `CLOSE`, `RESOLVED`, `RESOLVE`, `CANCELLED`, dan `CANCELED` dikecualikan.
- Deduplikasi berdasarkan `INCIDENT`: baris terakhir digunakan.
- Pemetaan branch berdasarkan STO `WORKZONE`, mengikuti dashboard.
- STO di luar empat branch yang sudah dikenal master dikecualikan. STO yang belum dikenal membuat upload gagal, supaya saldo tidak keliru.
- CSV harus berupa **export lengkap**: STO/branch yang tidak muncul dianggap memiliki saldo **0**.
- Realisasi = saldo tiket ÷ LIS × 100%.
- Target saldo = `floor(LIS / 1000)`.
- Hijau jika saldo × 1000 ≤ LIS. Penentuan status menggunakan angka asli sebelum pembulatan.
- Growth = realisasi H − realisasi H-1. Format `%` mengikuti contoh pengguna; secara matematis ini selisih **poin persentase**, bukan pertumbuhan relatif.
- STO hijau diurutkan dari realisasi terendah; STO merah dari tertinggi. Semua STO dengan rasio tertinggi yang sama diberi label `(Tertinggi)`.
- LIS data mulai **1 November 2026**, sesuai `UNSPEC-Sulbagsel-Dashboard-November-2026.html`: BONE **47.534**, KENDARI **86.141**, MAKASSAR **155.754**, PARE-PARE **105.932**. Target saldo masing-masing: **47, 86, 155, 105**.
- Upload historis bertanggal sebelum 1 November 2026 memakai acuan Oktober: BONE **44.600**, KENDARI **83.681**, MAKASSAR **152.298**, PARE-PARE **101.503**. Pemilihan basis mengikuti **tanggal data**, termasuk caption, bukan tanggal upload atau tanggal tiket.
- Perbarui `src/master.ts` jika ada perubahan LIS/pemetaan, lalu build dan redeploy. Snapshot baru menyimpan LIS per STO agar cetak ulang konsisten. Arsip yang sudah tersimpan mempertahankan basis dan teks laporannya; untuk menghitung ulang laporan November yang dibuat sebelum pembaruan ini, upload ulang CSV dengan tanggal data yang benar.

## Struktur proyek

```text
api/telegram.ts       Endpoint webhook Telegram
api/health.ts         Status server
src/report.ts         Parser CSV dan format laporan
src/report-photo.ts   Foto dengan caption laporan melalui Reply/Balas
src/valins.ts         Parser Sheet1 dan dua format laporan VALINS
src/master.ts         Master STO/LIS dari dashboard
src/store.ts          Snapshot harian dan status pengiriman
src/telegram.ts       Telegram API dan download file
db/schema.sql         Tabel PostgreSQL
scripts/              Setup database, webhook, preview
tests/                Uji CSV/Excel, kalkulasi, akses, Telegram API
public/               Halaman status publik
vercel.json           Konfigurasi deployment
```

## Pemulihan dan troubleshooting

- **Bot diam:** periksa webhook production, Deployment Protection, dan log function Vercel.
- **Antrean tertahan setelah bot dikeluarkan atau grup berubah menjadi supergroup:** versi terbaru mengabaikan notifikasi layanan tanpa membalas. Pengiriman yang ditolak Telegram dengan error permanen 400/403/404 dicatat sebagai gagal dan update diakui agar tidak menahan pengguna lain. Gangguan sementara dan rate limit 429 tetap dicoba ulang.
- Untuk memulihkan job lama yang tertahan pada grup tidak dapat diakses, jalankan `npm run db:setup`, lalu `npm run queue:recover`. Script memeriksa tujuan melalui Telegram dan hanya melewati tujuan yang dikonfirmasi menolak bot (403) atau telah bermigrasi (400 dengan identitas supergroup baru). Pesan, waktu gagal, kode error, dan alasan tetap tersimpan; snapshot laporan tidak dihapus.
- **Database belum siap:** jalankan `npm run db:setup` dengan connection string yang sama seperti production.
- **H-1 kosong:** harus ada snapshot tanggal sebelumnya di chat yang sama. Anda bisa mengisi data historis dengan caption `tanggal=YYYY-MM-DD`. Dua file yang diupload hari ini tanpa caption sama-sama dianggap snapshot hari ini, bukan otomatis dua tanggal berbeda.
- **Laporan tidak lengkap karena gangguan sementara:** Telegram mengulang webhook; bot melanjutkan dari pesan yang belum tercatat terkirim. `/report` juga bisa digunakan untuk mengirim ulang laporan tersimpan.
- Dalam kondisi jarang ketika Telegram sudah menerima pesan tetapi koneksi terputus sebelum aplikasi menerima konfirmasi/menyimpan status, pesan tersebut bisa terkirim ulang saat retry. Telegram tidak menyediakan idempotency key untuk `sendMessage`.
- Tidak ada proses background yang dibiarkan berjalan setelah response. Semua pengiriman di-`await`, dan status tersimpan sebelum response sukses.

Pengujian lokal tidak membutuhkan credential. Uji live Telegram dan database production dilakukan setelah Anda mengisi environment, membuat tabel, dan deploy manual.
