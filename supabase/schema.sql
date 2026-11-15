-- =====================================================================
--  GIGABITES — skema database Supabase
--  Cara pakai: Supabase Dashboard → SQL Editor → New query →
--  tempel SELURUH isi file ini → Run. Aman dijalankan sekali di project baru.
-- =====================================================================

-- ---------- TABEL ----------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,
  name        text not null,
  tagline     text,
  description text,
  category    text not null check (category in ('cheesecuit','drink','bundle')),
  image_url   text,
  accent      text not null default '#C8955F',
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  is_sold_out boolean not null default false,
  created_at  timestamptz not null default now()
);

-- isi paket bundle, contoh: [{"category":"cheesecuit","variant_name":"Megabites","qty":1},
--                           {"category":"drink","variant_name":"Mega Drink","qty":1}]
alter table public.products add column if not exists bundle_slots jsonb not null default '[]'::jsonb;
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('cheesecuit','drink','bundle'));

create table if not exists public.variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,             -- Megabites / Gigabites / Mega Drink / Giga Drink
  size_label  text not null,             -- 120 ml / 150 ml / 14 oz / 16 oz
  price       int  not null check (price >= 0),
  is_sold_out boolean not null default false,
  sort_order  int  not null default 0
);

create table if not exists public.sale_dates (
  id         uuid primary key default gen_random_uuid(),
  sale_date  date not null unique,
  is_open    boolean not null default true,
  note       text,
  max_orders int check (max_orders is null or max_orders > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id               int primary key default 1 check (id = 1),
  store_open       boolean not null default true,
  announcement     text,
  qris_image_url   text,
  qris_name        text default 'GIGABITES',
  delivery_fee     int not null default 0 check (delivery_fee >= 0),
  delivery_note    text,
  pickup_locations jsonb not null default '[]'::jsonb,
  admin_whatsapp   text,
  updated_at       timestamptz not null default now()
);

create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_code         text not null unique,
  customer_name      text not null,
  phone              text not null,
  method             text not null check (method in ('pickup','delivery')),
  sale_date          date not null,
  pickup_location    text,
  address            text,
  notes              text,
  referral_code      text check (referral_code is null or referral_code ~ '^[A-Z]{3}$'),
  subtotal           int not null,
  delivery_fee       int not null default 0,
  total              int not null,
  payment_proof_path text,
  status             text not null default 'menunggu_verifikasi'
                     check (status in ('menunggu_verifikasi','diproses','siap','selesai','dibatalkan')),
  admin_note         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists orders_sale_date_idx on public.orders (sale_date);
create index if not exists orders_created_idx   on public.orders (created_at desc);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  variant_id   uuid references public.variants(id) on delete set null,
  product_name text not null,
  variant_name text not null,
  size_label   text,
  unit_price   int not null,
  qty          int not null check (qty > 0),
  line_total   int not null,
  note         text
);
create index if not exists order_items_order_idx on public.order_items (order_id);
-- untuk paket: rasa yang dipilih pembeli di tiap isi paket
alter table public.order_items add column if not exists components jsonb;

-- updated_at otomatis
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- Hak akses dasar (RLS di bawah tetap membatasi baris yang boleh disentuh)
grant usage on schema public to anon, authenticated;
grant select on public.products, public.variants, public.sale_dates, public.settings to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------- HELPER ADMIN --------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- ROW LEVEL SECURITY --------------------------------------

alter table public.admins      enable row level security;
alter table public.products    enable row level security;
alter table public.variants    enable row level security;
alter table public.sale_dates  enable row level security;
alter table public.settings    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- admin hanya bisa melihat barisnya sendiri (untuk cek status admin)
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated
  using (user_id = auth.uid());

-- menu, jadwal, pengaturan: publik boleh baca, hanya admin yang ubah
drop policy if exists products_read on public.products;
create policy products_read on public.products for select using (true);
drop policy if exists products_admin on public.products;
create policy products_admin on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists variants_read on public.variants;
create policy variants_read on public.variants for select using (true);
drop policy if exists variants_admin on public.variants;
create policy variants_admin on public.variants for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists sale_dates_read on public.sale_dates;
create policy sale_dates_read on public.sale_dates for select using (true);
drop policy if exists sale_dates_admin on public.sale_dates;
create policy sale_dates_admin on public.sale_dates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- pesanan: TIDAK bisa dibaca publik. Pembeli membuat pesanan lewat fungsi place_order.
drop policy if exists orders_admin on public.orders;
create policy orders_admin on public.orders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_items_admin on public.order_items;
create policy order_items_admin on public.order_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- FUNGSI UNTUK PEMBELI (RPC) -------------------------------

-- Menghitung harga dari database (harga di browser tidak dipercaya)
create or replace function public.quote_order(p_items jsonb, p_method text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s        public.settings%rowtype;
  it       jsonb;
  v        record;
  c        record;
  slot     jsonb;
  picks    jsonb;
  comps    jsonb;
  pick_id  uuid;
  idx      int;
  k        int;
  q        int;
  subtotal int := 0;
  fee      int := 0;
  lines    jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if not found or not s.store_open then
    raise exception 'Toko sedang tutup. Coba lagi nanti ya.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang masih kosong.';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Terlalu banyak baris item dalam satu pesanan.';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    q := coalesce((it->>'qty')::int, 0);
    if q < 1 or q > 50 then
      raise exception 'Jumlah tiap item harus antara 1 dan 50.';
    end if;

    select vr.id, vr.name as vname, vr.size_label, vr.price, vr.is_sold_out as v_so,
           p.name as pname, p.is_active, p.is_sold_out as p_so, p.category, p.bundle_slots
      into v
      from public.variants vr join public.products p on p.id = vr.product_id
     where vr.id = (it->>'variant_id')::uuid;

    if not found then
      raise exception 'Ada menu di keranjang yang sudah tidak tersedia. Hapus lalu coba lagi.';
    end if;
    if not v.is_active then
      raise exception '% sudah tidak dijual. Hapus dari keranjang lalu coba lagi.', v.pname;
    end if;
    if v.v_so or v.p_so then
      raise exception '% % sudah sold out. Hapus dari keranjang lalu coba lagi.', v.pname, v.vname;
    end if;

    -- paket: cek rasa pilihan untuk setiap isi paket
    comps := null;
    if v.category = 'bundle' then
      comps := '[]'::jsonb;
      picks := coalesce(it->'picks', '[]'::jsonb);
      if jsonb_typeof(picks) <> 'array' then picks := '[]'::jsonb; end if;
      idx := 0;
      for slot in select * from jsonb_array_elements(v.bundle_slots) loop
        for k in 1 .. greatest(coalesce((slot->>'qty')::int, 1), 1) loop
          pick_id := nullif(picks->>idx, '')::uuid;
          idx := idx + 1;
          if pick_id is null then
            raise exception 'Pilih rasa untuk semua isi paket %.', v.pname;
          end if;
          select cv.id, cv.name as cvname, cv.size_label as csize, cv.is_sold_out as cv_so,
                 cp.name as cpname, cp.category as ccat, cp.is_active as c_act, cp.is_sold_out as cp_so
            into c
            from public.variants cv join public.products cp on cp.id = cv.product_id
           where cv.id = pick_id;
          if not found then
            raise exception 'Pilihan isi paket % tidak valid. Pilih ulang ya.', v.pname;
          end if;
          if c.ccat <> (slot->>'category') or lower(c.cvname) <> lower(slot->>'variant_name') or not c.c_act then
            raise exception 'Pilihan isi paket % tidak valid. Pilih ulang ya.', v.pname;
          end if;
          if c.cv_so or c.cp_so then
            raise exception '% % (isi paket %) sudah sold out. Pilih rasa lain.', c.cpname, c.cvname, v.pname;
          end if;
          comps := comps || jsonb_build_object('variant_id', c.id, 'product_name', c.cpname,
                                               'variant_name', c.cvname, 'size_label', c.csize);
        end loop;
      end loop;
      if idx = 0 then
        raise exception 'Isi paket % belum diatur admin.', v.pname;
      end if;
    end if;

    subtotal := subtotal + v.price * q;
    lines := lines || jsonb_build_object(
      'variant_id', v.id, 'product_name', v.pname, 'variant_name', v.vname,
      'size_label', v.size_label, 'unit_price', v.price, 'qty', q,
      'line_total', v.price * q, 'note', left(nullif(trim(it->>'note'), ''), 200),
      'components', comps);
  end loop;

  -- pengantaran GRATIS: tidak ada ongkir
  if p_method is null or p_method not in ('pickup', 'delivery') then
    raise exception 'Pilih cara terima: diambil atau diantar.';
  end if;

  return jsonb_build_object('subtotal', subtotal, 'delivery_fee', fee,
                            'total', subtotal + fee, 'items', lines);
end $$;

create or replace function public.place_order(
  p_name text, p_phone text, p_method text, p_sale_date date,
  p_pickup_location text, p_address text, p_notes text,
  p_referral text, p_items jsonb, p_proof_path text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s      public.settings%rowtype;
  d      public.sale_dates%rowtype;
  qt     jsonb;
  code   text;
  oid    uuid;
  ph     text;
  ref    text;
  cnt    int;
  today  date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if coalesce(length(trim(p_name)), 0) < 2 then
    raise exception 'Nama wajib diisi.';
  end if;

  ph := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if ph like '62%' then ph := '0' || substr(ph, 3); end if;
  if ph !~ '^08[0-9]{7,12}$' then
    raise exception 'Nomor WhatsApp tidak valid. Contoh: 081234567890';
  end if;

  ref := upper(nullif(trim(coalesce(p_referral, '')), ''));
  if ref is not null and ref !~ '^[A-Z]{3}$' then
    raise exception 'Kode referal harus 3 huruf.';
  end if;

  select * into d from public.sale_dates where sale_date = p_sale_date;
  if not found or not d.is_open or p_sale_date < today then
    raise exception 'Tanggal yang dipilih sudah tidak tersedia. Pilih tanggal lain.';
  end if;
  if d.max_orders is not null then
    select count(*) into cnt from public.orders
     where sale_date = p_sale_date and status <> 'dibatalkan';
    if cnt >= d.max_orders then
      raise exception 'Kuota pesanan untuk tanggal ini sudah penuh. Pilih tanggal lain.';
    end if;
  end if;

  select * into s from public.settings where id = 1;
  if p_method = 'pickup' then
    if not exists (select 1 from jsonb_array_elements(s.pickup_locations) e
                    where e->>'name' = p_pickup_location) then
      raise exception 'Pilih lokasi pengambilan.';
    end if;
  elsif p_method = 'delivery' then
    if coalesce(length(trim(p_address)), 0) < 8 then
      raise exception 'Alamat pengantaran terlalu singkat. Tulis alamat lengkap.';
    end if;
  end if;

  if coalesce(p_proof_path, '') !~ '^proofs/[A-Za-z0-9/_.-]+$' then
    raise exception 'Bukti pembayaran wajib diunggah.';
  end if;

  qt := public.quote_order(p_items, p_method);

  loop
    code := 'GB' || to_char(now() at time zone 'Asia/Jakarta', 'DDMM') || '-' ||
            upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.orders where order_code = code);
  end loop;

  insert into public.orders (order_code, customer_name, phone, method, sale_date,
      pickup_location, address, notes, referral_code, subtotal, delivery_fee, total,
      payment_proof_path)
  values (code, left(trim(p_name), 80), ph, p_method, p_sale_date,
      case when p_method = 'pickup' then p_pickup_location end,
      case when p_method = 'delivery' then left(trim(p_address), 400) end,
      left(nullif(trim(p_notes), ''), 500), ref,
      (qt->>'subtotal')::int, (qt->>'delivery_fee')::int, (qt->>'total')::int,
      p_proof_path)
  returning id into oid;

  insert into public.order_items (order_id, variant_id, product_name, variant_name,
      size_label, unit_price, qty, line_total, note, components)
  select oid, (x->>'variant_id')::uuid, x->>'product_name', x->>'variant_name',
         x->>'size_label', (x->>'unit_price')::int, (x->>'qty')::int,
         (x->>'line_total')::int, x->>'note',
         case when jsonb_typeof(x->'components') = 'array' then x->'components' end
    from jsonb_array_elements(qt->'items') x;

  return jsonb_build_object('order_code', code, 'total', (qt->>'total')::int);
end $$;

-- Pembeli cek status pakai kode pesanan + nomor WA (tanpa login)
create or replace function public.check_order(p_code text, p_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o  public.orders%rowtype;
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if ph like '62%' then ph := '0' || substr(ph, 3); end if;
  select * into o from public.orders
   where order_code = upper(trim(p_code)) and phone = ph;
  if not found then return null; end if;
  return jsonb_build_object(
    'order_code', o.order_code, 'status', o.status, 'sale_date', o.sale_date,
    'method', o.method, 'pickup_location', o.pickup_location, 'total', o.total,
    'admin_note', o.admin_note, 'customer_name', o.customer_name,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'product_name', product_name, 'variant_name', variant_name, 'qty', qty,
                'components', components)), '[]'::jsonb)
                from public.order_items where order_id = o.id));
end $$;

grant execute on function public.quote_order(jsonb, text) to anon, authenticated;
grant execute on function public.place_order(text, text, text, date, text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.check_order(text, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- STORAGE (bukti bayar & gambar) ---------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('public-assets',  'public-assets',  true,  5242880, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists "gb proof upload" on storage.objects;
create policy "gb proof upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = 'proofs');

drop policy if exists "gb proof admin read" on storage.objects;
create policy "gb proof admin read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

drop policy if exists "gb proof admin delete" on storage.objects;
create policy "gb proof admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

drop policy if exists "gb assets admin" on storage.objects;
create policy "gb assets admin" on storage.objects for all to authenticated
  using (bucket_id = 'public-assets' and public.is_admin())
  with check (bucket_id = 'public-assets' and public.is_admin());

-- ---------- REALTIME (notifikasi pesanan baru di dashboard) ----------
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when others then null; end $$;

-- ---------- DATA AWAL (harga bisa diubah di dashboard admin) --------

insert into public.settings (id, store_open, announcement, delivery_fee, delivery_note,
                             pickup_locations, admin_whatsapp)
values (1, true, null, 0,
        'Gratis antar untuk area sekitar kampus Telkom University (Sukapura & Sukabirus).',
        '[{"name":"TULT Lobby Lantai 1","detail":"Gedung TULT, lobby lantai 1. Kabari kami saat sudah sampai."},
          {"name":"Kontrakan Pak Bagoes","detail":"Ambil langsung di kontrakan Pak Bagoes."}]'::jsonb,
        null)
on conflict (id) do nothing;

insert into public.products (slug, name, tagline, description, category, image_url, accent, sort_order)
values
  ('chocolate-bar', 'Chocolate Bar', 'Melted',
   'Perpaduan cokelat pekat dan taburan choco chips melimpah yang lumer di setiap gigitan.',
   'cheesecuit', 'assets/menu/chocolate-bar.webp', '#8E2B1E', 1),
  ('double-cheese', 'Double Cheese', 'Creamy',
   'Gurihnya keju berlapis dobel dengan keju parut melimpah, dijamin bikin nagih!',
   'cheesecuit', 'assets/menu/double-cheese.webp', '#F29A0E', 2),
  ('lushberry', 'Lushberry', 'Fresh',
   'Sensasi segar selai berry berpadu lembutnya cream cheese, manisnya pas di lidah.',
   'cheesecuit', 'assets/menu/lushberry.webp', '#5B2A7A', 3),
  ('orange-sunshine', 'Orange Sunshine', 'Giga Drink',
   'Jeruk segar dengan jelly kenyal di setiap sedotan.',
   'drink', 'assets/menu/orange-sunshine.webp', '#FFB300', 4)
on conflict (slug) do nothing;

insert into public.products (slug, name, tagline, description, category, image_url, accent, sort_order, bundle_slots)
values
  ('terabites', 'Terabites', 'Special Bundle',
   '1 Megabites (120 ml) rasa bebas + 1 Mega Drink (14 oz).',
   'bundle', 'assets/menu/terabites.webp', '#5C3A24', 5,
   '[{"category":"cheesecuit","variant_name":"Megabites","qty":1},{"category":"drink","variant_name":"Mega Drink","qty":1}]'::jsonb),
  ('xtrabites', 'Xtrabites', 'Special Bundle',
   '1 Gigabites (150 ml) rasa bebas + 1 Giga Drink (16 oz).',
   'bundle', 'assets/menu/xtrabites.webp', '#3E2415', 6,
   '[{"category":"cheesecuit","variant_name":"Gigabites","qty":1},{"category":"drink","variant_name":"Giga Drink","qty":1}]'::jsonb),
  ('couplebites', 'Couplebites', 'Special Bundle',
   'Berdua lebih hemat: 1 Megabites + 1 Gigabites (rasa bebas) + 2 Mega Drink.',
   'bundle', 'assets/menu/couplebites.webp', '#8E2B1E', 7,
   '[{"category":"cheesecuit","variant_name":"Megabites","qty":1},{"category":"cheesecuit","variant_name":"Gigabites","qty":1},{"category":"drink","variant_name":"Mega Drink","qty":2}]'::jsonb)
on conflict (slug) do nothing;

insert into public.variants (product_id, name, size_label, price, sort_order)
select p.id, v.name, v.size_label, v.price, v.sort_order
from public.products p
join (values
  ('chocolate-bar',   'Megabites',  '120 ml', 15000, 1),
  ('chocolate-bar',   'Gigabites',  '150 ml', 18000, 2),
  ('double-cheese',   'Megabites',  '120 ml', 15000, 1),
  ('double-cheese',   'Gigabites',  '150 ml', 18000, 2),
  ('lushberry',       'Megabites',  '120 ml', 15000, 1),
  ('lushberry',       'Gigabites',  '150 ml', 18000, 2),
  ('orange-sunshine', 'Mega Drink', '14 oz',   8000, 1),
  ('orange-sunshine', 'Giga Drink', '16 oz',  10000, 2),
  ('terabites',       'Paket',      '1 cup + 1 drink',   20000, 1),
  ('xtrabites',       'Paket',      '1 cup + 1 drink',   25000, 1),
  ('couplebites',     'Paket',      '2 cup + 2 drink',   43000, 1)
) as v(slug, name, size_label, price, sort_order) on v.slug = p.slug
where not exists (select 1 from public.variants x where x.product_id = p.id);

insert into public.sale_dates (sale_date, is_open, note)
select ((now() at time zone 'Asia/Jakarta')::date + n), true, null
from generate_series(1, 3) n
on conflict (sale_date) do nothing;

-- =====================================================================
--  LANGKAH TERAKHIR (jalankan terpisah SETELAH membuat user admin di
--  Authentication → Users → Add user). Ganti emailnya:
--
--  insert into public.admins (user_id)
--  select id from auth.users where email = 'admin@gigabites.id';
-- =====================================================================