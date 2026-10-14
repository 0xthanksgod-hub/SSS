# RimbaCamp — Website Penyewaan Alat Camping

Versi HTML/CSS/JS biasa (tanpa React/Vite/build step) + server Node kecil.
Pembayaran lewat **transfer bank manual + unggah bukti**, diverifikasi admin.

## Struktur folder

```
rimbacamp/
├── public/                  ← semua yang dibuka browser
│   ├── index.html           Beranda
│   ├── katalog.html         Katalog + filter
│   ├── pesanan.html         Pesanan Saya
│   ├── admin/               Dashboard admin
│   │   ├── login.html
│   │   ├── index.html       Dashboard
│   │   ├── booking.html     Daftar booking + ubah status
│   │   ├── pembayaran.html  Verifikasi bukti transfer + atur rekening toko
│   │   ├── katalog.html · jadwal.html · stok.html · pengaturan.html
│   ├── css/
│   │   ├── style.css        Desain asli dari Figma Make
│   │   └── extra.css        Tambahan (toast, pembayaran, halaman admin)
│   ├── js/
│   │   ├── common.js        Utilitas (format rupiah, API, tanggal, toast)
│   │   ├── layout.js        Header/footer/nav mobile
│   │   ├── product-ui.js    Kartu produk, pencarian tanggal, modal detail
│   │   ├── booking.js       Wizard booking 5 langkah (+ payment-ui.js: rekening & unggah bukti)
│   │   ├── home.js · katalog.js · pesanan.js
│   │   └── admin/           admin.js (kerangka) + satu file per halaman
│   ├── data/products.json   Daftar produk (edit di sini)
│   └── img/
├── server/                  ← backend Node (tanpa dependensi, Node 18+)
│   ├── index.js             Router, file statis, API
│   └── lib/                 app (handler), backend (Redis/file), store, orders, auth
├── database/schema.prisma   Skema PostgreSQL untuk fase produksi (dari project awal)
├── api/[...path].js         Fungsi serverless Vercel (semua /api/*)
├── vercel.json · railway.json   Konfigurasi deploy
├── .env.example
└── package.json
```

## Menjalankan

```bash
cp .env.example .env     # isi rekening toko + password admin
npm start                # http://localhost:3000
```

Tidak ada `npm install` — server hanya memakai modul bawaan Node.
Buka lewat server ini (bukan klik ganda file HTML) karena halaman memanggil `/api/...`.

- Situs: http://localhost:3000
- Admin: http://localhost:3000/admin/ (email & password dari `.env`)

## Pembayaran: transfer bank manual

Midtrans sudah dihapus. Alurnya:

1. Customer booking → server memvalidasi, menghitung harga di server, menahan stok (`HOLD_MINUTES`, default 180 menit).
2. Customer melihat **nama bank, nomor rekening, atas nama, dan nominal** lalu transfer.
3. Customer mengunggah **foto bukti transfer** (JPG/PNG/WEBP, maks 4 MB) di wizard booking atau halaman *Pesanan Saya*.
4. Admin buka **Admin → Pembayaran**, klik *Lihat bukti*, cocokkan dengan mutasi rekening, lalu **Konfirmasi lunas** (status jadi `BOOKED`) atau **Tolak** (customer bisa unggah ulang).
5. Stok tidak dilepas otomatis selama ada bukti yang menunggu verifikasi. Tanpa bukti sampai batas waktu → `EXPIRED`.

Rekening toko: `BANK_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_ACCOUNT_HOLDER` hanya jadi **data awal**
(dipakai saat `db.json` belum ada). Selanjutnya ubah di **Admin → Pembayaran → Rekening tujuan transfer**.
Foto bukti hanya bisa dilihat admin yang login.

## Hosting di Vercel

Vercel itu serverless (tidak ada disk permanen), jadi data pesanan dan foto bukti disimpan di
**Upstash Redis** (gratis, dipasang dari Marketplace Vercel). Foto bukti otomatis dikecilkan di browser
(maks ~600 KB) supaya muat. Halaman statis (`public/`) disajikan Vercel, `/api/*` dijalankan
`api/[...path].js` (kode yang sama dengan server lokal).

1. **Push ke GitHub** (`.env` sudah di `.gitignore`):
   `git init && git add . && git commit -m "RimbaCamp" && git branch -M main && git remote add origin <url-repo> && git push -u origin main`
2. Di https://vercel.com → **Add New → Project** → impor repo. *Framework Preset*: **Other**; jangan isi Build Command. `vercel.json` sudah mengatur sisanya.
   Jangan klik Deploy dulu bila bisa; lakukan langkah 3-4 lebih dulu (bila sudah terlanjur, cukup Redeploy nanti).
3. **Database:** tab **Storage** (atau Marketplace) → **Upstash → Redis** → buat database (region **Singapore** paling dekat) → hubungkan ke project.
   Vercel otomatis mengisi `KV_REST_API_URL` dan `KV_REST_API_TOKEN`.
4. **Settings → Environment Variables** (centang Production):

   | Variabel | Isi |
   |---|---|
   | `NODE_ENV` | `production` |
   | `ADMIN_EMAIL` | email login admin |
   | `ADMIN_PASSWORD` | minimal 12 karakter |
   | `SESSION_SECRET` | hasil `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `IDENTITY_ENCRYPTION_KEY` | hasil `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (simpan baik-baik) |
   | `BANK_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_ACCOUNT_HOLDER` | rekening toko (data awal) |

5. **Deploy / Redeploy**, lalu buka `https://NAMA-PROJECT.vercel.app/admin/`, login, cek **Pembayaran → Rekening**, coba satu booking uji + unggah bukti.
6. Domain sendiri: **Settings → Domains**.

Catatan Vercel:
- Perubahan data memakai *optimistic lock* di Redis, jadi dua customer yang booking bersamaan tidak membuat stok kelebihan.
- Pembatas percobaan login berjalan per-instance (bukan global), jadi andalkan password yang kuat (min. 12 karakter).
- Foto bukti disimpan sebagai data di Redis; paket gratis Upstash cukup untuk ratusan bukti. Pantau pemakaian di dashboard Upstash.
- Jangan set `NODE_ENV=production` tanpa mengisi variabel di atas, server sengaja menolak jalan (ini yang tampil sebagai crash).

## Hosting di Railway (alternatif)

Tanpa Redis: pasang **Volume** di `/data`, set `DATA_DIR=/data` dan variabel yang sama seperti di atas (tanpa `KV_*`).
`railway.json` sudah menyiapkan start command dan healthcheck `/api/health`. Jalankan satu instance saja.

## Yang perlu diketahui

- **Penyimpanan**: Upstash Redis bila `KV_REST_API_*` ada (Vercel), jika tidak memakai file `db.json` + `proofs/` (lokal: `server/data/`, Railway: Volume) (cukup untuk toko kecil/uji coba).
  Untuk produksi besar, pindahkan ke PostgreSQL memakai `database/schema.prisma`.
- **Foto identitas** belum diunggah/disimpan (di versi awal hanya tampilan). Menyimpannya
  butuh bucket privat; nomor identitas sudah dienkripsi AES-256-GCM bila `IDENTITY_ENCRYPTION_KEY` diisi.
- **Ikon** memuat Lucide dari CDN unpkg. Untuk offline, unduh `lucide.min.js` ke `public/js/` dan ubah tag `<script>`.
- **Pesanan Saya** ditautkan ke browser (localStorage) + pencarian kode booking; belum ada login customer.
- Refund tidak otomatis: kembalikan dana lewat transfer manual ke customer.
- Jangan commit `.env`. Ganti password admin sebelum online.
