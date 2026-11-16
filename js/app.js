/* =========================================================
   GIGABITES — logika halaman pemesanan
   ========================================================= */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const { esc, rupiah } = U;

  const state = {
    settings: null,
    products: [],
    periods: [],         // periode PO yang sedang dibuka
    stock: {},           // { periodId: { variantId: sisa } }  (tidak ada = tidak dibatasi)
    periodId: U.store.get('gb_period', null),
    vmap: {},            // variant_id -> { product, variant }
    cart: U.store.get('gb_cart', []),
    step: 1,
    quote: null,
    proofBlob: null,
    sheet: { product: null, variantId: null, qty: 1 },
    layer: null,
    lastFocus: null,
    submitting: false,
  };

  /* ---------------- init ---------------- */
  async function init() {
    bindStatic();
    if (API.initError) return showNotice(API.initError.message, true);
    if (API.demo) {
      const b = document.createElement('div');
      b.className = 'demo-badge';
      b.textContent = 'Mode demo';
      document.body.appendChild(b);
    }
    try {
      const d = await API.getStorefront();
      state.settings = d.settings;
      state.products = d.products;
      applyPeriods(d);
      state.vmap = {};
      d.products.forEach((p) => p.variants.forEach((v) => (state.vmap[v.id] = { product: p, variant: v })));
      // buang item keranjang yang menunya sudah dihapus admin
      state.cart = state.cart.filter((c) => state.vmap[c.variant_id] && (!c.picks || c.picks.every((id) => state.vmap[id])));
      saveCart();
      renderDates();
      renderNotice();
      renderBands();
      renderPickupInfo();
      renderCart();
    } catch (e) {
      console.error(e);
      showNotice('Menu belum bisa dimuat. ' + U.errMsg(e), true);
      $('#cheesecuitList').innerHTML = '';
    }
  }

  function showNotice(msg, closed) {
    const n = $('#notice');
    n.textContent = msg;
    n.classList.toggle('closed', !!closed);
    n.hidden = false;
  }

  function renderNotice() {
    const s = state.settings;
    if (!s.store_open) showNotice('Toko sedang tutup sementara. Menu tetap bisa dilihat, pemesanan dibuka lagi segera.', true);
    else if (s.announcement) showNotice(s.announcement);
  }

  /* ---------- periode PO & stok ---------- */
  function applyPeriods(d) {
    state.periods = d.periods || [];
    state.stock = d.stock || {};
    if (!state.periods.some((p) => p.id === state.periodId)) state.periodId = state.periods[0] ? state.periods[0].id : null;
    U.store.set('gb_period', state.periodId);
  }
  const period = () => state.periods.find((p) => p.id === state.periodId) || null;
  // sisa stok varian di periode terpilih (Infinity = tidak dibatasi)
  const remaining = (vid) => { const m = state.stock[state.periodId] || {}; return vid in m ? m[vid] : Infinity; };
  const flagsOk = (p, v) => !p.is_sold_out && !v.is_sold_out;
  const canOrder = () => !!period() && state.settings && state.settings.store_open;
  // jumlah per varian yang sudah ada di keranjang (satuan + isi paket)
  function cartDemand(cart = state.cart) {
    const d = {};
    cart.forEach((c) => {
      const m = state.vmap[c.variant_id];
      if (!m) return;
      if (c.picks) c.picks.forEach((id) => { d[id] = (d[id] || 0) + c.qty; });
      else if (m.product.category !== 'bundle') d[c.variant_id] = (d[c.variant_id] || 0) + c.qty;
    });
    return d;
  }
  function overStock(cart = state.cart) {
    const d = cartDemand(cart);
    return Object.keys(d).filter((vid) => d[vid] > remaining(vid));
  }
  function deliveryDates(per) {
    if (!per) return [];
    const t = U.todayJakarta();
    let cur = per.delivery_start > t ? per.delivery_start : t;
    const out = [];
    while (cur <= per.delivery_end && out.length < 31) {
      out.push(cur);
      const d = U.parseDate(cur); d.setDate(d.getDate() + 1); cur = d.toISOString().slice(0, 10);
    }
    return out;
  }
  function rangeText(a, b) {
    return a === b ? U.fmtDateShort(a) : `${U.fmtDateShort(a)} – ${U.fmtDateShort(b)}`;
  }

  function renderDates() {
    const list = $('#datesList');
    if (!state.periods.length) {
      list.innerHTML = '<span class="dates-empty">Belum ada PO yang dibuka. Pantau Instagram kami untuk info PO berikutnya.</span>';
      return;
    }
    const chips = state.periods.length > 1
      ? `<div class="period-chips" role="group" aria-label="Pilih periode PO">${state.periods.map((p) =>
          `<button type="button" class="date-chip ${p.id === state.periodId ? 'on' : ''}" data-period="${p.id}" aria-pressed="${p.id === state.periodId}">${esc(p.name)}</button>`).join('')}</div>`
      : '';
    const p = period();
    list.innerHTML = `${chips}<div class="period-card">
        <strong>${esc(p.name)}</strong>
        <span>Pesan sampai ${esc(U.fmtDate(p.order_end))}</span>
        <span>Ambil / antar ${esc(rangeText(p.delivery_start, p.delivery_end))}</span>
        ${p.note ? `<small>${esc(p.note)}</small>` : ''}
      </div>`;
  }

  function selectPeriod(id) {
    state.periodId = id;
    U.store.set('gb_period', id);
    renderDates(); renderBands(); renderCart();
  }

  /* ---------- paket bundle ---------- */
  // pecah isi paket menjadi unit-unit yang harus dipilih rasanya
  function slotUnits(p) {
    const units = [];
    (p.bundle_slots || []).forEach((slot) => {
      const options = [];
      state.products.forEach((op) => {
        if (op.category !== slot.category) return;
        const v = op.variants.find((x) => x.name.toLowerCase() === String(slot.variant_name).toLowerCase());
        if (v) options.push({ product: op, variant: v, available: flagsOk(op, v) && remaining(v.id) > 0 });
      });
      const n = Math.max(1, Number(slot.qty) || 1);
      const size = options[0] ? options[0].variant.size_label : '';
      for (let i = 0; i < n; i++) {
        units.push({ ...slot, options, label: `${slot.variant_name}${size ? ' ' + size : ''}${n > 1 ? ` (${i + 1})` : ''}` });
      }
    });
    return units;
  }
  function slotsText(p) {
    return (p.bundle_slots || []).map((s) => {
      const u = slotUnits({ bundle_slots: [{ ...s, qty: 1 }] })[0];
      return `${s.qty || 1} ${u ? u.label : s.variant_name}`;
    }).join(' + ');
  }
  function bundleAvailable(p) {
    const v = p.variants[0];
    if (!v || p.is_sold_out || v.is_sold_out) return false;
    const units = slotUnits(p);
    return units.length > 0 && units.every((u) => u.options.some((o) => o.available));
  }
  function bundleSaving(p) {
    const units = slotUnits(p);
    if (!units.length || units.some((u) => !u.options.length)) return 0;
    const normal = units.reduce((a, u) => a + Math.min(...u.options.map((o) => o.variant.price)), 0);
    return Math.max(0, normal - (p.variants[0] ? p.variants[0].price : 0));
  }
  const pickName = (id) => { const m = state.vmap[id]; return m ? `${m.product.name} ${m.variant.name}` : '?'; };
  function picksText(picks) {
    const counts = {};
    (picks || []).forEach((id) => { const n = pickName(id); counts[n] = (counts[n] || 0) + 1; });
    return Object.entries(counts).map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
  }
  function componentsText(comps) {
    const counts = {};
    (comps || []).forEach((c) => { const n = `${c.product_name} ${c.variant_name}`; counts[n] = (counts[n] || 0) + 1; });
    return Object.entries(counts).map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
  }

  function bundleBandHTML(p) {
    const v = p.variants[0];
    const ok = bundleAvailable(p);
    const save = bundleSaving(p);
    const on = U.onColor(p.accent);
    return `<article class="band band-bundle ${ok ? '' : 'sold'}" style="--accent:${esc(p.accent)};--on:${on}">
        <div class="band-media"><img src="${esc(p.image_url || 'assets/mascot.svg')}" alt="${esc(p.name)}" loading="lazy" /></div>
        <div class="band-body">
          <p class="band-tag">${esc(p.tagline || 'Special Bundle')}</p>
          <h3>${esc(p.name)}</h3>
          <p class="band-desc">${esc(p.description || slotsText(p))}</p>
          ${v ? `<div class="bundle-row">
            <div class="bundle-price"><strong>${rupiah(v.price)}</strong>${save ? `<span class="save-chip">Hemat ${rupiah(save)}</span>` : ''}</div>
            <button class="v-btn v-bundle" type="button" data-product="${p.id}" data-variant="${v.id}" ${ok ? '' : 'disabled'}
              aria-label="${esc(`Pilih isi paket ${p.name}, ${rupiah(v.price)}${ok ? '' : ', habis'}`)}">
              <span class="v-name">${ok ? 'Pilih isi paket' : 'Habis'}</span>
              <span class="v-meta">${esc(slotsText(p))}</span>
              <span class="v-plus" aria-hidden="true">${ok ? '+' : '×'}</span>
            </button></div>` : ''}
        </div>
      </article>`;
  }

  function bandHTML(p) {
    const isSold = (v) => !flagsOk(p, v) || remaining(v.id) <= 0;
    const allSold = p.variants.every(isSold);
    const on = U.onColor(p.accent);
    const variants = p.variants.map((v) => {
      const sold = isSold(v);
      const r = remaining(v.id);
      const stockTxt = sold ? 'Habis' : r !== Infinity ? `Sisa ${r}` : '';
      return `<button class="v-btn" type="button" data-product="${p.id}" data-variant="${v.id}" ${sold ? 'disabled' : ''}
          aria-label="${esc(`${p.name} ${v.name} ${v.size_label}, ${rupiah(v.price)}${stockTxt ? ', ' + stockTxt : ''}`)}">
          <span class="v-name">${esc(v.name)}</span>
          <span class="v-meta">${esc(v.size_label)} &nbsp;<b>${rupiah(v.price)}</b></span>
          ${stockTxt ? `<span class="v-stock ${sold ? 'out' : r <= 5 ? 'low' : ''}">${stockTxt}</span>` : ''}
          <span class="v-plus" aria-hidden="true">${sold ? '×' : '+'}</span>
        </button>`;
    }).join('');
    return `<article class="band ${allSold ? 'sold' : ''}" style="--accent:${esc(p.accent)};--on:${on}">
        <div class="band-media"><img src="${esc(p.image_url || 'assets/mascot.svg')}" alt="${esc(p.name)}" loading="lazy" /></div>
        <div class="band-body">
          ${p.tagline ? `<p class="band-tag">${esc(p.tagline)}</p>` : ''}
          <h3>${esc(p.name)}</h3>
          <p class="band-desc">${esc(p.description || '')}</p>
          <div class="variant-row">${variants}</div>
        </div>
      </article>`;
  }

  function renderBands() {
    const cheese = state.products.filter((p) => p.category === 'cheesecuit');
    const drinks = state.products.filter((p) => p.category === 'drink');
    const bundles = state.products.filter((p) => p.category === 'bundle');
    $('#bundleSection').hidden = !bundles.length;
    $('#bundleList').innerHTML = bundles.map(bundleBandHTML).join('');
    $('#cheesecuitList').innerHTML = cheese.map(bandHTML).join('') || '<p class="hint">Menu cheesecuit belum tersedia.</p>';
    $('#drinkList').innerHTML = drinks.map(bandHTML).join('') || '<p class="hint">Minuman belum tersedia.</p>';
  }

  function renderPickupInfo() {
    const s = state.settings;
    const locs = (s.pickup_locations || []).map((l) => `<div class="pickup-card"><strong>Ambil di ${esc(l.name)}</strong><p>${esc(l.detail || '')}</p></div>`);
    locs.push(`<div class="pickup-card"><strong>Diantar gratis</strong><p>${esc(s.delivery_note || 'Sesuai tanggal yang kamu pilih.')}</p></div>`);
    $('#pickupInfo').innerHTML = locs.join('');
  }

  /* ---------------- layer (sheet/drawer/checkout) ---------------- */
  function openLayer(el) {
    if (state.layer && state.layer !== el) state.layer.hidden = true;
    else state.lastFocus = document.activeElement;
    state.layer = el;
    $('#overlay').hidden = false;
    el.hidden = false;
    document.body.classList.add('locked');
    el.setAttribute('tabindex', '-1');
    setTimeout(() => el.focus({ preventScroll: true }), 50);
  }
  function closeLayer() {
    if (!state.layer) return;
    if (state.layer.id === 'checkout' && state.submitting) return;
    state.layer.hidden = true;
    state.layer = null;
    $('#overlay').hidden = true;
    document.body.classList.remove('locked');
    if (state.lastFocus) state.lastFocus.focus({ preventScroll: true });
  }

  /* ---------------- sheet produk ---------------- */
  function openProduct(productId, variantId) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    const firstAvail = p.variants.find((v) => flagsOk(p, v) && remaining(v.id) > 0);
    const isBundle = p.category === 'bundle';
    const units = isBundle ? slotUnits(p) : [];
    state.sheet = {
      product: p, variantId: variantId || (firstAvail && firstAvail.id), qty: 1, isBundle, units,
      picks: units.map((u) => { const o = u.options.find((x) => x.available); return o ? o.variant.id : null; }),
    };
    $('#psVariantPick').hidden = isBundle;
    $('#psSlots').hidden = !isBundle;
    $('#psSlots').innerHTML = units.map((u, i) => `
      <fieldset class="slot-pick"><legend>${esc(u.label)}</legend>
        <div class="date-options">${u.options.map((o) => `<label class="pill"><input type="radio" name="slot${i}" data-slot="${i}" value="${o.variant.id}"
          ${state.sheet.picks[i] === o.variant.id ? 'checked' : ''} ${o.available ? '' : 'disabled'} />
          <span>${esc(o.product.name)}${o.available ? (remaining(o.variant.id) !== Infinity ? `<small>sisa ${remaining(o.variant.id)}</small>` : '') : '<small>habis</small>'}</span></label>`).join('') || '<span class="hint">Belum ada pilihan</span>'}</div>
      </fieldset>`).join('');
    const sheet = $('#productSheet');
    sheet.style.setProperty('--accent', p.accent);
    $('#psImg').src = p.image_url || 'assets/mascot.svg';
    $('#psImg').alt = p.name;
    $('#psTag').textContent = p.tagline || '';
    $('#psName').textContent = p.name;
    $('#psDesc').textContent = p.description || '';
    $('#psSave').hidden = true;
    if (p.category === 'bundle' && bundleSaving(p)) { $('#psSave').hidden = false; $('#psSave').textContent = `Hemat ${rupiah(bundleSaving(p))} dibanding beli satuan`; }
    $('#psNote').value = '';
    $('#psVariants').innerHTML = p.variants.map((v) => {
      const r = remaining(v.id);
      const sold = !flagsOk(p, v) || r <= 0;
      const info = sold ? ' — habis' : r !== Infinity ? ` — sisa ${r}` : '';
      return `<label class="v-opt"><input type="radio" name="psVariant" value="${v.id}" ${v.id === state.sheet.variantId ? 'checked' : ''} ${sold ? 'disabled' : ''} />
        <span><strong>${esc(v.name)}</strong><small>${esc(v.size_label)}${info}</small><b>${rupiah(v.price)}</b></span></label>`;
    }).join('');
    updateSheet();
    openLayer(sheet);
  }

  // jumlah maksimal yang masih bisa ditambahkan dari sheet (memperhitungkan isi keranjang)
  function sheetMax() {
    const sh = state.sheet;
    const inCart = cartDemand();
    const need = {};
    if (sh.isBundle) sh.picks.forEach((id) => { if (id) need[id] = (need[id] || 0) + 1; });
    else if (sh.variantId) need[sh.variantId] = 1;
    let mx = 50;
    Object.entries(need).forEach(([id, n]) => {
      const r = remaining(id);
      if (r !== Infinity) mx = Math.min(mx, Math.floor((r - (inCart[id] || 0)) / n));
    });
    return Math.max(0, mx);
  }

  function updateSheet() {
    const sh = state.sheet;
    const { product, variantId } = sh;
    const v = product.variants.find((x) => x.id === variantId);
    const max = sheetMax();
    if (sh.qty > Math.max(1, max)) sh.qty = Math.max(1, max);
    $('#psQtyVal').textContent = sh.qty;
    const hint = $('#psStock');
    const inCart = cartDemand();
    hint.hidden = true;
    if (!sh.isBundle && v && remaining(v.id) !== Infinity) {
      hint.hidden = false;
      hint.textContent = `Sisa ${remaining(v.id)} untuk ${period() ? period().name : 'periode ini'}${inCart[v.id] ? ` (${inCart[v.id]} sudah di keranjang)` : ''}`;
    }
    const btn = $('#psAdd');
    if (!state.settings.store_open) { btn.disabled = true; btn.textContent = 'Toko sedang tutup'; return; }
    if (!period()) { btn.disabled = true; btn.textContent = 'Belum ada PO yang dibuka'; return; }
    if (!v) { btn.disabled = true; btn.textContent = 'Habis'; return; }
    if (sh.isBundle && sh.picks.some((x) => !x)) { btn.disabled = true; btn.textContent = 'Pilih rasa untuk semua isi paket'; return; }
    if (max <= 0) { btn.disabled = true; btn.textContent = 'Stok tidak cukup'; return; }
    btn.disabled = false;
    btn.textContent = `Tambah ke keranjang  ·  ${rupiah(v.price * sh.qty)}`;
  }

  function addToCart() {
    const { product, variantId, qty, isBundle } = state.sheet;
    if (!variantId || sheetMax() < qty) return;
    const note = $('#psNote').value.trim().slice(0, 200);
    const picks = isBundle ? state.sheet.picks.slice() : null;
    const same = (c) => c.variant_id === variantId && (c.note || '') === note && JSON.stringify(c.picks || null) === JSON.stringify(picks);
    const existing = state.cart.find(same);
    if (existing) existing.qty = Math.min(50, existing.qty + qty);
    else state.cart.push(picks ? { variant_id: variantId, qty, note, picks } : { variant_id: variantId, qty, note });
    saveCart();
    renderCart(true);
    closeLayer();
    const v = state.vmap[variantId].variant;
    U.toast(`${isBundle ? product.name : product.name + ' ' + v.name} masuk keranjang`, 'success', 2200);
  }

  /* ---------------- keranjang ---------------- */
  function saveCart() { U.store.set('gb_cart', state.cart); }

  function cartLines() {
    const over = overStock();
    return state.cart.map((c, i) => {
      const m = state.vmap[c.variant_id];
      let sold = !flagsOk(m.product, m.variant);
      if (c.picks) sold = sold || c.picks.some((id) => { const x = state.vmap[id]; return !x || !flagsOk(x.product, x.variant); });
      const ids = c.picks || [c.variant_id];
      const shortIds = ids.filter((id) => over.includes(id));
      const short = shortIds.length ? [...new Set(shortIds)].map((id) => `${pickName(id)} sisa ${remaining(id)}`).join(', ') : '';
      return { ...c, i, product: m.product, variant: m.variant, sold, short, total: m.variant.price * c.qty };
    });
  }
  const cartSubtotal = () => cartLines().filter((l) => !l.sold).reduce((a, l) => a + l.total, 0);
  const cartCount = () => state.cart.reduce((a, c) => a + c.qty, 0);

  function renderCart(bump) {
    const count = cartCount();
    const cc = $('#cartCount');
    cc.hidden = count === 0;
    cc.textContent = count;
    if (bump) { cc.classList.remove('bump'); void cc.offsetWidth; cc.classList.add('bump'); }
    const bar = $('#cartbar');
    bar.hidden = count === 0 || !!state.layer;
    $('#cartbarCount').textContent = `${count} item`;
    $('#cartbarTotal').textContent = rupiah(cartSubtotal());

    const lines = cartLines();
    const body = $('#cartItems');
    if (!lines.length) {
      body.innerHTML = `<div class="empty"><img src="assets/mascot.svg" alt="" /><strong>Keranjang masih kosong</strong>Pilih rasa favoritmu dari menu.</div>`;
      $('#cartFoot').hidden = true;
      return;
    }
    $('#cartFoot').hidden = false;
    body.innerHTML = lines.map((l) => `
      <div class="cart-item" data-i="${l.i}">
        <img src="${esc(l.product.image_url || 'assets/mascot.svg')}" alt="" />
        <div>
          <div class="ci-top">
            <div><div class="ci-name">${esc(l.product.name)}</div><div class="ci-var">${l.picks ? esc(picksText(l.picks)) : `${esc(l.variant.name)} ${esc(l.variant.size_label)}`}${l.sold ? ' — <b style="color:var(--danger)">sold out, hapus dulu</b>' : ''}</div>
              ${l.short ? `<div class="ci-short">Stok tidak cukup: ${esc(l.short)}. Kurangi jumlahnya.</div>` : ''}</div>
            <div class="ci-price">${rupiah(l.total)}</div>
          </div>
          <div class="ci-bottom">
            <div class="qty small">
              <button type="button" data-act="dec" aria-label="Kurangi">−</button>
              <output>${l.qty}</output>
              <button type="button" data-act="inc" aria-label="Tambah">+</button>
            </div>
            <button type="button" class="ci-remove" data-act="rm">Hapus</button>
          </div>
          <input class="ci-note" data-act="note" maxlength="200" value="${esc(l.note || '')}" placeholder="Tambah catatan item (opsional)" aria-label="Catatan untuk ${esc(l.product.name)}" />
        </div>
      </div>`).join('');
    $('#cartSubtotal').textContent = rupiah(cartSubtotal());
    const anySold = lines.some((l) => l.sold);
    const anyShort = lines.some((l) => l.short);
    const btn = $('#btnCheckout');
    btn.disabled = anySold || anyShort || !canOrder();
    btn.textContent = anySold ? 'Hapus item sold out dulu'
      : anyShort ? 'Kurangi item yang stoknya tidak cukup'
      : !state.settings || !state.settings.store_open ? 'Toko sedang tutup'
      : !period() ? 'Belum ada PO yang dibuka'
      : 'Lanjut isi data';
  }

  function onCartClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.dataset.act === 'note') return;
    const i = Number(btn.closest('.cart-item').dataset.i);
    const c = state.cart[i];
    if (btn.dataset.act === 'inc') {
      const trial = state.cart.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
      const over = overStock(trial).filter((id) => (c.picks || [c.variant_id]).includes(id));
      if (over.length) { U.toast(`Stok ${pickName(over[0])} tinggal ${remaining(over[0])}`, 'info', 2200); return; }
      c.qty = Math.min(50, c.qty + 1);
    }
    if (btn.dataset.act === 'dec') c.qty -= 1;
    if (btn.dataset.act === 'rm' || c.qty < 1) state.cart.splice(i, 1);
    saveCart();
    renderCart();
  }

  /* ---------------- checkout ---------------- */
  function openCheckout() {
    if (!state.cart.length) return;
    const saved = U.store.get('gb_customer', {});
    if (saved.name && !$('#fName').value) $('#fName').value = saved.name;
    if (saved.phone && !$('#fPhone').value) $('#fPhone').value = saved.phone;
    renderCheckoutOptions();
    goStep(1);
    openLayer($('#checkout'));
  }

  function renderCheckoutOptions() {
    const s = state.settings;
    const sel = ($('input[name=sale_date]:checked') || {}).value;
    const per = period();
    const dates = deliveryDates(per);
    $('#periodHint').textContent = per ? `${per.name}: ambil / antar ${rangeText(per.delivery_start, per.delivery_end)}` : '';
    $('#dateOptions').innerHTML = dates.length
      ? dates.map((d, i) => `<label class="pill"><input type="radio" name="sale_date" value="${d}" ${(dates.includes(sel) ? sel === d : i === 0) ? 'checked' : ''} />
          <span>${esc(U.fmtDate(d))}</span></label>`).join('')
      : '<p class="hint">Belum ada PO yang dibuka. Coba cek lagi nanti ya.</p>';
    const selLoc = ($('input[name=pickup_location]:checked') || {}).value;
    $('#locOptions').innerHTML = (s.pickup_locations || []).map((l, i) => `<label class="loc"><input type="radio" name="pickup_location" value="${esc(l.name)}" ${(selLoc ? selLoc === l.name : i === 0) ? 'checked' : ''} />
        <span><strong>${esc(l.name)}</strong><small>${esc(l.detail || '')}</small></span></label>`).join('');
    $('#deliveryNote').textContent = s.delivery_note || '';
    $('#qrisImg').src = s.qris_image_url || 'assets/qris-placeholder.svg';
    $('#qrisDownload').href = s.qris_image_url || '#';
    $('#qrisDownload').hidden = !s.qris_image_url;
    syncMethod();
  }

  const method = () => ($('input[name=method]:checked') || {}).value || 'pickup';

  function syncMethod() {
    const m = method();
    $('#pickupBox').hidden = m !== 'pickup';
    $('#deliveryBox').hidden = m !== 'delivery';
    updateFooterTotal();
  }

  function updateFooterTotal() {
    let t = cartSubtotal();
    if (state.step === 3 && state.quote) t = state.quote.total;
    $('#coTotal').textContent = rupiah(t);
  }

  function goStep(n) {
    state.step = n;
    $$('.co-step').forEach((el) => (el.hidden = el.dataset.step !== String(n)));
    $$('#stepper li').forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('active', s === n);
      li.classList.toggle('done', n === 'done' || s < n);
    });
    const done = n === 'done';
    $('#coFoot').hidden = done;
    $('#coBack').style.visibility = done ? 'hidden' : 'visible';
    $('#coTitle').textContent = done ? 'Terima kasih!' : 'Checkout';
    const next = $('#coNext');
    next.disabled = false;
    next.textContent = n === 3 ? 'Kirim pesanan' : 'Lanjut';
    if (n === 2 && !deliveryDates(period()).length) next.disabled = true;
    updateFooterTotal();
    $('#coForm').scrollTop = 0;
  }

  function setErr(name, msg) {
    const el = $(`.field-err[data-for="${name}"]`);
    if (el) {
      el.textContent = msg || '';
      const f = el.closest('.field');
      if (f) f.classList.toggle('invalid', !!msg);
    }
    return !msg;
  }

  function validateStep1() {
    const name = $('#fName').value.trim();
    const phone = $('#fPhone').value.trim();
    const a = setErr('name', name.length < 2 ? 'Tulis nama kamu (minimal 2 huruf).' : '');
    const b = setErr('phone', !U.validPhone(phone) ? 'Nomor WhatsApp harus diawali 08, contoh 081234567890.' : '');
    if (!a) $('#fName').focus(); else if (!b) $('#fPhone').focus();
    if (a && b) U.store.set('gb_customer', { name, phone });
    return a && b;
  }

  function validateStep2() {
    const date = ($('input[name=sale_date]:checked') || {}).value;
    let ok = setErr('sale_date', date ? '' : 'Pilih tanggal pengambilan/pengantaran.');
    if (method() === 'pickup') {
      ok = setErr('pickup_location', $('input[name=pickup_location]:checked') ? '' : 'Pilih lokasi pengambilan.') && ok;
      setErr('address', '');
    } else {
      ok = setErr('address', $('#fAddress').value.trim().length < 8 ? 'Tulis alamat lengkap supaya kurir tidak nyasar.' : '') && ok;
      setErr('pickup_location', '');
    }
    return ok;
  }

  function apiItems() {
    return state.cart.map((c) => ({ variant_id: c.variant_id, qty: c.qty, note: c.note || null, ...(c.picks ? { picks: c.picks } : {}) }));
  }

  const lineName = (it) => (it.components ? it.product_name : `${it.product_name} ${it.variant_name}`);

  function renderSummary() {
    const q = state.quote;
    const date = $('input[name=sale_date]:checked').value;
    const m = method();
    const where = m === 'pickup' ? `Ambil di ${$('input[name=pickup_location]:checked').value}` : `Diantar ke ${$('#fAddress').value.trim()}`;
    $('#summary').innerHTML = `
      <h5>Ringkasan pesanan</h5>
      ${q.items.map((it) => `<div class="sum-line"><span>${it.qty}× ${esc(lineName(it))}${it.components ? `<small>Isi: ${esc(componentsText(it.components))}</small>` : ''}${it.note ? `<small>Catatan: ${esc(it.note)}</small>` : ''}</span><span>${rupiah(it.line_total)}</span></div>`).join('')}
      <div class="sum-line total"><span>Total bayar</span><span>${rupiah(q.total)}</span></div>
      <div class="sum-meta">${esc(U.fmtDate(date))} — ${esc(where)}</div>`;
    $('#payTotal').textContent = rupiah(q.total);
  }

  async function next() {
    if (state.step === 1) { if (validateStep1()) goStep(2); return; }
    if (state.step === 2) {
      if (!validateStep2()) return;
      const btn = $('#coNext');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Mengecek stok';
      try {
        state.quote = await API.quote(apiItems(), method(), state.periodId);
        renderSummary();
        goStep(3);
      } catch (e) {
        U.toast(U.errMsg(e), 'error', 5000);
        btn.disabled = false;
        btn.textContent = 'Lanjut';
        refreshMenuSilently();
      }
      return;
    }
    if (state.step === 3) submitOrder();
  }

  async function submitOrder() {
    const ref = $('#fReferral').value.trim().toUpperCase();
    let ok = setErr('referral', ref && !/^[A-Z]{3}$/.test(ref) ? 'Kode referal harus tepat 3 huruf (A–Z).' : '');
    ok = setErr('proof', state.proofBlob ? '' : 'Upload screenshot bukti pembayaran dulu ya.') && ok;
    if (!ok) return;

    const btn = $('#coNext');
    state.submitting = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Mengunggah bukti';
    try {
      const proofPath = await API.uploadProof(state.proofBlob);
      btn.innerHTML = '<span class="spinner"></span> Mengirim pesanan';
      const payload = {
        period_id: state.periodId,
        name: $('#fName').value.trim(),
        phone: $('#fPhone').value.trim(),
        method: method(),
        sale_date: $('input[name=sale_date]:checked').value,
        pickup_location: method() === 'pickup' ? $('input[name=pickup_location]:checked').value : null,
        address: method() === 'delivery' ? $('#fAddress').value.trim() : null,
        notes: $('#fNotes').value.trim(),
        referral: ref || null,
        items: apiItems(),
        proof_path: proofPath,
      };
      const res = await API.placeOrder(payload);
      showDone(res, payload);
    } catch (e) {
      console.error(e);
      U.toast(U.errMsg(e), 'error', 6000);
      btn.disabled = false;
      btn.textContent = 'Kirim pesanan';
    } finally {
      state.submitting = false;
    }
  }

  function showDone(res, payload) {
    $('#doneCode').textContent = res.order_code;
    const where = payload.method === 'pickup' ? `Ambil di ${payload.pickup_location}` : `Diantar ke ${payload.address}`;
    $('#doneSummary').innerHTML = `<div class="summary">
        ${state.quote.items.map((it) => `<div class="sum-line"><span>${it.qty}× ${esc(lineName(it))}${it.components ? `<small>Isi: ${esc(componentsText(it.components))}</small>` : ''}</span><span>${rupiah(it.line_total)}</span></div>`).join('')}
        <div class="sum-line total"><span>Total</span><span>${rupiah(res.total)}</span></div>
        <div class="sum-meta">${esc(U.fmtDate(payload.sale_date))} — ${esc(where)}</div></div>`;
    const wa = state.settings.admin_whatsapp;
    const waBtn = $('#doneWa');
    waBtn.hidden = !wa;
    if (wa) {
      waBtn.href = U.waLink(wa, `Halo Gigabites! Saya ${payload.name} sudah pesan dengan kode ${res.order_code} (total ${rupiah(res.total)}) untuk ${U.fmtDate(payload.sale_date)}. Bukti bayar sudah saya upload, mohon dicek ya 🙏`);
    }
    // reset
    state.cart = [];
    saveCart();
    state.proofBlob = null;
    resetProof();
    $('#fReferral').value = '';
    $('#fNotes').value = '';
    renderCart();
    goStep('done');
  }

  async function refreshMenuSilently() {
    try {
      const d = await API.getStorefront();
      state.settings = d.settings; state.products = d.products;
      applyPeriods(d);
      state.vmap = {};
      d.products.forEach((p) => p.variants.forEach((v) => (state.vmap[v.id] = { product: p, variant: v })));
      state.cart = state.cart.filter((c) => state.vmap[c.variant_id] && (!c.picks || c.picks.every((id) => state.vmap[id])));
      saveCart();
      renderBands(); renderDates(); renderCart(); renderCheckoutOptions();
    } catch { /* biarkan */ }
  }

  /* ---------------- upload bukti ---------------- */
  function resetProof() {
    $('#fProof').value = '';
    $('#proofPreview').hidden = true;
    $('#uploadEmpty').hidden = false;
    $('#uploadBox').classList.remove('has-file');
  }

  async function onProof(e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      state.proofBlob = await U.compressImage(f);
      const prev = $('#proofPreview');
      prev.src = URL.createObjectURL(state.proofBlob);
      prev.hidden = false;
      $('#uploadEmpty').hidden = true;
      $('#uploadBox').classList.add('has-file');
      setErr('proof', '');
    } catch (err) {
      state.proofBlob = null;
      resetProof();
      setErr('proof', err.message);
    }
  }

  /* ---------------- cek pesanan ---------------- */
  async function onTrack(e) {
    e.preventDefault();
    const out = $('#trackResult');
    const code = $('#tCode').value.trim();
    const phone = $('#tPhone').value.trim();
    if (!code || !phone) return;
    out.innerHTML = '<p class="hint">Mencari pesanan…</p>';
    try {
      const o = await API.checkOrder(code, phone);
      if (!o) { out.innerHTML = '<div class="track-card"><h5>Pesanan tidak ditemukan</h5><p class="hint">Cek lagi kode pesanan dan nomor WhatsApp yang dipakai saat memesan.</p></div>'; return; }
      const flow = ['menunggu_verifikasi', 'diproses', 'siap', 'selesai'];
      const idx = flow.indexOf(o.status);
      const tl = o.status === 'dibatalkan'
        ? `<li class="cancel">Pesanan dibatalkan</li>`
        : flow.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${esc(U.STATUS[s].label)}</li>`).join('');
      out.innerHTML = `<div class="track-card">
          <h5>${esc(o.order_code)}</h5>
          <p class="hint">${o.period_name ? esc(o.period_name) + ' — ' : ''}${esc(o.customer_name)} — ${esc(U.fmtDate(o.sale_date))}, ${o.method === 'pickup' ? 'ambil di ' + esc(o.pickup_location) : 'diantar'} — ${rupiah(o.total)}</p>
          <ul class="timeline">${tl}</ul>
          ${o.admin_note ? `<div class="admin-note"><b>Info dari Gigabites:</b> ${esc(o.admin_note)}</div>` : ''}
        </div>`;
    } catch (err) {
      out.innerHTML = `<p class="field-err">${esc(U.errMsg(err))}</p>`;
    }
  }

  /* ---------------- event ---------------- */
  function bindStatic() {
    const cfg = window.GIGABITES_CONFIG || {};
    if (cfg.INSTAGRAM) { $('#igLink').href = 'https://instagram.com/' + cfg.INSTAGRAM; $('#igLink').textContent = '@' + cfg.INSTAGRAM; }

    document.addEventListener('click', (e) => {
      const vb = e.target.closest('.v-btn');
      if (vb && !vb.disabled) openProduct(vb.dataset.product, vb.dataset.variant);
      if (e.target.closest('[data-close]')) closeLayer();
    });
    $('#overlay').addEventListener('click', closeLayer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLayer(); });

    $('#psVariants').addEventListener('change', (e) => { state.sheet.variantId = e.target.value; state.sheet.qty = 1; updateSheet(); });
    $('#datesList').addEventListener('click', (e) => { const b = e.target.closest('[data-period]'); if (b) selectPeriod(b.dataset.period); });
    $('#psSlots').addEventListener('change', (e) => {
      if (e.target.dataset.slot == null) return;
      state.sheet.picks[Number(e.target.dataset.slot)] = e.target.value;
      updateSheet();
    });
    $('#psQty').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      const max = Math.max(1, sheetMax());
      const nextQ = state.sheet.qty + Number(b.dataset.q);
      if (nextQ > max && Number(b.dataset.q) > 0) U.toast(`Stok hanya cukup untuk ${max}`, 'info', 1800);
      state.sheet.qty = Math.max(1, Math.min(max, nextQ));
      updateSheet();
    });
    $('#psAdd').addEventListener('click', addToCart);

    const openCart = () => { renderCart(); openLayer($('#cartDrawer')); $('#cartbar').hidden = true; };
    $('#btnCart').addEventListener('click', openCart);
    $('#cartbar').addEventListener('click', openCart);
    $('#cartItems').addEventListener('click', onCartClick);
    $('#cartItems').addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'note') return;
      const i = Number(e.target.closest('.cart-item').dataset.i);
      state.cart[i].note = e.target.value.trim().slice(0, 200);
      saveCart();
    });
    $('#btnCheckout').addEventListener('click', openCheckout);

    $('#coNext').addEventListener('click', next);
    $('#coForm').addEventListener('submit', (e) => { e.preventDefault(); next(); });
    $('#coBack').addEventListener('click', () => {
      if (state.step === 1) { openCart(); return; }
      if (typeof state.step === 'number') goStep(state.step - 1);
    });
    $('#coForm').addEventListener('change', (e) => {
      if (e.target.name === 'method') syncMethod();
    });
    $('#fReferral').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); });
    $('#fProof').addEventListener('change', onProof);
    $('#copyTotal').addEventListener('click', () => {
      const n = String(state.quote ? state.quote.total : 0);
      navigator.clipboard?.writeText(n).then(() => U.toast('Nominal disalin: ' + n), () => U.toast('Nominal: ' + n));
    });
    $('#copyCode').addEventListener('click', () => {
      const c = $('#doneCode').textContent;
      navigator.clipboard?.writeText(c).then(() => U.toast('Kode pesanan disalin'), () => {});
    });
    $('#doneAgain').addEventListener('click', () => { closeLayer(); renderCart(); refreshMenuSilently(); });

    $('#btnTrack').addEventListener('click', () => {
      const saved = U.store.get('gb_customer', {});
      if (saved.phone && !$('#tPhone').value) $('#tPhone').value = saved.phone;
      openLayer($('#trackSheet'));
    });
    $('#trackForm').addEventListener('submit', onTrack);

    // tampilkan lagi cartbar ketika layer ditutup
    new MutationObserver(() => { if (!state.layer) $('#cartbar').hidden = cartCount() === 0; })
      .observe($('#overlay'), { attributes: true, attributeFilter: ['hidden'] });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
