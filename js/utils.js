/* Utilitas bersama (pembeli + admin) */
(function () {
  const rupiahFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

  const U = {
    rupiah: (n) => rupiahFmt.format(Number(n) || 0).replace(/\s/g, ''),

    // tanggal hari ini di zona Asia/Jakarta, format YYYY-MM-DD
    todayJakarta() {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      return p; // en-CA => 2026-11-15
    },

    // '2026-11-17' -> Date (tengah hari, aman dari geser zona waktu)
    parseDate: (s) => new Date(s + 'T12:00:00'),

    fmtDate(s, opts) {
      if (!s) return '-';
      return new Intl.DateTimeFormat('id-ID', opts || { weekday: 'long', day: 'numeric', month: 'long' }).format(U.parseDate(s));
    },
    fmtDateShort(s) {
      return U.fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
    },
    fmtDateTime(iso) {
      if (!iso) return '-';
      return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
    },

    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    normalizePhone(p) {
      let d = String(p || '').replace(/\D/g, '');
      if (d.startsWith('62')) d = '0' + d.slice(2);
      return d;
    },
    validPhone: (p) => /^08\d{7,12}$/.test(U.normalizePhone(p)),

    waLink(phone, text) {
      let d = U.normalizePhone(phone);
      if (d.startsWith('0')) d = '62' + d.slice(1);
      return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
    },

    // warna teks yang kontras di atas warna latar
    onColor(hex) {
      const h = (hex || '#000').replace('#', '');
      const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return L > 0.33 ? '#3E2415' : '#FFF7E8';
    },

    // kompres foto sebelum upload (HP sering menghasilkan file 5–10 MB)
    compressImage(file, maxSide = 1600, quality = 0.82) {
      return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) return reject(new Error('File harus berupa gambar (JPG/PNG).'));
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar.'))), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak bisa dibaca. Coba foto lain.')); };
        img.src = url;
      });
    },

    randomId(n = 10) {
      const a = new Uint8Array(n);
      crypto.getRandomValues(a);
      return Array.from(a, (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
    },

    store: {
      get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage penuh/diblokir */ } },
      del(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } },
    },

    toast(msg, type = 'info', ms = 3200) {
      let wrap = document.getElementById('toasts');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'toasts';
        wrap.setAttribute('role', 'status');
        wrap.setAttribute('aria-live', 'polite');
        document.body.appendChild(wrap);
      }
      const t = document.createElement('div');
      t.className = 'toast toast-' + type;
      t.textContent = msg;
      wrap.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
    },

    errMsg(e) {
      const m = (e && (e.message || e.error_description || e.msg)) || String(e);
      if (/Failed to fetch|NetworkError/i.test(m)) return 'Koneksi bermasalah. Cek internet lalu coba lagi.';
      return m;
    },

    STATUS: {
      menunggu_verifikasi: { label: 'Menunggu verifikasi', short: 'Verifikasi' },
      diproses: { label: 'Pembayaran valid, sedang dibuat', short: 'Diproses' },
      siap: { label: 'Siap diambil / sedang diantar', short: 'Siap' },
      selesai: { label: 'Selesai', short: 'Selesai' },
      dibatalkan: { label: 'Dibatalkan', short: 'Batal' },
    },
  };

  window.U = U;
})();
