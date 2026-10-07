'use strict';
// core.js — inti sniper bot. CommonJS, tanpa dependency, Node >= 18.
// Dipakai oleh CLI, web lokal, maupun Electron (jalankan di proses utama/Node, bukan di renderer).

const DEFAULTS = {
  dryRun: true,
  mode: 'auto', // 'auto' | 'custom'
  customBid: 0,
  increment: 0,
  stepsAbove: 1,
  maxBid: 0,
  fireBeforeMs: 2500,
  refreshBeforeMs: 4000,
  pollMs: 15000,
  requestTimeoutMs: 8000,
  timezone: '+07:00', // dipakai bila waktu dari server tidak membawa zona waktu
  stateUrl: '',
  pricePath: '',
  endTimePath: '',
  serverTimePath: '',
  bidUrl: '',
  bidBody: '',
  bidMethod: 'POST',
  cookie: '',
  extraHeaders: {},
};

class SniperError extends Error {}

const abortErr = () => Object.assign(new Error('Dibatalkan'), { name: 'AbortError' });
const isAbort = (e) => e && e.name === 'AbortError';
const get = (o, path) => String(path).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

// ---------- parsing ----------

// Waktu dari server -> epoch ms. Mendukung epoch (detik/ms), ISO, "YYYY-MM-DD HH:mm:ss",
// dan "DD/MM/YYYY HH:mm:ss". Format tanpa zona waktu dianggap berzona `tz` (default WIB).
function toMs(v, tz = '+07:00') {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s), tz);
  const dmy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dmy) return Date.parse(`${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4]}:${dmy[5]}:${dmy[6] || '00'}${tz}`);
  let iso = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += tz;
  return Date.parse(iso);
}

// "Rp 1.500.000,00" / "1,500,000.50" / 1500000 -> angka
function toMoney(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  let s = v.replace(/rp\.?/i, '').replace(/\s/g, '');
  if (s === '') return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return Number(s);
}

// ---------- validasi konfigurasi ----------

function num(v, def) {
  if (v === '' || v == null) return def;
  const n = toMoney(v);
  return Number.isFinite(n) ? n : NaN;
}

function normalize(user = {}) {
  const c = { ...DEFAULTS, ...user };
  for (const k of ['stateUrl', 'pricePath', 'endTimePath', 'serverTimePath', 'bidUrl', 'bidBody', 'cookie', 'timezone']) {
    c[k] = typeof c[k] === 'string' ? c[k].trim() : DEFAULTS[k];
  }
  c.bidMethod = String(user.bidMethod || DEFAULTS.bidMethod).toUpperCase();
  c.mode = user.mode === 'custom' ? 'custom' : 'auto';
  c.dryRun = user.dryRun === undefined ? DEFAULTS.dryRun : user.dryRun !== false && user.dryRun !== 'false';
  c.extraHeaders = { ...DEFAULTS.extraHeaders, ...(user.extraHeaders || {}) };
  for (const k of ['customBid', 'increment', 'stepsAbove', 'maxBid', 'fireBeforeMs', 'refreshBeforeMs', 'pollMs', 'requestTimeoutMs']) {
    c[k] = num(user[k], DEFAULTS[k]);
  }
  return c;
}

function checkUrl(name, v, errs) {
  try {
    if (!/^https?:$/.test(new URL(v).protocol)) throw new Error();
  } catch {
    errs.push(`${name} harus berupa URL http(s) yang valid`);
  }
}

function stateErrors(c) {
  const errs = [];
  checkUrl('stateUrl', c.stateUrl, errs);
  if (!c.pricePath) errs.push('pricePath wajib diisi');
  if (!c.endTimePath) errs.push('endTimePath wajib diisi');
  if (!/^[+-]\d{2}:\d{2}$/.test(c.timezone)) errs.push('timezone harus berformat +07:00');
  if (!(c.requestTimeoutMs >= 1000)) errs.push('requestTimeoutMs minimal 1000');
  return errs;
}

function validateConfig(user) {
  const c = normalize(user);
  const errs = stateErrors(c);
  checkUrl('bidUrl', c.bidUrl, errs);
  if (!['POST', 'PUT', 'PATCH', 'GET'].includes(c.bidMethod)) errs.push('bidMethod tidak dikenal');
  if (!c.bidUrl.includes('{{amount}}') && !c.bidBody.includes('{{amount}}') && c.bidMethod !== 'GET') {
    errs.push('bidBody (atau bidUrl) harus memuat penanda {{amount}}');
  }
  if (!(c.maxBid > 0)) errs.push('maxBid wajib diisi dan lebih dari 0');
  if (c.mode === 'auto' && !(c.increment > 0)) errs.push('increment wajib diisi (lebih dari 0) untuk mode auto');
  if (c.mode === 'custom' && !(c.customBid > 0)) errs.push('customBid wajib diisi untuk mode custom');
  if (!(c.stepsAbove >= 1)) errs.push('stepsAbove minimal 1');
  if (!(c.fireBeforeMs >= 0)) errs.push('fireBeforeMs tidak boleh negatif');
  if (!(c.refreshBeforeMs >= 500)) errs.push('refreshBeforeMs minimal 500');
  if (!(c.pollMs >= 1000)) errs.push('pollMs minimal 1000');
  return { config: c, errors: errs };
}

// ---------- jaringan ----------

function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortErr());
    const onAbort = () => {
      clearTimeout(t);
      reject(abortErr());
    };
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

// setTimeout kasar, lalu busy-wait di 50 ms terakhir agar presisi
async function sleepUntil(t, signal) {
  const d = t - Date.now();
  if (d > 50) await sleepAbortable(d - 50, signal);
  if (signal && signal.aborted) throw abortErr();
  while (Date.now() < t);
}

async function fetchT(url, opts, timeoutMs, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (signal && signal.aborted) throw abortErr();
    if (ctrl.signal.aborted) throw new Error(`Timeout setelah ${timeoutMs} ms`);
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function buildHeaders(c) {
  const h = { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json', ...c.extraHeaders };
  if (c.cookie) h.Cookie = c.cookie;
  return h;
}

async function fetchJson(c, signal) {
  const t0 = Date.now();
  const res = await fetchT(c.stateUrl, { method: 'GET', headers: buildHeaders(c) }, c.requestTimeoutMs, signal);
  const rtt = Date.now() - t0;
  if (!res.ok) {
    const auth = res.status === 401 || res.status === 403 ? ' (cookie kedaluwarsa atau tidak valid?)' : '';
    throw new Error(`stateUrl membalas HTTP ${res.status}${auth}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Respons stateUrl bukan JSON (cookie kedaluwarsa atau URL salah?)');
  }
  return { json, res, t0, rtt };
}

// Daftar semua field (daun JSON) beserta tebakan jenisnya, untuk dipilih di UI.
function flattenPaths(json, limit = 200) {
  const out = [];
  const now = Date.now();
  const dateLike = (v) => {
    if (typeof v === 'string' && !/\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|^\d{10,13}$/.test(v.trim())) return false;
    const t = toMs(v);
    return Number.isFinite(t) && t > now - 400 * 864e5 && t < now + 800 * 864e5;
  };
  const walk = (v, p, depth) => {
    if (out.length >= limit) return;
    if (v !== null && typeof v === 'object') {
      if (depth >= 6) return;
      const keys = Array.isArray(v) ? v.slice(0, 3).map((_, i) => i) : Object.keys(v);
      for (const k of keys) walk(v[k], p ? `${p}.${k}` : String(k), depth + 1);
      return;
    }
    if (typeof v !== 'string' && typeof v !== 'number') return;
    let kind = null;
    if (dateLike(v)) kind = 'waktu';
    else {
      const m = toMoney(v);
      if (Number.isFinite(m) && (/harga|price|nilai|tawar|bid|limit|amount/i.test(p) || m >= 10000)) kind = 'harga';
    }
    out.push({ path: p, value: typeof v === 'string' ? v.slice(0, 80) : v, kind });
  };
  walk(json, '', 0);
  return out.sort((x, y) => (y.kind ? 1 : 0) - (x.kind ? 1 : 0));
}

const pathHint = (json) => {
  const ps = flattenPaths(json, 8).map((x) => x.path);
  return ps.length ? ` Contoh path yang ada: ${ps.join(', ')}` : '';
};

async function getState(c, signal) {
  const { json: j, res, t0, rtt } = await fetchJson(c, signal);
  const rawP = get(j, c.pricePath);
  if (rawP === undefined) throw new Error(`pricePath "${c.pricePath}" tidak ditemukan di respons.${pathHint(j)}`);
  const price = toMoney(rawP);
  if (!Number.isFinite(price)) throw new Error(`pricePath "${c.pricePath}" bukan angka (nilainya: ${JSON.stringify(rawP)})`);
  const rawE = get(j, c.endTimePath);
  if (rawE === undefined) throw new Error(`endTimePath "${c.endTimePath}" tidak ditemukan di respons.${pathHint(j)}`);
  const endTime = toMs(rawE, c.timezone);
  if (!Number.isFinite(endTime)) throw new Error(`endTimePath "${c.endTimePath}" bukan waktu yang dikenali (nilainya: ${JSON.stringify(rawE)})`);
  const serverTime = c.serverTimePath ? toMs(get(j, c.serverTimePath), c.timezone) : NaN;
  return { price, endTime, serverTime, dateHeader: res.headers.get('date'), t0, rtt };
}

// Offset (server - lokal) dan latensi. Bila API memberi waktu server (ms), pakai sampel RTT terkecil.
// Bila hanya header Date (resolusi 1 detik), pakai irisan batas dari beberapa sampel agar presisi sub-detik.
async function syncClock(c, signal, n = 8) {
  const samples = [];
  let lastErr;
  for (let i = 0; i < n; i++) {
    try {
      samples.push(await getState(c, signal));
    } catch (e) {
      if (isAbort(e)) throw e;
      lastErr = e;
    }
    if (i < n - 1) await sleepAbortable(200, signal);
  }
  if (!samples.length) throw new SniperError(`Gagal mengambil data lot: ${lastErr ? lastErr.message : 'tidak ada respons'}`);

  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  const rtt = rtts[Math.floor(rtts.length / 2)]; // median, lebih realistis daripada yang tercepat
  const last = samples[samples.length - 1];

  if (samples.every((s) => Number.isFinite(s.serverTime))) {
    const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    return { off: best.serverTime - (best.t0 + best.rtt / 2), rtt, mode: 'serverTime', state: last };
  }

  const withDate = samples.filter((s) => s.dateHeader && Number.isFinite(Date.parse(s.dateHeader)));
  if (!withDate.length) {
    throw new SniperError('Tidak ada sumber waktu server: isi serverTimePath atau pastikan server mengirim header Date');
  }
  let lo = -Infinity;
  let hi = Infinity;
  let sum = 0;
  for (const s of withDate) {
    const d = Date.parse(s.dateHeader);
    const tm = s.t0 + s.rtt / 2;
    lo = Math.max(lo, d - tm);
    hi = Math.min(hi, d + 1000 - tm);
    sum += d + 500 - tm;
  }
  const off = lo < hi ? (lo + hi) / 2 : sum / withDate.length;
  return { off, rtt, mode: lo < hi ? 'date-header(irisan)' : 'date-header(rata-rata)', state: last };
}

// ---------- strategi ----------

function computeAmount(c, price) {
  if (c.mode === 'custom') {
    if (c.customBid > c.maxBid) return { error: `customBid ${c.customBid} melebihi maxBid ${c.maxBid}` };
    if (c.customBid <= price) return { error: `customBid ${c.customBid} tidak lebih tinggi dari harga terakhir ${price}` };
    return { amount: c.customBid };
  }
  const steps = Math.min(Math.floor(c.stepsAbove), Math.floor((c.maxBid - price) / c.increment));
  if (steps < 1) return { error: `maxBid ${c.maxBid} tidak cukup untuk menaikkan dari ${price} (kelipatan ${c.increment})` };
  return { amount: Math.round(price + steps * c.increment) };
}

async function submit(c, amount, signal) {
  if (c.dryRun) return { dry: true, amount };
  const fill = (s) => s.split('{{amount}}').join(String(amount));
  const t0 = Date.now();
  const res = await fetchT(
    fill(c.bidUrl),
    { method: c.bidMethod, headers: buildHeaders(c), body: c.bidMethod === 'GET' ? undefined : fill(c.bidBody) },
    c.requestTimeoutMs,
    signal,
  );
  const body = (await res.text()).slice(0, 300);
  return { ok: res.ok, httpStatus: res.status, ms: Date.now() - t0, body };
}

// ---------- API publik ----------

// Lihat isi respons stateUrl: daftar field + tebakan jenis (harga/waktu). Untuk memilih path di UI.
async function inspectState(user, { signal } = {}) {
  const c = normalize(user);
  const errs = [];
  checkUrl('stateUrl', c.stateUrl, errs);
  if (errs.length) throw new SniperError('Konfigurasi tidak valid:\n- ' + errs.join('\n- '));
  const { json, rtt } = await fetchJson(c, signal);
  return { paths: flattenPaths(json), rttMs: rtt };
}

// Tes koneksi: ambil data lot, simulasikan bid, dan beri peringatan. Untuk tombol "Tes koneksi" di UI.
async function testConnection(user, { signal } = {}) {
  const c = normalize(user);
  const errs = stateErrors(c);
  if (errs.length) throw new SniperError('Konfigurasi tidak valid:\n- ' + errs.join('\n- '));
  const sync = await syncClock(c, signal, 4);
  const s = sync.state;
  const remainingMs = s.endTime - (Date.now() + sync.off);
  const offsetMs = Math.round(sync.off);

  const plan = validateConfig(user).errors.length ? null : computeAmount(c, s.price);
  const warnings = [];
  if (remainingMs <= 0) warnings.push('Lelang ini sudah berakhir.');
  else if (remainingMs < c.fireBeforeMs + c.refreshBeforeMs + 1000) warnings.push('Sisa waktu terlalu pendek untuk jadwal normal; bot akan langsung menembak.');
  if (Math.abs(offsetMs) > 5000) warnings.push(`Jam komputer berbeda ${(offsetMs / 1000).toFixed(1)} detik dari jam server. Aktifkan sinkron waktu Windows.`);
  if (sync.rtt > 1500) warnings.push(`Latensi ke server tinggi (${sync.rtt} ms). Pertimbangkan menaikkan "tembak sebelum tutup".`);
  if (sync.mode.startsWith('date-header')) warnings.push('Jam server diambil dari header Date (resolusi 1 detik). Isi serverTimePath bila API menyediakan jam server.');
  if (!(s.price > 0)) warnings.push('Harga terbaca 0. Pastikan pricePath menunjuk ke harga tertinggi saat ini.');
  if (plan && plan.error) warnings.push(`Simulasi bid gagal: ${plan.error}`);
  if (!plan) warnings.push('Simulasi bid dilewati karena pengaturan bid belum lengkap.');

  return {
    price: s.price, endTime: s.endTime, remainingMs, offsetMs, rttMs: sync.rtt, clockMode: sync.mode,
    plannedAmount: plan && !plan.error ? plan.amount : null, warnings,
  };
}

// Menjalankan bot sampai selesai. Mengembalikan { status: 'fired' | 'aborted' | 'ended' | 'cancelled', ... }.
async function runSniper(user, { onLog = console.log, onEvent = () => {}, signal } = {}) {
  const { config: c, errors } = validateConfig(user);
  if (errors.length) throw new SniperError('Konfigurasi tidak valid:\n- ' + errors.join('\n- '));
  const log = (...a) => onLog(`${new Date().toISOString()} ${a.join(' ')}`);

  try {
    const sync = await syncClock(c, signal);
    const { off, rtt } = sync;
    const serverNow = () => Date.now() + off;
    log(`sync: offset=${Math.round(off)}ms rtt=${rtt}ms mode=${sync.mode}${c.dryRun ? ' [DRY-RUN]' : ''}`);

    let st = sync.state;
    let fails = 0;
    let fireLocal;
    for (;;) {
      if (signal && signal.aborted) throw abortErr();
      const remaining = st.endTime - serverNow();
      if (remaining <= 0) {
        log('lelang sudah berakhir');
        return { status: 'ended' };
      }
      fireLocal = st.endTime - c.fireBeforeMs - off - rtt / 2; // kirim lebih awal sebesar latensi satu arah
      onEvent({ type: 'tick', price: st.price, remainingMs: remaining, fireInMs: fireLocal - Date.now() });
      const wait = fireLocal - c.refreshBeforeMs - Date.now();
      if (wait <= 0) break;
      log(`harga=${st.price} sisa=${(remaining / 1000).toFixed(1)}s`);
      await sleepAbortable(Math.min(wait, c.pollMs), signal);
      try {
        st = await getState(c, signal);
        fails = 0;
      } catch (e) {
        if (isAbort(e)) throw e;
        if (++fails >= 10) throw new SniperError(`Gagal mengambil data lot 10 kali berturut-turut: ${e.message}`);
        log(`peringatan: gagal ambil data lot (${e.message}), memakai data terakhir`);
      }
    }

    const plan = computeAmount(c, st.price);
    if (plan.error) {
      log('ABORT:', plan.error);
      return { status: 'aborted', reason: plan.error };
    }
    log(`siap tembak ${plan.amount} (harga terakhir ${st.price})`);
    onEvent({ type: 'armed', amount: plan.amount, fireAt: fireLocal });

    await sleepUntil(fireLocal, signal);
    if (st.endTime - serverNow() <= 0) {
      log('ABORT: waktu lelang sudah habis sebelum bid sempat dikirim');
      return { status: 'aborted', reason: 'terlambat' };
    }

    let result;
    try {
      result = await submit(c, plan.amount, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      log(`kirim gagal (${e.message}), mencoba sekali lagi`);
      if (st.endTime - serverNow() <= 300) return { status: 'aborted', reason: `kirim gagal: ${e.message}` };
      result = await submit(c, plan.amount, signal);
    }
    log('FIRE', JSON.stringify(result));
    onEvent({ type: 'fired', amount: plan.amount, result });
    return { status: 'fired', amount: plan.amount, ...result };
  } catch (e) {
    if (isAbort(e)) {
      log('dibatalkan');
      return { status: 'cancelled' };
    }
    throw e;
  }
}

module.exports = { runSniper, testConnection, inspectState, flattenPaths, validateConfig, computeAmount, syncClock, getState, toMs, toMoney, SniperError, DEFAULTS };
