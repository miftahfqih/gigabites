/* =========================================================
   GIGABITES — dashboard admin
   ========================================================= */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const { esc, rupiah } = U;
  const PAID = ['diproses', 'siap', 'selesai'];

  const addDays = (iso, n) => { const d = U.parseDate(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const today = () => U.todayJakarta();

  const S = {
    orders: [],
    products: [],
    periods: [],
    stockPeriod: null,     // periode yang sedang diatur stoknya
    stockQuota: {},
    stockSold: {},
    settings: null,
    filter: { period: null, method: '', status: 'all', q: '' },
    current: null,         // pesanan yang sedang dibuka
    editing: null,         // produk yang sedang diedit
    deletedVariants: [],
    newIds: new Set(),
    tab: 'orders',
  };

  /* ================= AUTH ================= */
  async function init() {
    bind();
    if (API.initError) { showLogin(API.initError.message); return; }
    if (API.demo) $('#loginHint').textContent = 'Mode demo: isi email apa saja, password demo123';
    try {
      const me = await API.currentAdmin();
      if (me) startApp(me); else showLogin();
    } catch (e) { showLogin(U.errMsg(e)); }
  }

  function showLogin(err) {
    $('#appView').hidden = true;
    $('#loginView').hidden = false;
    $('#loginErr').textContent = err || '';
    setTimeout(() => $('#lEmail').focus(), 50);
  }

  async function onLogin(e) {
    e.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = 'Memeriksa…';
    $('#loginErr').textContent = '';
    try {
      await API.signIn($('#lEmail').value.trim(), $('#lPass').value);
      $('#lPass').value = '';
      startApp(await API.currentAdmin());
    } catch (err) {
      const m = U.errMsg(err);
      $('#loginErr').textContent = /Invalid login/i.test(m) ? 'Email atau password salah.' : m;
    } finally { btn.disabled = false; btn.textContent = 'Masuk'; }
  }

  async function logout() {
    await API.signOut();
    location.reload();
  }

  async function startApp(me) {
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#whoami').textContent = me ? me.email : '';
    initRecapRange();
    await Promise.all([loadOrders(true), loadProducts(), loadSettings()]);
    await loadPeriods();
    API.onNewOrder((o) => {
      U.toast(`Pesanan baru dari ${o.customer_name} — ${rupiah(o.total)}`, 'success', 6000);
      S.newIds.add(o.id);
      loadOrders();
      if (S.tab === 'recap') loadRecap();
    });
    // cadangan jika realtime tidak aktif: muat ulang tiap 60 detik
    setInterval(() => { if (S.tab === 'orders' && !S.current) loadOrders(true); }, 60000);
  }

  /* ================= TABS ================= */
  function switchTab(t) {
    S.tab = t;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== t));
    if (t === 'recap') loadRecap();
    if (t === 'dates') renderPeriods();
    window.scrollTo(0, 0);
  }

  /* ================= PESANAN ================= */
  async function loadOrders(silent) {
    try {
      S.orders = await API.listOrders({ from: addDays(today(), -120) });
      renderOrders();
      if (S.tab === 'dates') renderPeriods();
    } catch (e) { if (!silent) U.toast(U.errMsg(e), 'error'); }
  }

  // isi pilihan periode di tab Pesanan & Rekap
  function renderPeriodFilters() {
    const opts = S.periods.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(rangeTxt(p.order_start, p.order_end))})</option>`).join('');
    if (S.filter.period === null) {
      const live = S.periods.find((p) => periodStatus(p)[1] === 'live');
      S.filter.period = live ? live.id : '';
    }
    const f = $('#fPeriod');
    f.innerHTML = `<option value="">Semua periode (120 hari)</option>${opts}`;
    f.value = [...f.options].some((o) => o.value === S.filter.period) ? S.filter.period : '';
    S.filter.period = f.value;
    const r = $('#rPeriod');
    const cur = r.value;
    r.innerHTML = `<option value="">Pakai rentang tanggal</option>${opts}`;
    r.value = [...r.options].some((o) => o.value === cur) ? cur : (S.filter.period || '');
    syncRecapInputs();
    renderOrders();
  }

  function baseFiltered() {
    const { period, method, q } = S.filter;
    const qq = q.trim().toLowerCase();
    return S.orders.filter((o) => {
      if (period && o.po_period_id !== period) return false;
      if (method && o.method !== method) return false;
      if (qq) {
        const hay = [o.customer_name, o.phone, o.order_code, o.referral_code, o.address, o.pickup_location].join(' ').toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }

  function componentsText(comps) {
    const counts = {};
    (comps || []).forEach((c) => { const n = `${c.product_name} ${c.variant_name}`; counts[n] = (counts[n] || 0) + 1; });
    return Object.entries(counts).map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
  }
  const lineText = (i) => (i.components ? `${i.qty}× ${i.product_name} (${componentsText(i.components)})` : `${i.qty}× ${i.product_name} ${i.variant_name}`);
  const itemsText = (o) => (o.order_items || []).map(lineText).join(', ');
  // jumlah cup/gelas fisik (isi paket dihitung satu per satu)
  const unitCount = (o) => (o.order_items || []).reduce((b, i) => b + i.qty * (i.components ? i.components.length : 1), 0);
  const hasNotes = (o) => !!(o.notes || (o.order_items || []).some((i) => i.note));
  const whereText = (o) => (o.method === 'pickup' ? `Ambil · ${o.pickup_location}` : 'Diantar');

  function renderOrders() {
    const base = baseFiltered();
    const counts = { all: base.length };
    Object.keys(U.STATUS).forEach((s) => (counts[s] = base.filter((o) => o.status === s).length));
    const pendingAll = S.orders.filter((o) => o.status === 'menunggu_verifikasi').length;
    const badge = $('#badgePending');
    badge.hidden = !pendingAll; badge.textContent = pendingAll;
    document.title = (pendingAll ? `(${pendingAll}) ` : '') + 'Admin — Gigabites';

    $('#statusChips').innerHTML = [['all', 'Semua'], ...Object.entries(U.STATUS).map(([k, v]) => [k, v.short])]
      .map(([k, l]) => `<button type="button" data-status="${k}" class="${S.filter.status === k ? 'on' : ''}">${esc(l)}<b>${counts[k]}</b></button>`).join('');

    const list = S.filter.status === 'all' ? base : base.filter((o) => o.status === S.filter.status);
    const active = list.filter((o) => o.status !== 'dibatalkan');
    const items = active.reduce((a, o) => a + unitCount(o), 0);
    $('#orderStats').innerHTML = `<span><b>${list.length}</b> pesanan</span><span><b>${items}</b> cup & gelas</span><span><b>${rupiah(active.reduce((a, o) => a + o.total, 0))}</b> nilai pesanan</span>`;

    if (!list.length) {
      $('#orderList').innerHTML = `<div class="empty-admin"><strong>Belum ada pesanan di filter ini</strong>Coba ganti tanggal atau status. Pesanan baru muncul otomatis.</div>`;
      return;
    }
    $('#orderList').innerHTML = list.map((o) => `
      <button type="button" class="order-row ${S.newIds.has(o.id) ? 'new' : ''}" data-id="${o.id}">
        <span class="or-who"><strong>${esc(o.customer_name)}</strong><small>${esc(o.order_code)} · ${esc(o.phone)}</small></span>
        <span class="or-when">${esc(U.fmtDateShort(o.sale_date))}<small>${esc(whereText(o))}</small></span>
        <span class="or-items">${esc(itemsText(o))}${hasNotes(o) ? '<br><span class="note-flag">Ada catatan</span>' : ''}${o.referral_code ? ` <span class="note-flag">Ref ${esc(o.referral_code)}</span>` : ''}</span>
        <span class="or-total">${rupiah(o.total)}</span>
        <span class="badge st-${o.status}">${esc(U.STATUS[o.status].short)}</span>
      </button>`).join('');
  }

  async function openOrder(id) {
    const o = S.orders.find((x) => x.id === id);
    if (!o) return;
    S.current = o;
    S.newIds.delete(id);
    $('#odTitle').textContent = o.order_code;
    const items = (o.order_items || []).map((i) => `
      <div class="od-item"><span><b>${i.qty}×</b> ${esc(i.product_name)} ${i.components ? '' : esc(i.variant_name)} <small>${esc(i.size_label || '')} · ${rupiah(i.unit_price)}</small>
      ${i.components ? `<small class="od-comp">Isi per paket: ${esc(componentsText(i.components))}</small>` : ''}
      ${i.note ? `<small>Catatan: ${esc(i.note)}</small>` : ''}</span><b>${rupiah(i.line_total)}</b></div>`).join('');
    const waText = `Halo ${o.customer_name}, ini Gigabites 🧀 Pesanan ${o.order_code} untuk ${U.fmtDate(o.sale_date)} `;
    $('#odBody').innerHTML = `
      <div class="od-sec">
        <h4>Pemesan</h4>
        <dl class="od-kv">
          <dt>Nama</dt><dd>${esc(o.customer_name)}</dd>
          <dt>WhatsApp</dt><dd>${esc(o.phone)} &nbsp;<a class="od-wa" href="${U.waLink(o.phone, waText)}" target="_blank" rel="noopener">Chat</a></dd>
          <dt>Dipesan</dt><dd>${esc(U.fmtDateTime(o.created_at))}</dd>
          <dt>Referal</dt><dd>${esc(o.referral_code || '-')}</dd>
        </dl>
      </div>
      <div class="od-sec">
        <h4>Pengambilan / pengantaran</h4>
        <dl class="od-kv">
          <dt>Periode</dt><dd>${esc(periodName(o.po_period_id))}</dd>
          <dt>Tanggal</dt><dd>${esc(U.fmtDate(o.sale_date))}</dd>
          <dt>Cara</dt><dd>${o.method === 'pickup' ? 'Ambil sendiri' : 'Diantar'}</dd>
          ${o.method === 'pickup' ? `<dt>Lokasi</dt><dd>${esc(o.pickup_location)}</dd>` : `<dt>Alamat</dt><dd>${esc(o.address)}</dd>`}
        </dl>
      </div>
      <div class="od-sec">
        <h4>Item</h4>${items}
        <div class="od-item" style="border-top:2px solid var(--cream-2);margin-top:6px;padding-top:10px"><b>Total</b><b>${rupiah(o.total)}</b></div>
      </div>
      ${o.notes ? `<div class="od-sec"><h4>Catatan pesanan</h4><div class="od-note">${esc(o.notes)}</div></div>` : ''}
      <div class="od-sec">
        <h4>Bukti pembayaran</h4>
        <a class="od-proof" id="odProof" target="_blank" rel="noopener"><p class="hint" style="padding:16px">Memuat gambar…</p></a>
      </div>
      <div class="od-sec">
        <h4>Status</h4>
        <div class="status-pick">${Object.entries(U.STATUS).map(([k, v]) => `<label><input type="radio" name="odStatus" value="${k}" ${o.status === k ? 'checked' : ''} /><span>${esc(v.short)}</span></label>`).join('')}</div>
      </div>
      <div class="od-sec" style="border:0">
        <label class="field"><span class="field-label">Keterangan pengantaran untuk pembeli <em>(muncul di halaman cek pesanan)</em></span>
          <textarea id="odNote" rows="2" maxlength="300" placeholder="Contoh: diantar jam 15.00 oleh Rafi">${esc(o.admin_note || '')}</textarea></label>
      </div>`;
    openLayer($('#orderDrawer'));
    renderOrders();
    try {
      const url = await API.proofUrl(o.payment_proof_path);
      const a = $('#odProof');
      if (!a) return;
      if (url) { a.href = url; a.innerHTML = `<img src="${esc(url)}" alt="Bukti pembayaran ${esc(o.order_code)}" />`; }
      else a.innerHTML = '<p class="hint" style="padding:16px">Tidak ada bukti pembayaran.</p>';
    } catch (e) {
      $('#odProof').innerHTML = `<p class="field-err" style="padding:16px">${esc(U.errMsg(e))}</p>`;
    }
  }

  async function saveOrder() {
    const o = S.current;
    if (!o) return;
    const patch = { status: ($('input[name=odStatus]:checked') || {}).value || o.status, admin_note: $('#odNote').value.trim() || null };
    const btn = $('#odSave');
    btn.disabled = true;
    try {
      await API.updateOrder(o.id, patch);
      Object.assign(o, patch);
      U.toast('Pesanan disimpan', 'success');
      closeLayer();
      renderOrders();
    } catch (e) { U.toast(U.errMsg(e), 'error'); }
    finally { btn.disabled = false; }
  }

  async function deleteOrder() {
    const o = S.current;
    if (!o || !confirm(`Hapus pesanan ${o.order_code} milik ${o.customer_name}? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await API.deleteOrder(o);
      S.orders = S.orders.filter((x) => x.id !== o.id);
      closeLayer();
      renderOrders();
      U.toast('Pesanan dihapus');
    } catch (e) { U.toast(U.errMsg(e), 'error'); }
  }

  function exportCsv() {
    const base = baseFiltered();
    const list = S.filter.status === 'all' ? base : base.filter((o) => o.status === S.filter.status);
    const head = ['Kode', 'Dipesan', 'Tanggal', 'Nama', 'WhatsApp', 'Cara', 'Lokasi/Alamat', 'Item', 'Catatan item', 'Catatan pesanan', 'Referal', 'Total', 'Status', 'Keterangan admin'];
    const rows = list.map((o) => [
      o.order_code, U.fmtDateTime(o.created_at), o.sale_date, o.customer_name, o.phone,
      o.method === 'pickup' ? 'Ambil' : 'Antar', o.method === 'pickup' ? o.pickup_location : o.address,
      itemsText(o), (o.order_items || []).filter((i) => i.note).map((i) => `${i.product_name} ${i.variant_name}: ${i.note}`).join(' | '),
      o.notes || '', o.referral_code || '', o.total, U.STATUS[o.status].label, o.admin_note || '',
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pesanan-gigabites-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ================= REKAP ================= */
  function initRecapRange() {
    const t = today();
    $('#rFrom').value = t.slice(0, 8) + '01';
    $('#rTo').value = addDays(t, 30);
  }

  async function loadRecap() {
    try {
      const per = $('#rPeriod').value;
      const list = per ? await API.listOrders({ period: per })
        : await API.listOrders({ from: $('#rFrom').value || null, to: $('#rTo').value || null });
      renderRecap(list);
    } catch (e) { U.toast(U.errMsg(e), 'error'); }
  }

  function table(head, rows, opts = {}) {
    if (!rows.length) return '<p class="hint">Belum ada data.</p>';
    const max = Math.max(1, ...rows.map((r) => r[opts.barCol ?? 1] || 0));
    return `<table class="tbl ${opts.grouped ? 'grouped' : ''}"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.sub ? 'sub' : ''}">${r.map((c, i) => {
        if (i === 0) return `<td>${esc(c)}</td>`;
        const isBar = i === (opts.barCol ?? 1) && !r.sub;
        const val = opts.money && opts.money.includes(i) ? rupiah(c) : c;
        return `<td class="num ${isBar ? 'bar-cell' : ''}">${isBar ? `<i style="width:${(c / max) * 100}%"></i>` : ''}<span>${esc(val)}</span></td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderRecap(list) {
    const active = list.filter((o) => o.status !== 'dibatalkan');
    const paid = list.filter((o) => PAID.includes(o.status));
    const pending = list.filter((o) => o.status === 'menunggu_verifikasi');
    const sum = (arr) => arr.reduce((a, o) => a + o.total, 0);
    const qty = (arr) => arr.reduce((a, o) => a + unitCount(o), 0);

    $('#kpis').innerHTML = `
      <div class="kpi"><span>Pendapatan terverifikasi</span><strong>${rupiah(sum(paid))}</strong><small>${paid.length} pesanan sudah dicek</small></div>
      <div class="kpi"><span>Menunggu verifikasi</span><strong>${rupiah(sum(pending))}</strong><small>${pending.length} pesanan perlu dicek</small></div>
      <div class="kpi"><span>Total pesanan aktif</span><strong>${active.length}</strong><small>${list.length - active.length} dibatalkan</small></div>
      <div class="kpi"><span>Item terjual</span><strong>${qty(active)}</strong><small>cup & gelas</small></div>`;

    // daftar produksi: item satuan + isi paket, dikelompokkan per produk
    const byProd = {};
    const add = (pn, vn, n, fromBundle) => {
      const v = ((byProd[pn] ||= {})[vn] ||= { single: 0, bundle: 0 });
      v[fromBundle ? 'bundle' : 'single'] += n;
    };
    const bySale = {};
    active.forEach((o) => (o.order_items || []).forEach((i) => {
      if (i.components) i.components.forEach((c) => add(c.product_name, c.variant_name, i.qty, true));
      else add(i.product_name, i.variant_name, i.qty, false);
      const key = i.components ? i.product_name : `${i.product_name} ${i.variant_name}`;
      const r = (bySale[key] ||= [0, 0]); r[0] += i.qty; r[1] += i.line_total;
    }));
    const vRows = [];
    Object.entries(byProd).forEach(([pn, vars]) => {
      const vals = Object.values(vars);
      const s1 = vals.reduce((a, v) => a + v.single, 0), s2 = vals.reduce((a, v) => a + v.bundle, 0);
      const sub = [pn, s1 + s2, s1, s2]; sub.sub = true; vRows.push(sub);
      Object.entries(vars).forEach(([vn, v]) => vRows.push([vn, v.single + v.bundle, v.single, v.bundle]));
    });
    $('#recapVariant').innerHTML = table(['Menu', 'Total dibuat', 'Satuan', 'Dari paket'], vRows, { grouped: true });
    $('#recapSales').innerHTML = table(['Item / paket', 'Terjual', 'Pendapatan'],
      Object.entries(bySale).sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => [k, ...v]), { money: [2] });

    const byDate = {};
    active.forEach((o) => { const d = (byDate[o.sale_date] ||= [0, 0, 0]); d[0]++; d[1] += qty([o]); d[2] += o.total; });
    $('#recapDate').innerHTML = table(['Tanggal', 'Pesanan', 'Item', 'Nilai'],
      Object.keys(byDate).sort().map((d) => [U.fmtDateShort(d), ...byDate[d]]), { money: [3] });

    const byWhere = {};
    active.forEach((o) => { const k = o.method === 'pickup' ? `Ambil — ${o.pickup_location}` : 'Diantar'; const r = (byWhere[k] ||= [0, 0]); r[0]++; r[1] += o.total; });
    $('#recapMethod').innerHTML = table(['Cara terima', 'Pesanan', 'Nilai'], Object.entries(byWhere).map(([k, v]) => [k, ...v]), { money: [2] });

    const byRef = {};
    active.forEach((o) => { const k = o.referral_code || 'Tanpa kode'; const r = (byRef[k] ||= [0, 0]); r[0]++; r[1] += o.total; });
    $('#recapRef').innerHTML = table(['Kode', 'Pesanan', 'Nilai'],
      Object.entries(byRef).sort((a, b) => b[1][0] - a[1][0]).map(([k, v]) => [k, ...v]), { money: [2] });
  }

  /* ================= MENU ================= */
  async function loadProducts() {
    try { S.products = await API.listProducts(); renderMenu(); }
    catch (e) { U.toast(U.errMsg(e), 'error'); }
  }

  function renderMenu() {
    if (!S.products.length) {
      $('#menuAdmin').innerHTML = '<div class="empty-admin"><strong>Belum ada menu</strong>Tambah menu pertama kamu.</div>';
      return;
    }
    $('#menuAdmin').innerHTML = S.products.map((p) => `
      <article class="ma-card ${p.is_active ? '' : 'inactive'}" style="--accent:${esc(p.accent)}">
        <div class="ma-top">
          <img src="${esc(p.image_url || 'assets/mascot.svg')}" alt="" />
          <div><h3>${esc(p.name)}</h3><p>${{ drink: 'Minuman', bundle: 'Paket bundle', cheesecuit: 'Cheesecuit' }[p.category] || p.category}${p.is_active ? '' : ' · disembunyikan'}</p>
          ${p.category === 'bundle' ? `<p>Isi: ${esc(slotsSummary(p.bundle_slots))}</p>` : ''}</div>
        </div>
        <div class="ma-vars">
          ${p.variants.map((v) => `<div class="ma-var"><span><strong>${esc(v.name)}</strong> <small>${esc(v.size_label)}</small></span><span>${rupiah(v.price)}</span>
            <button type="button" class="stock-btn ${v.is_sold_out ? 'out' : 'in'}" data-variant="${v.id}" data-product="${p.id}">${v.is_sold_out ? 'Sold out' : 'Tersedia'}</button></div>`).join('')}
        </div>
        <div class="ma-foot">
          <label class="switch-row"><input type="checkbox" class="switch" data-soldall="${p.id}" ${p.is_sold_out ? 'checked' : ''} /><span>Sold out semua</span></label>
          <button type="button" class="btn-chip" data-edit="${p.id}">Edit menu</button>
        </div>
      </article>`).join('');
  }

  const slotsSummary = (slots) => (slots || []).map((s) => `${s.qty || 1} ${s.variant_name}`).join(' + ') || 'belum diatur';

  async function toggleVariant(btn) {
    const p = S.products.find((x) => x.id === btn.dataset.product);
    const v = p.variants.find((x) => x.id === btn.dataset.variant);
    const next = !v.is_sold_out;
    btn.disabled = true;
    try {
      await API.quickUpdateVariant(v.id, { is_sold_out: next });
      v.is_sold_out = next;
      renderMenu();
      U.toast(`${p.name} ${v.name}: ${next ? 'sold out' : 'tersedia lagi'}`);
    } catch (e) { U.toast(U.errMsg(e), 'error'); btn.disabled = false; }
  }

  async function toggleSoldAll(input) {
    const p = S.products.find((x) => x.id === input.dataset.soldall);
    try {
      await API.quickUpdateProduct(p.id, { is_sold_out: input.checked });
      p.is_sold_out = input.checked;
      U.toast(`${p.name}: ${input.checked ? 'semua varian sold out' : 'dijual lagi'}`);
    } catch (e) { input.checked = !input.checked; U.toast(U.errMsg(e), 'error'); }
  }

  function openEditor(id) {
    const p = id ? JSON.parse(JSON.stringify(S.products.find((x) => x.id === id)))
      : { name: '', tagline: '', description: '', category: 'cheesecuit', image_url: '', accent: '#C8955F', sort_order: S.products.length + 1, is_active: true, is_sold_out: false,
          variants: [{ name: 'Megabites', size_label: '120 ml', price: 15000 }, { name: 'Gigabites', size_label: '150 ml', price: 20000 }] };
    p.bundle_slots = p.bundle_slots || [];
    S.editing = p;
    S.deletedVariants = [];
    $('#peTitle').textContent = id ? `Edit ${p.name}` : 'Menu baru';
    $('#peName').value = p.name;
    $('#peTag').value = p.tagline || '';
    $('#peDesc').value = p.description || '';
    $('#peCat').value = p.category;
    $('#peAccent').value = p.accent || '#C8955F';
    $('#peSort').value = p.sort_order || 0;
    $('#peActive').checked = !!p.is_active;
    $('#peImg').src = p.image_url || 'assets/mascot.svg';
    $('#peDelete').hidden = !id;
    renderVarEditor();
    renderSlotEditor();
    syncCategory();
    openLayer($('#productEditor'));
  }

  function renderVarEditor() {
    $('#peVariants').innerHTML = S.editing.variants.map((v, i) => `
      <div class="pe-var" data-i="${i}">
        <input data-k="name" value="${esc(v.name)}" placeholder="Nama varian" aria-label="Nama varian" required />
        <input data-k="size_label" value="${esc(v.size_label)}" placeholder="120 ml" aria-label="Ukuran" required />
        <input data-k="price" type="number" min="0" step="500" value="${v.price}" placeholder="Harga" aria-label="Harga" required />
        <label><input type="checkbox" data-k="is_sold_out" ${v.is_sold_out ? 'checked' : ''} /> Sold out</label>
        <button type="button" class="rm" data-rm="${i}" aria-label="Hapus varian">&times;</button>
      </div>`).join('');
  }

  function syncCategory() {
    const isBundle = $('#peCat').value === 'bundle';
    $('#peSlotsBox').hidden = !isBundle;
    if (isBundle && S.editing.variants.length > 1 && !S.editing.id) {
      S.editing.variants = [{ name: 'Paket', size_label: '1 cup + 1 drink', price: 20000, is_sold_out: false }];
      renderVarEditor();
    }
    if (isBundle && !S.editing.bundle_slots.length) {
      S.editing.bundle_slots = [{ category: 'cheesecuit', variant_name: 'Megabites', qty: 1 }, { category: 'drink', variant_name: 'Mega Drink', qty: 1 }];
      renderSlotEditor();
    }
  }

  function renderSlotEditor() {
    const names = new Set();
    S.products.forEach((p) => { if (p.category !== 'bundle') p.variants.forEach((v) => names.add(v.name)); });
    $('#peVarNames').innerHTML = [...names].map((n) => `<option value="${esc(n)}"></option>`).join('');
    $('#peSlots').innerHTML = S.editing.bundle_slots.map((s, i) => `
      <div class="pe-slot" data-i="${i}">
        <select data-k="category" aria-label="Jenis"><option value="cheesecuit" ${s.category === 'cheesecuit' ? 'selected' : ''}>Cheesecuit</option><option value="drink" ${s.category === 'drink' ? 'selected' : ''}>Minuman</option></select>
        <input data-k="variant_name" list="peVarNames" value="${esc(s.variant_name)}" placeholder="Megabites" aria-label="Nama varian" />
        <input data-k="qty" type="number" min="1" max="10" value="${s.qty || 1}" aria-label="Jumlah" />
        <button type="button" class="rm" data-rmslot="${i}" aria-label="Hapus isi">&times;</button>
      </div>`).join('') || '<p class="hint">Belum ada isi paket.</p>';
  }

  function readSlotEditor() {
    S.editing.bundle_slots = $$('#peSlots .pe-slot').map((r) => ({
      category: $('[data-k=category]', r).value,
      variant_name: $('[data-k=variant_name]', r).value.trim(),
      qty: Math.max(1, Number($('[data-k=qty]', r).value) || 1),
    }));
  }

  function readVarEditor() {
    $$('#peVariants .pe-var').forEach((row) => {
      const v = S.editing.variants[Number(row.dataset.i)];
      $$('[data-k]', row).forEach((inp) => { v[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; });
    });
  }

  async function onProductImage(e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      U.toast('Mengunggah foto…');
      const blob = await U.compressImage(f, 1200, 0.88, { keepAlpha: true });
      S.editing.image_url = await API.uploadAsset(blob, 'menu');
      $('#peImg').src = S.editing.image_url;
    } catch (err) { U.toast(U.errMsg(err), 'error'); }
    e.target.value = '';
  }

  async function saveProduct(e) {
    e.preventDefault();
    readVarEditor();
    readSlotEditor();
    const p = S.editing;
    Object.assign(p, {
      name: $('#peName').value.trim(), tagline: $('#peTag').value.trim(), description: $('#peDesc').value.trim(),
      category: $('#peCat').value, accent: $('#peAccent').value, sort_order: Number($('#peSort').value) || 0, is_active: $('#peActive').checked,
    });
    if (!p.name) return U.toast('Nama menu wajib diisi', 'error');
    const vars = p.variants.filter((v) => v.name.trim());
    if (!vars.length) return U.toast('Tambahkan minimal satu varian', 'error');
    if (vars.some((v) => !(Number(v.price) >= 0) || !String(v.size_label).trim())) return U.toast('Lengkapi ukuran dan harga tiap varian', 'error');
    if (p.category === 'bundle') {
      p.bundle_slots = p.bundle_slots.filter((s) => s.variant_name);
      if (!p.bundle_slots.length) return U.toast('Tambahkan isi paket', 'error');
      if (vars.length > 1) return U.toast('Paket cukup punya satu varian harga', 'error');
    }
    if (!p.slug) p.slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + U.randomId(3);
    const btn = $('#peSave');
    btn.disabled = true;
    try {
      await API.saveProduct(p, vars, S.deletedVariants);
      U.toast('Menu disimpan', 'success');
      closeLayer();
      loadProducts();
    } catch (err) { U.toast(U.errMsg(err), 'error'); }
    finally { btn.disabled = false; }
  }

  async function deleteProduct() {
    const p = S.editing;
    if (!p.id || !confirm(`Hapus menu ${p.name} beserta semua variannya? Riwayat pesanan tetap tersimpan. Kalau hanya ingin menyembunyikan, matikan "Tampilkan di menu".`)) return;
    try { await API.deleteProduct(p.id); closeLayer(); loadProducts(); U.toast('Menu dihapus'); }
    catch (err) { U.toast(U.errMsg(err), 'error'); }
  }

  /* ================= PO & STOK ================= */
  function rangeTxt(a, b) {
    const f = (d) => U.fmtDate(d, { day: 'numeric', month: 'short' });
    return a === b ? f(a) : `${f(a)} – ${f(b)}`;
  }
  const periodName = (id) => { const p = S.periods.find((x) => x.id === id); return p ? p.name : '-'; };
  function periodStatus(p) {
    const t = today();
    if (!p.is_open) return ['Ditutup manual', 'closed'];
    if (t < p.order_start) return ['Belum dibuka', 'soon'];
    if (t > p.order_end) return t > p.delivery_end ? ['Selesai', 'done'] : ['PO ditutup, masa ambil/antar', 'done'];
    return ['Sedang berjalan', 'live'];
  }

  async function loadPeriods() {
    try {
      S.periods = await API.listPeriods();
      renderPeriodFilters();
      renderPeriods();
      if (S.stockPeriod && S.periods.some((p) => p.id === S.stockPeriod)) openStock(S.stockPeriod);
      else $('#stockPanel').hidden = true;
    } catch (e) { U.toast(U.errMsg(e), 'error'); }
  }

  function renderPeriods() {
    const stats = {};
    S.orders.forEach((o) => {
      if (!o.po_period_id || o.status === 'dibatalkan') return;
      const st = (stats[o.po_period_id] ||= { n: 0, total: 0 });
      st.n++; st.total += o.total;
    });
    $('#periodList').innerHTML = S.periods.length ? S.periods.map((p) => {
      const [label, cls] = periodStatus(p);
      const st = stats[p.id] || { n: 0, total: 0 };
      return `<article class="po-card ${S.stockPeriod === p.id ? 'selected' : ''}" data-id="${p.id}">
          <div class="po-main">
            <div class="po-title"><h3>${esc(p.name)}</h3><span class="po-badge ${cls}">${esc(label)}</span></div>
            <dl class="po-dates">
              <div><dt>PO dibuka</dt><dd>${esc(rangeTxt(p.order_start, p.order_end))}</dd></div>
              <div><dt>Ambil / antar</dt><dd>${esc(rangeTxt(p.delivery_start, p.delivery_end))}</dd></div>
              <div><dt>Pesanan aktif</dt><dd>${st.n} (${rupiah(st.total)})</dd></div>
            </dl>
            ${p.note ? `<p class="hint">${esc(p.note)}</p>` : ''}
          </div>
          <div class="po-actions">
            <label class="switch-row"><input type="checkbox" class="switch" data-open="${p.id}" ${p.is_open ? 'checked' : ''} /><span>${p.is_open ? 'Dibuka' : 'Ditutup'}</span></label>
            <button type="button" class="btn-chip strong" data-stock="${p.id}">Atur stok</button>
            <button type="button" class="btn-chip" data-editp="${p.id}">Edit</button>
            <button type="button" class="btn-ghost small danger" data-delp="${p.id}">Hapus</button>
          </div>
        </article>`;
    }).join('') : '<div class="empty-admin"><strong>Belum ada periode PO</strong>Buat periode pertama di atas. Pembeli baru bisa memesan saat ada periode yang sedang berjalan.</div>';
  }

  function fillPeriodForm(p) {
    const t = today();
    $('#pId').value = p ? p.id : '';
    $('#pName').value = p ? p.name : '';
    $('#pOrderStart').value = p ? p.order_start : t;
    $('#pOrderEnd').value = p ? p.order_end : addDays(t, 2);
    $('#pDelStart').value = p ? p.delivery_start : addDays(t, 3);
    $('#pDelEnd').value = p ? p.delivery_end : addDays(t, 3);
    $('#pNote').value = p ? p.note || '' : '';
    $('#pCopyRow').hidden = !!p || !S.periods.length;
    $('#pSave').textContent = p ? 'Simpan perubahan' : 'Buat periode';
    $('#pCancel').hidden = !p;
    $('#pFormTitle').textContent = p ? `Edit ${p.name}` : 'Periode PO baru';
  }

  async function savePeriodForm(e) {
    e.preventDefault();
    const id = $('#pId').value;
    const old = S.periods.find((x) => x.id === id);
    const data = {
      id: id || undefined, name: $('#pName').value, order_start: $('#pOrderStart').value, order_end: $('#pOrderEnd').value,
      delivery_start: $('#pDelStart').value, delivery_end: $('#pDelEnd').value, note: $('#pNote').value,
      is_open: old ? old.is_open : true,
    };
    if (!data.name.trim()) return U.toast('Isi nama periode, misalnya "PO Minggu 3"', 'error');
    const btn = $('#pSave');
    btn.disabled = true;
    try {
      const saved = await API.savePeriod(data);
      if (!id && $('#pCopy').checked && S.periods.length) {
        const prev = S.periods[0];
        const q = await API.getStock(prev.id);
        if (Object.keys(q).length) await API.saveStock(saved.id, q);
      }
      U.toast(id ? 'Periode diperbarui' : 'Periode PO dibuat', 'success');
      if (!id) S.stockPeriod = saved.id;
      fillPeriodForm(null);
      await loadPeriods();
    } catch (err) { U.toast(U.errMsg(err), 'error'); }
    finally { btn.disabled = false; }
  }

  async function onPeriodClick(e) {
    const st = e.target.closest('[data-stock]');
    if (st) { openStock(st.dataset.stock); return; }
    const ed = e.target.closest('[data-editp]');
    if (ed) { fillPeriodForm(S.periods.find((x) => x.id === ed.dataset.editp)); $('#periodForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const del = e.target.closest('[data-delp]');
    if (del) {
      const p = S.periods.find((x) => x.id === del.dataset.delp);
      if (!confirm(`Hapus ${p.name}? Kuota stoknya ikut terhapus. Pesanan yang sudah masuk tetap tersimpan.`)) return;
      try {
        await API.deletePeriod(p.id);
        if (S.stockPeriod === p.id) S.stockPeriod = null;
        U.toast('Periode dihapus');
        loadPeriods();
      } catch (err) { U.toast(U.errMsg(err), 'error'); }
    }
  }

  async function onPeriodToggle(e) {
    const id = e.target.dataset.open;
    if (!id) return;
    const p = S.periods.find((x) => x.id === id);
    try {
      await API.savePeriod({ ...p, is_open: e.target.checked });
      p.is_open = e.target.checked;
      renderPeriods();
      U.toast(`${p.name} ${p.is_open ? 'dibuka' : 'ditutup'}`);
    } catch (err) { e.target.checked = !e.target.checked; U.toast(U.errMsg(err), 'error'); }
  }

  // terjual per varian (satuan + isi paket) dari daftar pesanan
  function soldByVariant(orders) {
    const m = {};
    orders.filter((o) => o.status !== 'dibatalkan').forEach((o) => (o.order_items || []).forEach((i) => {
      if (i.components) i.components.forEach((c) => { m[c.variant_id] = (m[c.variant_id] || 0) + i.qty; });
      else if (i.variant_id) m[i.variant_id] = (m[i.variant_id] || 0) + i.qty;
    }));
    return m;
  }

  async function openStock(periodId) {
    S.stockPeriod = periodId;
    renderPeriods();
    const p = S.periods.find((x) => x.id === periodId);
    const panel = $('#stockPanel');
    panel.hidden = false;
    $('#stockTitle').textContent = `Stok ${p.name}`;
    $('#stockTable').innerHTML = '<p class="hint">Memuat stok…</p>';
    try {
      const [quota, orders] = await Promise.all([API.getStock(periodId), API.listOrders({ period: periodId })]);
      S.stockQuota = quota;
      S.stockSold = soldByVariant(orders);
      renderStock();
    } catch (err) { $('#stockTable').innerHTML = `<p class="field-err">${esc(U.errMsg(err))}</p>`; }
  }

  function renderStock() {
    const prods = S.products.filter((p) => p.category !== 'bundle');
    if (!prods.length) { $('#stockTable').innerHTML = '<p class="hint">Belum ada menu.</p>'; return; }
    $('#stockTable').innerHTML = `<table class="tbl stock-tbl">
      <thead><tr><th>Menu</th><th class="num">Kuota</th><th class="num">Terjual</th><th class="num">Sisa</th></tr></thead>
      <tbody>${prods.map((p) => `
        <tr class="sub"><td colspan="4">${esc(p.name)}${p.is_active ? '' : ' <small>(disembunyikan)</small>'}</td></tr>
        ${p.variants.map((v) => {
          const q = S.stockQuota[v.id];
          const sold = S.stockSold[v.id] || 0;
          const has = q !== undefined && q !== null;
          const rem = has ? Math.max(0, q - sold) : null;
          return `<tr>
            <td>${esc(v.name)} <small>${esc(v.size_label)}</small></td>
            <td class="num"><input type="number" min="0" class="quota-input" data-qv="${v.id}" value="${has ? q : ''}" placeholder="∞" aria-label="Kuota ${esc(p.name)} ${esc(v.name)}" /></td>
            <td class="num">${sold}</td>
            <td class="num"><span class="rem ${!has ? '' : rem === 0 ? 'out' : rem <= 5 ? 'low' : 'ok'}">${has ? rem : 'Tak terbatas'}</span></td>
          </tr>`;
        }).join('')}`).join('')}
      </tbody></table>`;
  }

  async function saveStock() {
    const quotas = {};
    $$('#stockTable [data-qv]').forEach((inp) => { quotas[inp.dataset.qv] = inp.value === '' ? null : Math.max(0, Number(inp.value) || 0); });
    const under = Object.entries(quotas).filter(([v, q]) => q !== null && q < (S.stockSold[v] || 0));
    if (under.length && !confirm('Ada kuota yang lebih kecil dari jumlah yang sudah terjual. Pesanan lama tetap tersimpan, tapi varian itu langsung habis. Lanjut simpan?')) return;
    const btn = $('#btnSaveStock');
    btn.disabled = true;
    try {
      await API.saveStock(S.stockPeriod, quotas);
      S.stockQuota = Object.fromEntries(Object.entries(quotas).filter(([, q]) => q !== null));
      renderStock();
      U.toast('Stok disimpan', 'success');
    } catch (err) { U.toast(U.errMsg(err), 'error'); }
    finally { btn.disabled = false; }
  }

  function fillAllStock() {
    const n = $('#stockFillAll').value;
    if (n === '') return U.toast('Isi angka dulu, misalnya 25', 'error');
    $$('#stockTable [data-qv]').forEach((inp) => { inp.value = Math.max(0, Number(n) || 0); });
    U.toast('Semua kuota terisi. Klik "Simpan stok" untuk menyimpan.');
  }

  function syncRecapInputs() {
    const byPeriod = !!$('#rPeriod').value;
    $('#rFrom').disabled = byPeriod;
    $('#rTo').disabled = byPeriod;
  }

  /* ================= PENGATURAN ================= */
  async function loadSettings() {
    try { S.settings = await API.getSettings(); renderSettings(); }
    catch (e) { U.toast(U.errMsg(e), 'error'); }
  }

  function renderSettings() {
    const s = S.settings;
    $('#sOpen').checked = !!s.store_open;
    $('#sAnnounce').value = s.announcement || '';
    $('#sWa').value = s.admin_whatsapp || '';
    $('#sDelNote').value = s.delivery_note || '';
    $('#sQrisPrev').src = s.qris_image_url || 'assets/qris-placeholder.svg';
    renderLocs();
  }

  function renderLocs() {
    $('#locEditor').innerHTML = (S.settings.pickup_locations || []).map((l, i) => `
      <div class="loc-row" data-i="${i}">
        <input data-k="name" value="${esc(l.name)}" placeholder="Nama lokasi" aria-label="Nama lokasi" />
        <input data-k="detail" value="${esc(l.detail || '')}" placeholder="Keterangan untuk pembeli" aria-label="Keterangan lokasi" />
        <button type="button" data-rmloc="${i}" aria-label="Hapus lokasi">&times;</button>
      </div>`).join('') || '<p class="hint">Belum ada lokasi pengambilan.</p>';
  }

  function readLocs(dropEmpty) {
    const locs = $$('#locEditor .loc-row').map((r) => ({ name: $('[data-k=name]', r).value.trim(), detail: $('[data-k=detail]', r).value.trim() }));
    S.settings.pickup_locations = dropEmpty ? locs.filter((l) => l.name) : locs;
  }

  async function onQris(e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      U.toast('Mengunggah QRIS…');
      // QRIS jangan dikompres terlalu kecil agar tetap bisa discan
      // QRIS tetap JPG berlatar putih (paling aman untuk discan)
      const blob = await U.compressImage(f, 1400, 0.92);
      S.settings.qris_image_url = await API.uploadAsset(blob, 'qris');
      $('#sQrisPrev').src = S.settings.qris_image_url;
      U.toast('QRIS terunggah. Klik "Simpan pengaturan" untuk menerapkan.', 'success', 4500);
    } catch (err) { U.toast(U.errMsg(err), 'error'); }
    e.target.value = '';
  }

  async function saveSettings(e) {
    e.preventDefault();
    readLocs(true);
    const wa = $('#sWa').value.trim();
    if (wa && !U.validPhone(wa)) return U.toast('Nomor WhatsApp admin harus diawali 08', 'error');
    Object.assign(S.settings, {
      store_open: $('#sOpen').checked, announcement: $('#sAnnounce').value.trim() || null,
      admin_whatsapp: wa ? U.normalizePhone(wa) : null, delivery_fee: 0,
      delivery_note: $('#sDelNote').value.trim() || null,
    });
    const btn = $('#btnSaveSettings');
    btn.disabled = true;
    try { S.settings = await API.saveSettings(S.settings); renderSettings(); U.toast('Pengaturan disimpan', 'success'); }
    catch (err) { U.toast(U.errMsg(err), 'error'); }
    finally { btn.disabled = false; }
  }

  /* ================= LAYER ================= */
  let layer = null, lastFocus = null;
  function openLayer(el) {
    lastFocus = document.activeElement;
    layer = el;
    $('#overlay').hidden = false;
    el.hidden = false;
    el.setAttribute('tabindex', '-1');
    document.body.classList.add('locked');
    setTimeout(() => el.focus({ preventScroll: true }), 30);
  }
  function closeLayer() {
    if (!layer) return;
    layer.hidden = true;
    layer = null;
    S.current = null;
    $('#overlay').hidden = true;
    document.body.classList.remove('locked');
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  /* ================= BIND ================= */
  let searchT;
  function bind() {
    $('#loginForm').addEventListener('submit', onLogin);
    $('#btnLogout').addEventListener('click', logout);
    $('#btnLogoutM').addEventListener('click', logout);
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });

    $('#fPeriod').addEventListener('change', (e) => { S.filter.period = e.target.value; renderOrders(); });
    $('#fMethod').addEventListener('change', (e) => { S.filter.method = e.target.value; renderOrders(); });
    $('#fSearch').addEventListener('input', (e) => { clearTimeout(searchT); searchT = setTimeout(() => { S.filter.q = e.target.value; renderOrders(); }, 150); });
    $('#statusChips').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) { S.filter.status = b.dataset.status; renderOrders(); } });
    $('#orderList').addEventListener('click', (e) => { const r = e.target.closest('.order-row'); if (r) openOrder(r.dataset.id); });
    $('#btnRefresh').addEventListener('click', () => { loadOrders(); U.toast('Data pesanan dimuat ulang'); });
    $('#btnExport').addEventListener('click', exportCsv);
    $('#odSave').addEventListener('click', saveOrder);
    $('#odDelete').addEventListener('click', deleteOrder);

    $('#rPeriod').addEventListener('change', () => { syncRecapInputs(); loadRecap(); });
    $('#rFrom').addEventListener('change', loadRecap);
    $('#rTo').addEventListener('change', loadRecap);

    $('#menuAdmin').addEventListener('click', (e) => {
      const s = e.target.closest('.stock-btn'); if (s) return toggleVariant(s);
      const ed = e.target.closest('[data-edit]'); if (ed) openEditor(ed.dataset.edit);
    });
    $('#menuAdmin').addEventListener('change', (e) => { if (e.target.dataset.soldall) toggleSoldAll(e.target); });
    $('#btnAddProduct').addEventListener('click', () => openEditor(null));
    $('#peForm').addEventListener('submit', saveProduct);
    $('#peFile').addEventListener('change', onProductImage);
    $('#peAddVar').addEventListener('click', () => { readVarEditor(); S.editing.variants.push({ name: '', size_label: '', price: 0, is_sold_out: false }); renderVarEditor(); });
    $('#peVariants').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      readVarEditor();
      const [v] = S.editing.variants.splice(Number(b.dataset.rm), 1);
      if (v.id) S.deletedVariants.push(v.id);
      renderVarEditor();
    });
    $('#peDelete').addEventListener('click', deleteProduct);
    $('#peCat').addEventListener('change', () => { readVarEditor(); readSlotEditor(); syncCategory(); });
    $('#peAddSlot').addEventListener('click', () => { readSlotEditor(); S.editing.bundle_slots.push({ category: 'cheesecuit', variant_name: '', qty: 1 }); renderSlotEditor(); });
    $('#peSlots').addEventListener('click', (e) => { const b = e.target.closest('[data-rmslot]'); if (b) { readSlotEditor(); S.editing.bundle_slots.splice(Number(b.dataset.rmslot), 1); renderSlotEditor(); } });

    $('#periodForm').addEventListener('submit', savePeriodForm);
    $('#pCancel').addEventListener('click', () => fillPeriodForm(null));
    $('#periodList').addEventListener('click', onPeriodClick);
    $('#periodList').addEventListener('change', onPeriodToggle);
    $('#btnSaveStock').addEventListener('click', saveStock);
    $('#btnFillAll').addEventListener('click', fillAllStock);
    $('#btnCloseStock').addEventListener('click', () => { S.stockPeriod = null; $('#stockPanel').hidden = true; renderPeriods(); });
    fillPeriodForm(null);

    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#sQrisFile').addEventListener('change', onQris);
    $('#btnAddLoc').addEventListener('click', () => { readLocs(); S.settings.pickup_locations.push({ name: '', detail: '' }); renderLocs(); });
    $('#locEditor').addEventListener('click', (e) => { const b = e.target.closest('[data-rmloc]'); if (b) { readLocs(); S.settings.pickup_locations.splice(Number(b.dataset.rmloc), 1); renderLocs(); } });

    document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeLayer(); });
    $('#overlay').addEventListener('click', closeLayer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLayer(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
