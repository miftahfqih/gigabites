-- =====================================================================
--  HANYA untuk yang SUDAH PERNAH menjalankan schema.sql versi pertama.
--  Urutan: (1) jalankan ulang schema.sql terbaru  → menambah fitur paket
--          (2) jalankan file ini                  → harga, foto baru, antar gratis
--  Project baru TIDAK perlu file ini.
-- =====================================================================

-- harga baru Gigabites
update public.variants v set price = 18000
  from public.products p
 where p.id = v.product_id and p.category = 'cheesecuit' and v.name = 'Gigabites';

-- pengantaran gratis
update public.settings set delivery_fee = 0,
  delivery_note = 'Gratis antar untuk area sekitar kampus Telkom University (Sukapura & Sukabirus).'
 where id = 1;

-- foto produk baru (latar transparan)
update public.products set image_url = 'assets/menu/chocolate-bar.webp'   where slug = 'chocolate-bar';
update public.products set image_url = 'assets/menu/double-cheese.webp'   where slug = 'double-cheese';
update public.products set image_url = 'assets/menu/lushberry.webp'       where slug = 'lushberry';
update public.products set image_url = 'assets/menu/orange-sunshine.webp' where slug = 'orange-sunshine';
