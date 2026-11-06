# Fitur VALINS dari Excel

## Cara menggunakan

1. Kirim `/start` atau `/menu`, lalu tekan **VALINS ODP**, **VALINS DC**, atau **VALINS ODP DAN DC**.
2. Bot meminta upload dokumen `.xlsx` dengan struktur **Sheet1** yang sama seperti `REPORT VALINS ODP & ODC`.
3. Setelah upload diproses, pilih **PARE-PARE**, **BONE**, **KENDARI**, **MAKASSAR**, atau **CETAK SEMUA**. Laporan baru dicetak setelah tombol ditekan. H-1 dan growth dibaca dari Excel.
4. Tombol **Cetak Ulang** dan **Ganti Branch** tetap menggunakan tanggal data yang diupload. **Upload File Baru** meminta file baru; **Menu Utama** mengganti jenis laporan.

Command teks juga tetap tersedia:

| Command | Hasil |
|---|---|
| `/valins` | Minta upload Excel untuk VALINS ODP DAN DC |
| `/valins_visit` | Minta upload Excel untuk VALINS ODP |
| `/valins_dc` | Minta upload Excel untuk VALINS DC |
| `/valins bone` | Dua laporan BONE |
| `/valins makassar` | Dua laporan MAKASSAR |
| `/valins kendari` | Dua laporan KENDARI |
| `/valins semua` | Delapan pesan: dua laporan untuk setiap branch |
| `/valins_dc bone 2026-10-27` | DC BONE pada tanggal arsip yang dipilih |

Command teks lanjutan yang menyertakan branch mengambil arsip tersimpan di chat yang sama. Menu tombol selalu meminta upload terlebih dahulu. `/unspec` meminta upload CSV dan `/report` tetap mengambil laporan UNSPEC. Jika Excel dikirim tanpa memilih jenis melalui menu, bot menyiapkan VALINS ODP DAN DC dan menampilkan pilihan cetak setelah upload.

Caption tanggal `2026-10-27` atau `tanggal=2026-10-27` juga berlaku untuk **tanggal arsip VALINS**. Caption tidak mengubah nilai H/H-1 dalam workbook. Semua anggota grup yang sama menggunakan arsip grup tersebut. Teks laporan mengikuti struktur contoh tanpa menambahkan baris tanggal.

## Acuan angka Sheet1

Parser hanya memilih sheet bernama **Sheet1**, meskipun posisinya bukan urutan pertama. Blok detail SA/STO dipakai sebagai sumber. Rekap atas/bawah dan subtotal SA yang mengulang angka tidak dijumlahkan lagi. Urutan STO mengikuti Excel.

| Komponen | Kolom / rumus |
|---|---|
| VISIT: total ONT / sudah valins PSB | C / D |
| Saldo belum PSB | E, diverifikasi sama dengan C − D |
| ONT berubah port / valins OMSET | G / H |
| Saldo belum OMSET | I, diverifikasi sama dengan G − H |
| Real PSB | F = D/C; basis 0 mengikuti Excel: 100% |
| Real OMSET | J = H/G; basis 0 mengikuti Excel: 100% |
| VISIT TOTAL REAL H | L = (F + J) / 2 |
| VISIT H-1 / growth | M / L − M, diverifikasi dengan N bila tersedia |
| DC: ONT in service / QR code / sudah valins | P / Q / S |
| DC: Valins to UIM / success UIM | T / U |
| DC: belum valins | V = P − Q, bukan P − S |
| DC: persentase sudah valins | S/P |
| DC: TOTAL REAL H | X, metrik REAL H sumber, **bukan S/P atau Q/P** |
| DC: H-1 / growth | Y / X − Y, diverifikasi dengan Z bila tersedia |
| Target VISIT / DC | K / W pada total branch; contoh 92,27% / 95,00% |

Angka Excel berupa rasio 0–1 dikalikan 100 untuk tampilan persen. Growth merupakan selisih poin persentase, dengan format `%` mengikuti contoh pengguna. Hijau/merah ditentukan dari angka asli sebelum pembulatan. Target VALINS dicapai jika realisasi **≥ target**; berbeda dengan UNSPEC yang targetnya batas maksimal.

Setiap kolom jumlah dijumlahkan dari STO dan dicocokkan dengan total branch. Sel kosong/hasil rumus yang tidak tersedia tidak dianggap nol. Nilai formula wajib sudah dihitung dan disimpan oleh Excel; file yang tidak konsisten ditolak tanpa mengganti snapshot valid sebelumnya. Jika H-1 kosong, growth ditampilkan `Belum tersedia`.

Pada workbook contoh, saldo PSB PARE-PARE di rekap atas tertulis **1.177**, sedangkan blok detail dan `5.784 − 5.259` menghasilkan **525**. Parser memakai blok detail yang terverifikasi, sehingga laporan menghasilkan **525**, sesuai contoh pengguna.

Label `Source data: https://access-quality.telkom.co.id` mengikuti workbook. Bot membaca file yang Anda upload, bukan melakukan login atau mengambil data langsung dari situs tersebut.

## Penyimpanan dan deployment

Riwayat VALINS tersimpan dalam tabel `valins_snapshots`, terpisah dari snapshot UNSPEC. Workbook mentah tidak disimpan. Upload berulang untuk tanggal arsip yang sama menggunakan pesan terakhir, dengan perlindungan terhadap retry dan pemrosesan yang selesai tidak berurutan.

Tabel VALINS sudah dibuat pada database proyek saat fitur ini dibangun. Untuk database/deployment lain, jalankan:

```powershell
npm run db:setup
```

Upload source terbaru dan deploy ulang ke Vercel. Setelah deployment, jalankan berikut untuk memperbarui menu command bot:

```powershell
npm run webhook:set
```

## Preview dan validasi

```powershell
npm run valins:preview -- "REPORT VALINS ODP & ODC(AutoRecovered) (1).xlsx"
npm run valins:preview -- "REPORT VALINS ODP & ODC(AutoRecovered) (1).xlsx" semua
npm run db:check -- "REPORT VALINS ODP & ODC(AutoRecovered) (1).xlsx"
```

Preview default menghasilkan dua pesan PARE-PARE. Uji database memeriksa penyimpanan VALINS, H-1 bawaan Excel, retry, pemilihan jenis/branch, dan pemisahan data dengan UNSPEC; semua data uji di-rollback.
