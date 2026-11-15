/*
 * Lapisan data. Ada 2 implementasi dengan fungsi yang sama:
 *  - SupabaseApi : dipakai saat config.js sudah diisi (mode produksi)
 *  - DemoApi     : data disimpan di localStorage (mode demo / coba-coba)
 */
(function () {
  const cfg = window.GIGABITES_CONFIG || {};
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY;
  const configured = !!(cfg.SUPABASE_URL && KEY);

  const sortVariants = (products) =>
    products.map((p) => ({ ...p, variants: (p.variants || []).slice().sort((a, b) => a.sort_order - b.sort_order) }));

  /* ================= SUPABASE ================= */
  function SupabaseApi() {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Library Supabase gagal dimuat. Cek koneksi internet lalu muat ulang halaman.');
    }
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, KEY);
    const ok = (res) => { if (res.error) throw res.error; return res.data; };

    return {
      demo: false,

      async getStorefront() {
        const [s, p, d] = await Promise.all([
          sb.from('settings').select('*').eq('id', 1).single(),
          sb.from('products').select('*, variants(*)').eq('is_active', true).order('sort_order'),
          sb.from('sale_dates').select('*').eq('is_open', true).gte('sale_date', U.todayJakarta()).order('sale_date'),
        ]);
        return { settings: ok(s), products: sortVariants(ok(p)), saleDates: ok(d) };
      },

      async quote(items, method) {
        return ok(await sb.rpc('quote_order', { p_items: items, p_method: method }));
      },

      async uploadProof(blob) {
        const path = `proofs/${U.todayJakarta()}/${U.randomId(16)}.jpg`;
        ok(await sb.storage.from('payment-proofs').upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
        return path;
      },

      async placeOrder(o) {
        return ok(await sb.rpc('place_order', {
          p_name: o.name, p_phone: o.phone, p_method: o.method, p_sale_date: o.sale_date,
          p_pickup_location: o.pickup_location || null, p_address: o.address || null,
          p_notes: o.notes || null, p_referral: o.referral || null,
          p_items: o.items, p_proof_path: o.proof_path,
        }));
      },

      async checkOrder(code, phone) {
        return ok(await sb.rpc('check_order', { p_code: code, p_phone: phone }));
      },

      /* ----- admin ----- */
      async signIn(email, password) {
        ok(await sb.auth.signInWithPassword({ email, password }));
        const isAdmin = ok(await sb.rpc('is_admin'));
        if (!isAdmin) {
          await sb.auth.signOut();
          throw new Error('Akun ini belum terdaftar sebagai admin.');
        }
        return true;
      },
      async signOut() { await sb.auth.signOut(); },
      async currentAdmin() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        const isAdmin = ok(await sb.rpc('is_admin'));
        return isAdmin ? { email: data.session.user.email } : null;
      },

      async listOrders({ from, to }) {
        let q = sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(2000);
        if (from) q = q.gte('sale_date', from);
        if (to) q = q.lte('sale_date', to);
        return ok(await q);
      },
      async updateOrder(id, patch) {
        return ok(await sb.from('orders').update(patch).eq('id', id).select().single());
      },
      async deleteOrder(order) {
        if (order.payment_proof_path) await sb.storage.from('payment-proofs').remove([order.payment_proof_path]);
        ok(await sb.from('orders').delete().eq('id', order.id));
      },
      async proofUrl(path) {
        if (!path) return null;
        const d = ok(await sb.storage.from('payment-proofs').createSignedUrl(path, 3600));
        return d.signedUrl;
      },

      async listProducts() {
        return sortVariants(ok(await sb.from('products').select('*, variants(*)').order('sort_order')));
      },
      async saveProduct(p, variants, deletedVariantIds) {
        const row = {
          name: p.name, slug: p.slug || null, tagline: p.tagline || null, description: p.description || null,
          category: p.category, image_url: p.image_url || null, accent: p.accent || '#C8955F',
          sort_order: Number(p.sort_order) || 0, is_active: !!p.is_active, is_sold_out: !!p.is_sold_out,
          bundle_slots: p.category === 'bundle' ? (p.bundle_slots || []) : [],
        };
        const saved = p.id
          ? ok(await sb.from('products').update(row).eq('id', p.id).select().single())
          : ok(await sb.from('products').insert(row).select().single());
        if (deletedVariantIds && deletedVariantIds.length) ok(await sb.from('variants').delete().in('id', deletedVariantIds));
        for (const [i, v] of variants.entries()) {
          const vr = { product_id: saved.id, name: v.name, size_label: v.size_label, price: Number(v.price) || 0, is_sold_out: !!v.is_sold_out, sort_order: i + 1 };
          if (v.id) ok(await sb.from('variants').update(vr).eq('id', v.id));
          else ok(await sb.from('variants').insert(vr));
        }
        return saved;
      },
      async quickUpdateProduct(id, patch) { ok(await sb.from('products').update(patch).eq('id', id)); },
      async quickUpdateVariant(id, patch) { ok(await sb.from('variants').update(patch).eq('id', id)); },
      async deleteProduct(id) { ok(await sb.from('products').delete().eq('id', id)); },

      async uploadAsset(blob, prefix) {
        const path = `${prefix}/${U.randomId(12)}.jpg`;
        ok(await sb.storage.from('public-assets').upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
        return sb.storage.from('public-assets').getPublicUrl(path).data.publicUrl;
      },

      async listSaleDates(from) {
        let q = sb.from('sale_dates').select('*').order('sale_date');
        if (from) q = q.gte('sale_date', from);
        return ok(await q);
      },
      async saveSaleDate(d) {
        const row = { sale_date: d.sale_date, is_open: !!d.is_open, note: d.note || null, max_orders: d.max_orders ? Number(d.max_orders) : null };
        return d.id
          ? ok(await sb.from('sale_dates').update(row).eq('id', d.id).select().single())
          : ok(await sb.from('sale_dates').insert(row).select().single());
      },
      async deleteSaleDate(id) { ok(await sb.from('sale_dates').delete().eq('id', id)); },

      async getSettings() { return ok(await sb.from('settings').select('*').eq('id', 1).single()); },
      async saveSettings(s) {
        const { id, updated_at, ...rest } = s;
        return ok(await sb.from('settings').update(rest).eq('id', 1).select().single());
      },

      onNewOrder(cb) {
        sb.channel('orders-insert')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => cb(payload.new))
          .subscribe();
      },
    };
  }

  /* ================= DEMO (localStorage) ================= */
  function DemoApi() {
    const KEY = 'gb_demo_db_v3';
    const uid = () => 'demo-' + U.randomId(12);
    const addDays = (n) => {
      const d = U.parseDate(U.todayJakarta());
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };

    function seed() {
      const P = (slug, name, tagline, description, category, image_url, accent, sort_order, vs, bundle_slots = []) => {
        const id = uid();
        return {
          id, slug, name, tagline, description, category, image_url, accent, sort_order, is_active: true, is_sold_out: false, bundle_slots,
          variants: vs.map(([n, s, price], i) => ({ id: uid(), product_id: id, name: n, size_label: s, price, is_sold_out: false, sort_order: i + 1 })),
        };
      };
      const cheese = [['Megabites', '120 ml', 15000], ['Gigabites', '150 ml', 18000]];
      return {
        settings: {
          id: 1, store_open: true, announcement: 'Mode demo: pesanan hanya tersimpan di browser ini.',
          qris_image_url: '', qris_name: 'GIGABITES', delivery_fee: 0,
          delivery_note: 'Gratis antar untuk area sekitar kampus Telkom University (Sukapura & Sukabirus).',
          pickup_locations: [
            { name: 'TULT Lobby Lantai 1', detail: 'Gedung TULT, lobby lantai 1. Kabari kami saat sudah sampai.' },
            { name: 'Kontrakan Pak Bagoes', detail: 'Ambil langsung di kontrakan Pak Bagoes.' },
          ],
          admin_whatsapp: '',
        },
        products: [
          P('chocolate-bar', 'Chocolate Bar', 'Melted', 'Perpaduan cokelat pekat dan taburan choco chips melimpah yang lumer di setiap gigitan.', 'cheesecuit', 'assets/menu/chocolate-bar.webp', '#8E2B1E', 1, cheese),
          P('double-cheese', 'Double Cheese', 'Creamy', 'Gurihnya keju berlapis dobel dengan keju parut melimpah, dijamin bikin nagih!', 'cheesecuit', 'assets/menu/double-cheese.webp', '#F29A0E', 2, cheese),
          P('lushberry', 'Lushberry', 'Fresh', 'Sensasi segar selai berry berpadu lembutnya cream cheese, manisnya pas di lidah.', 'cheesecuit', 'assets/menu/lushberry.webp', '#5B2A7A', 3, cheese),
          P('orange-sunshine', 'Orange Sunshine', 'Giga Drink', 'Jeruk segar dengan jelly kenyal di setiap sedotan.', 'drink', 'assets/menu/orange-sunshine.webp', '#FFB300', 4, [['Mega Drink', '14 oz', 8000], ['Giga Drink', '16 oz', 10000]]),
          P('terabites', 'Terabites', 'Special Bundle', '1 Megabites (120 ml) rasa bebas + 1 Mega Drink (14 oz).', 'bundle', 'assets/menu/terabites.webp', '#5C3A24', 5, [['Paket', '1 cup + 1 drink', 20000]],
            [{ category: 'cheesecuit', variant_name: 'Megabites', qty: 1 }, { category: 'drink', variant_name: 'Mega Drink', qty: 1 }]),
          P('xtrabites', 'Xtrabites', 'Special Bundle', '1 Gigabites (150 ml) rasa bebas + 1 Giga Drink (16 oz).', 'bundle', 'assets/menu/xtrabites.webp', '#3E2415', 6, [['Paket', '1 cup + 1 drink', 25000]],
            [{ category: 'cheesecuit', variant_name: 'Gigabites', qty: 1 }, { category: 'drink', variant_name: 'Giga Drink', qty: 1 }]),
          P('couplebites', 'Couplebites', 'Special Bundle', 'Berdua lebih hemat: 1 Megabites + 1 Gigabites (rasa bebas) + 2 Mega Drink.', 'bundle', 'assets/menu/couplebites.webp', '#8E2B1E', 7, [['Paket', '2 cup + 2 drink', 43000]],
            [{ category: 'cheesecuit', variant_name: 'Megabites', qty: 1 }, { category: 'cheesecuit', variant_name: 'Gigabites', qty: 1 }, { category: 'drink', variant_name: 'Mega Drink', qty: 2 }]),
        ],
        sale_dates: [1, 2, 3].map((n) => ({ id: uid(), sale_date: addDays(n), is_open: true, note: null, max_orders: null })),
        orders: [],
      };
    }

    const load = () => U.store.get(KEY, null) || (() => { const d = seed(); U.store.set(KEY, d); return d; })();
    const save = (db) => U.store.set(KEY, db);
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
    const blobToDataUrl = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

    function quoteSync(db, items, method) {
      if (!db.settings.store_open) throw new Error('Toko sedang tutup. Coba lagi nanti ya.');
      if (!items || !items.length) throw new Error('Keranjang masih kosong.');
      let subtotal = 0;
      const lines = items.map((it) => {
        const qty = Number(it.qty);
        if (!(qty >= 1 && qty <= 50)) throw new Error('Jumlah tiap item harus antara 1 dan 50.');
        let prod, v;
        for (const p of db.products) { const f = p.variants.find((x) => x.id === it.variant_id); if (f) { prod = p; v = f; } }
        if (!v || !prod.is_active) throw new Error('Ada menu di keranjang yang sudah tidak tersedia. Hapus lalu coba lagi.');
        if (v.is_sold_out || prod.is_sold_out) throw new Error(`${prod.name} ${v.name} sudah sold out. Hapus dari keranjang lalu coba lagi.`);
        let components = null;
        if (prod.category === 'bundle') {
          components = [];
          const picks = it.picks || [];
          let idx = 0;
          for (const slot of prod.bundle_slots || []) {
            for (let k = 0; k < Math.max(1, slot.qty || 1); k++) {
              const pid = picks[idx++];
              if (!pid) throw new Error(`Pilih rasa untuk semua isi paket ${prod.name}.`);
              let cp, cv;
              for (const p of db.products) { const f = p.variants.find((x) => x.id === pid); if (f) { cp = p; cv = f; } }
              if (!cv || cp.category !== slot.category || cv.name.toLowerCase() !== slot.variant_name.toLowerCase() || !cp.is_active) throw new Error(`Pilihan isi paket ${prod.name} tidak valid. Pilih ulang ya.`);
              if (cv.is_sold_out || cp.is_sold_out) throw new Error(`${cp.name} ${cv.name} (isi paket ${prod.name}) sudah sold out. Pilih rasa lain.`);
              components.push({ variant_id: cv.id, product_name: cp.name, variant_name: cv.name, size_label: cv.size_label });
            }
          }
          if (!idx) throw new Error(`Isi paket ${prod.name} belum diatur admin.`);
        }
        subtotal += v.price * qty;
        return { variant_id: v.id, product_name: prod.name, variant_name: v.name, size_label: v.size_label, unit_price: v.price, qty, line_total: v.price * qty, note: (it.note || '').trim().slice(0, 200) || null, components };
      });
      if (method !== 'pickup' && method !== 'delivery') throw new Error('Pilih cara terima: diambil atau diantar.');
      // pengantaran gratis
      return { subtotal, delivery_fee: 0, total: subtotal, items: lines };
    }

    let session = U.store.get('gb_demo_session', null);

    return {
      demo: true,
      async getStorefront() {
        await wait(200);
        const db = load();
        const today = U.todayJakarta();
        return {
          settings: clone(db.settings),
          products: sortVariants(clone(db.products.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order))),
          saleDates: clone(db.sale_dates.filter((d) => d.is_open && d.sale_date >= today).sort((a, b) => a.sale_date.localeCompare(b.sale_date))),
        };
      },
      async quote(items, method) { await wait(); return quoteSync(load(), items, method); },
      async uploadProof(blob) { await wait(400); return blobToDataUrl(blob); },
      async placeOrder(o) {
        await wait(500);
        const db = load();
        if ((o.name || '').trim().length < 2) throw new Error('Nama wajib diisi.');
        if (!U.validPhone(o.phone)) throw new Error('Nomor WhatsApp tidak valid. Contoh: 081234567890');
        const ref = (o.referral || '').trim().toUpperCase() || null;
        if (ref && !/^[A-Z]{3}$/.test(ref)) throw new Error('Kode referal harus 3 huruf.');
        const d = db.sale_dates.find((x) => x.sale_date === o.sale_date);
        if (!d || !d.is_open || o.sale_date < U.todayJakarta()) throw new Error('Tanggal yang dipilih sudah tidak tersedia. Pilih tanggal lain.');
        if (d.max_orders && db.orders.filter((x) => x.sale_date === o.sale_date && x.status !== 'dibatalkan').length >= d.max_orders) throw new Error('Kuota pesanan untuk tanggal ini sudah penuh. Pilih tanggal lain.');
        if (o.method === 'pickup' && !db.settings.pickup_locations.some((l) => l.name === o.pickup_location)) throw new Error('Pilih lokasi pengambilan.');
        if (o.method === 'delivery' && (o.address || '').trim().length < 8) throw new Error('Alamat pengantaran terlalu singkat. Tulis alamat lengkap.');
        if (!o.proof_path) throw new Error('Bukti pembayaran wajib diunggah.');
        const q = quoteSync(db, o.items, o.method);
        const now = new Date();
        const code = 'GB' + String(now.getDate()).padStart(2, '0') + String(now.getMonth() + 1).padStart(2, '0') + '-' + U.randomId(4).toUpperCase();
        const id = uid();
        db.orders.unshift({
          id, order_code: code, customer_name: o.name.trim(), phone: U.normalizePhone(o.phone), method: o.method, sale_date: o.sale_date,
          pickup_location: o.method === 'pickup' ? o.pickup_location : null, address: o.method === 'delivery' ? o.address.trim() : null,
          notes: (o.notes || '').trim() || null, referral_code: ref, subtotal: q.subtotal, delivery_fee: q.delivery_fee, total: q.total,
          payment_proof_path: o.proof_path, status: 'menunggu_verifikasi', admin_note: null, created_at: now.toISOString(), updated_at: now.toISOString(),
          order_items: q.items.map((it) => ({ id: uid(), order_id: id, ...it })),
        });
        save(db);
        return { order_code: code, total: q.total };
      },
      async checkOrder(code, phone) {
        await wait();
        const o = load().orders.find((x) => x.order_code === code.trim().toUpperCase() && x.phone === U.normalizePhone(phone));
        if (!o) return null;
        return { ...clone(o), items: o.order_items };
      },

      async signIn(email, password) {
        await wait(400);
        if (password !== 'demo123') throw new Error('Mode demo: password admin adalah demo123');
        session = { email };
        U.store.set('gb_demo_session', session);
        return true;
      },
      async signOut() { session = null; U.store.del('gb_demo_session'); },
      async currentAdmin() { return session; },

      async listOrders({ from, to }) {
        await wait(150);
        return clone(load().orders.filter((o) => (!from || o.sale_date >= from) && (!to || o.sale_date <= to)));
      },
      async updateOrder(id, patch) {
        const db = load();
        const o = db.orders.find((x) => x.id === id);
        Object.assign(o, patch, { updated_at: new Date().toISOString() });
        save(db);
        return clone(o);
      },
      async deleteOrder(order) { const db = load(); db.orders = db.orders.filter((x) => x.id !== order.id); save(db); },
      async proofUrl(path) { return path; },

      async listProducts() { return sortVariants(clone(load().products.sort((a, b) => a.sort_order - b.sort_order))); },
      async saveProduct(p, variants) {
        const db = load();
        let prod = p.id && db.products.find((x) => x.id === p.id);
        if (!prod) { prod = { id: uid(), variants: [] }; db.products.push(prod); }
        Object.assign(prod, {
          name: p.name, slug: p.slug, tagline: p.tagline, description: p.description, category: p.category, image_url: p.image_url,
          accent: p.accent, sort_order: Number(p.sort_order) || 0, is_active: !!p.is_active, is_sold_out: !!p.is_sold_out,
          bundle_slots: p.category === 'bundle' ? (p.bundle_slots || []) : [],
        });
        prod.variants = variants.map((v, i) => ({ id: v.id || uid(), product_id: prod.id, name: v.name, size_label: v.size_label, price: Number(v.price) || 0, is_sold_out: !!v.is_sold_out, sort_order: i + 1 }));
        save(db);
        return clone(prod);
      },
      async quickUpdateProduct(id, patch) { const db = load(); Object.assign(db.products.find((x) => x.id === id), patch); save(db); },
      async quickUpdateVariant(id, patch) {
        const db = load();
        db.products.forEach((p) => p.variants.forEach((v) => { if (v.id === id) Object.assign(v, patch); }));
        save(db);
      },
      async deleteProduct(id) { const db = load(); db.products = db.products.filter((x) => x.id !== id); save(db); },
      async uploadAsset(blob) { return blobToDataUrl(blob); },

      async listSaleDates(from) {
        return clone(load().sale_dates.filter((d) => !from || d.sale_date >= from).sort((a, b) => a.sale_date.localeCompare(b.sale_date)));
      },
      async saveSaleDate(d) {
        const db = load();
        if (db.sale_dates.some((x) => x.sale_date === d.sale_date && x.id !== d.id)) throw new Error('Tanggal itu sudah ada di jadwal.');
        let row = d.id && db.sale_dates.find((x) => x.id === d.id);
        if (!row) { row = { id: uid() }; db.sale_dates.push(row); }
        Object.assign(row, { sale_date: d.sale_date, is_open: !!d.is_open, note: d.note || null, max_orders: d.max_orders ? Number(d.max_orders) : null });
        save(db);
        return clone(row);
      },
      async deleteSaleDate(id) { const db = load(); db.sale_dates = db.sale_dates.filter((x) => x.id !== id); save(db); },

      async getSettings() { return clone(load().settings); },
      async saveSettings(s) { const db = load(); db.settings = { ...db.settings, ...s }; save(db); return clone(db.settings); },

      onNewOrder(cb) {
        let known = load().orders.length;
        window.addEventListener('storage', (e) => {
          if (e.key !== KEY) return;
          const db = load();
          if (db.orders.length > known) cb(db.orders[0]);
          known = db.orders.length;
        });
      },
    };
  }

  let api;
  try {
    api = configured ? SupabaseApi() : DemoApi();
  } catch (e) {
    api = { initError: e };
  }
  window.API = api;
})();