# Gigabites — Website Pemesanan

Website pre-order cheesecuit & Orange Sunshine. Tanpa build, tanpa server sendiri:
HTML + CSS + JavaScript biasa, database & penyimpanan foto di **Supabase** (gratis),
di-hosting di **Vercel** (gratis).

```
gigabites/
├── index.html            ← halaman pemesanan (pembeli)
├── admin.html            ← dashboard admin (login)
├── css/style.css         ← tampilan pembeli + token warna
├── css/admin.css         ← tampilan admin
├── js/config.js          ← ⚠️ ISI URL & KEY SUPABASE DI SINI
├── js/api.js             ← koneksi Supabase + mode demo
├── js/app.js             ← logika pemesanan
├── js/admin.js           ← logika dashboard
├── js/utils.js           ← format rupiah, tanggal, kompres foto
├── assets/               ← logo, footer, maskot, foto menu & paket
├── supabase/schema.sql   ← tabel, keamanan, fungsi, data awal
├── supabase/update-harga-aset.sql ← hanya jika schema lama sudah terlanjur dijalankan
└── vercel.json
```

---

## 0. Coba dulu di laptop (mode demo, 1 menit)

Selama `js/config.js` masih kosong, website berjalan dalam **mode demo**: data disimpan di browser.

1. Buka folder `gigabites` di VS Code → klik kanan `index.html` → **Open with Live Server**
   (atau cukup klik dua kali `index.html`).
2. Coba pesan sampai selesai (bukti bayar boleh foto apa saja).
3. Buka `admin.html` → email bebas, password **`demo123`** → pesanan tadi muncul.

---

## 1. Siapkan Supabase (±10 menit)

1. Daftar di **https://supabase.com** → **New project**.
   Region: **Southeast Asia (Singapore)**. Simpan password database-nya.
2. Menu kiri **SQL Editor** → **New query** → buka `supabase/schema.sql`, salin **semua isinya**, tempel → **Run**.
   Harus muncul *Success*. Ini membuat tabel, aturan keamanan, tempat upload foto, dan data menu awal.
3. Buat akun admin: **Authentication → Users → Add user → Create new user**
   - isi email & password admin, centang **Auto Confirm User** → Create.
4. Kembali ke **SQL Editor**, jalankan (ganti emailnya):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'admin@gigabites.id';
   ```
   Ulangi langkah 3–4 untuk setiap admin lain.
5. Matikan pendaftaran publik: **Authentication → Sign In / Providers** →
   matikan **Allow new users to sign up** → Save.
   (Walau ada yang berhasil daftar, mereka tetap tidak bisa membuka data karena tidak ada di tabel `admins`.)
6. Ambil kunci: klik tombol **Connect** di atas dashboard (atau **Project Settings → API Keys**), salin:
   - **Project URL** → `https://xxxx.supabase.co`
   - **Publishable key** → `sb_publishable_...`
7. Buka `js/config.js`, isi:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxx',
   ```
   > Publishable key memang aman ditaruh di website — keamanan dijaga aturan RLS di database.
   > **Jangan pernah** menaruh *secret key* / *service_role* di file mana pun di folder ini.

---

## 2. Deploy ke Vercel (±5 menit)

**Cara A — lewat GitHub (disarankan, tiap update otomatis online)**
1. Buat repository baru di GitHub, upload seluruh isi folder `gigabites`
   (bisa drag-and-drop di halaman repo: *Add file → Upload files*).
2. Buka **https://vercel.com** → login dengan GitHub → **Add New… → Project** → pilih repo tadi.
3. Framework Preset: **Other**. Build Command & Output Directory: biarkan kosong → **Deploy**.
4. Selesai. Website: `https://nama-project.vercel.app`, admin: `https://nama-project.vercel.app/admin`.
   Setiap kali kamu mengubah file di GitHub, Vercel otomatis deploy ulang.

**Cara B — tanpa GitHub (paling cepat)**
- Netlify Drop: buka **https://app.netlify.com/drop**, seret folder `gigabites` ke halaman → langsung online.
- Atau Vercel CLI (butuh Node.js): di dalam folder jalankan `npx vercel --prod`.

Ganti nama domain: Vercel → Project → **Settings → Domains** (bisa pakai `gigabites.vercel.app` jika masih tersedia).

---

## 3. Setelah online — atur toko dari dashboard

Buka `/admin`, login, lalu:

1. **Pengaturan** → upload foto **QRIS GoPay**, isi **nomor WhatsApp admin**, ongkir, area antar,
   cek lokasi ambil (TULT Lobby Lantai 1, Kontrakan Pak Bagoes) → **Simpan pengaturan**.
2. **Menu** → cek harga (sudah terisi sesuai daftar harga):
   Megabites Rp15K, Gigabites Rp18K, Mega Drink Rp8K, Giga Drink Rp10K,
   paket Terabites Rp20K, Xtrabites Rp25K, Couplebites Rp43K.
3. **Jadwal** → tambah tanggal penjualan. Pembeli hanya bisa memilih tanggal yang **Dibuka**.
   Bisa diberi kuota (mis. maks 40 pesanan) dan catatan.
4. Coba pesan sekali dari HP sendiri untuk memastikan semuanya jalan.

### Alur harian
| Kejadian | Yang dilakukan admin |
|---|---|
| Pesanan masuk | Muncul notifikasi + badge merah di tab **Pesanan** (status *Verifikasi*) |
| Cek bukti bayar | Klik pesanan → lihat foto bukti → cocokkan dengan mutasi GoPay → status **Diproses** |
| Mau produksi | Tab **Rekap** → *Daftar produksi per varian* = jumlah cup yang harus dibuat |
| Stok habis | Tab **Menu** → klik **Tersedia** jadi **Sold out** (langsung berlaku) |
| Siap / diantar | Ubah status **Siap**, isi *Keterangan pengantaran* (mis. "diantar jam 15.00") — pembeli bisa melihatnya di **Cek pesanan** |
| Bukti palsu / batal | Status **Dibatalkan** (tidak dihitung di pendapatan) |
| Tutup PO | **Jadwal** → matikan tanggalnya, atau **Pengaturan** → matikan *Toko buka* |

**Rekap**: pendapatan terverifikasi (status Diproses/Siap/Selesai), nominal yang masih menunggu
verifikasi, item terjual, per tanggal, per lokasi, dan per **kode referal**. Tombol **Export CSV**
di tab Pesanan untuk dibuka di Excel/Google Sheets.

---

## Paket bundle (Special Bundles)
| Paket | Isi | Harga |
|---|---|---|
| Terabites | 1 Megabites + 1 Mega Drink | Rp20K |
| Xtrabites | 1 Gigabites + 1 Giga Drink | Rp25K |
| Couplebites | 1 Megabites + 1 Gigabites + 2 Mega Drink | Rp43K |

- Pembeli memilih **rasa cheesecuit untuk setiap isi paket** (rasa yang sold out otomatis tidak bisa dipilih).
  Label "Hemat RpX" dihitung otomatis dari harga satuan.
- Paket baru bisa dibuat di **Menu → Tambah menu → Kategori: Paket bundle**, lalu isi bagian *Isi paket*
  (nama varian harus sama dengan varian di menu, mis. `Megabites`, `Gigabites`, `Mega Drink`).
- **Rekap → Daftar produksi** sudah menjumlahkan cup dari pembelian satuan **dan** dari isi paket,
  jadi angka "Total dibuat" = jumlah yang benar-benar harus diproduksi.

### Sudah terlanjur menjalankan schema.sql versi lama?
Di SQL Editor: jalankan ulang **`supabase/schema.sql`** (aman, tidak menghapus data), lalu jalankan
**`supabase/update-harga-aset.sql`** (harga Gigabites Rp18K + foto produk baru).
Project baru cukup menjalankan `schema.sql` saja.

## Keamanan yang sudah dipasang
- Pembeli **tidak bisa** membaca pesanan orang lain; pesanan hanya dibuat lewat fungsi `place_order`.
- **Harga dihitung ulang di database**, jadi harga tidak bisa diakali dari browser.
- Validasi di server: nomor WA, tanggal masih dibuka, kuota, stok sold out, kode referal 3 huruf, wajib bukti bayar.
- Foto bukti bayar disimpan di bucket **privat**; hanya admin yang bisa membuka (link sementara 1 jam).
- Dashboard hanya untuk akun yang terdaftar di tabel `admins`.

## Kustomisasi
- **Maskot**: ganti `assets/mascot.svg` dengan file maskot Biti kalian (nama sama, atau PNG lalu ubah nama file di `index.html`/`admin.html`).
- **Foto menu**: upload langsung dari dashboard (Menu → Edit → Ganti foto). Foto berlatar transparan (PNG/WebP) paling bagus.
- **Warna**: variabel di bagian atas `css/style.css` (`--cocoa`, `--biscuit`, `--cream`, `--sun`).
- **Instagram**: `INSTAGRAM` di `js/config.js`.

## Kalau ada masalah
| Gejala | Penyebab & solusi |
|---|---|
| Masih muncul "Mode demo" setelah deploy | `js/config.js` belum terisi / belum ikut ter-upload. Hard refresh (Ctrl+Shift+R). |
| "Menu belum bisa dimuat" | URL/key salah, atau `schema.sql` belum di-Run. |
| Login admin: "belum terdaftar sebagai admin" | Langkah 1.4 (insert ke `admins`) belum dijalankan / email beda. |
| Login admin: "Email not confirmed" | Saat buat user lupa centang *Auto Confirm User* → hapus user, buat ulang. |
| Upload bukti gagal | Pastikan bagian STORAGE di `schema.sql` ikut ter-Run (cek menu Storage ada `payment-proofs`). |
| Notifikasi pesanan baru tidak muncul otomatis | Database → Publications → `supabase_realtime` → aktifkan tabel `orders`. Dashboard tetap memuat ulang tiap 60 detik. |
| Website mati setelah lama tidak dipakai | Project Supabase gratis dijeda jika tidak ada aktivitas sekitar seminggu → buka dashboard Supabase → **Restore project**. |
