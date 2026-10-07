'use strict';
// Tes mandiri: server lelang tiruan + pemeriksaan parser, validasi, dan timing tembakan.
// Jalankan: npm test
const http = require('node:http');
const assert = require('node:assert');
const { runSniper, testConnection, inspectState, validateConfig, computeAmount, toMs, toMoney } = require('../src/core');

let pass = 0;
const ok = (name) => console.log(`  ok  ${name}`) || pass++;

function parserTests() {
  assert.strictEqual(toMoney('Rp 1.500.000,00'), 1500000);
  assert.strictEqual(toMoney('1,500,000.50'), 1500000.5);
  assert.strictEqual(toMoney('1500000'), 1500000);
  assert.strictEqual(toMoney(2500000), 2500000);
  assert.ok(Number.isNaN(toMoney('')));
  assert.ok(Number.isNaN(toMoney(null)));
  ok('toMoney: format rupiah, US, angka, kosong');

  assert.strictEqual(toMs('2026-10-05T14:00:00+07:00'), Date.parse('2026-10-05T07:00:00Z'));
  assert.strictEqual(toMs('2026-10-05 14:00:00'), Date.parse('2026-10-05T07:00:00Z'));
  assert.strictEqual(toMs('05/10/2026 14:00:00'), Date.parse('2026-10-05T07:00:00Z'));
  assert.strictEqual(toMs(1759647600), 1759647600000);
  assert.strictEqual(toMs(1759647600000), 1759647600000);
  assert.strictEqual(toMs('1759647600'), 1759647600000);
  assert.ok(Number.isNaN(toMs('bukan tanggal')));
  ok('toMs: ISO, tanpa zona (WIB), DD/MM/YYYY, epoch detik/ms');
}

function configTests() {
  const empty = validateConfig({});
  assert.ok(empty.errors.length >= 5);
  const good = validateConfig({
    stateUrl: 'https://x.test/s', pricePath: 'a', endTimePath: 'b',
    bidUrl: 'https://x.test/b', bidBody: '{"n":{{amount}}}', maxBid: '2.000.000', increment: '50.000',
  });
  assert.deepStrictEqual(good.errors, []);
  assert.strictEqual(good.config.maxBid, 2000000);
  assert.strictEqual(good.config.dryRun, true);
  const noPlaceholder = validateConfig({ ...good.config, bidBody: '{"n":1}' });
  assert.ok(noPlaceholder.errors.some((e) => e.includes('{{amount}}')));
  ok('validateConfig: kosong ditolak, angka berformat rupiah diterima, penanda {{amount}} wajib');

  const c = good.config;
  assert.strictEqual(computeAmount(c, 1000000).amount, 1050000);
  assert.strictEqual(computeAmount({ ...c, stepsAbove: 3 }, 1000000).amount, 1150000);
  assert.strictEqual(computeAmount({ ...c, stepsAbove: 99 }, 1950000).amount, 2000000);
  assert.ok(computeAmount(c, 1990000).error);
  assert.ok(computeAmount({ ...c, mode: 'custom', customBid: 900000 }, 1000000).error);
  ok('computeAmount: kelipatan, dibatasi maxBid, batal bila tak cukup');
}

function startMock({ endMs, price }) {
  const bids = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/state') {
      const wib = new Date(endMs + 7 * 3600e3).toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
      const [y, m, d] = wib.slice(0, 10).split('-');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: { harga: `Rp ${price.toLocaleString('id-ID')}`, selesai: `${d}/${m}/${y} ${wib.slice(11, 19)}` } }));
    } else if (req.url === '/bid' && req.method === 'POST') {
      let body = '';
      req.on('data', (x) => (body += x));
      req.on('end', () => {
        bids.push({ at: Date.now(), body: JSON.parse(body), cookie: req.headers.cookie });
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, bids, base: `http://127.0.0.1:${server.address().port}` })));
}

const cfgFor = (base, extra = {}) => ({
  dryRun: false, stateUrl: `${base}/state`, pricePath: 'data.harga', endTimePath: 'data.selesai',
  bidUrl: `${base}/bid`, bidBody: '{"nilai":{{amount}}}', increment: 50000, maxBid: 2000000,
  cookie: 'sid=abc', pollMs: 1000, ...extra,
});

async function mainTests() {
  // 1. tembak normal: harus mendarat sekitar T-2,5 detik
  const endMs = Math.floor((Date.now() + 9000) / 1000) * 1000;
  const m = await startMock({ endMs, price: 1000000 });
  const conn = await testConnection(cfgFor(m.base));
  assert.strictEqual(conn.price, 1000000);
  assert.strictEqual(conn.endTime, endMs);
  ok('testConnection: harga "Rp 1.000.000" dan waktu "DD/MM/YYYY" WIB terbaca benar');

  const logs = [];
  const r = await runSniper(cfgFor(m.base), { onLog: (l) => logs.push(l) });
  assert.strictEqual(r.status, 'fired');
  assert.strictEqual(m.bids.length, 1);
  assert.strictEqual(m.bids[0].body.nilai, 1050000);
  assert.strictEqual(m.bids[0].cookie, 'sid=abc');
  const early = endMs - m.bids[0].at;
  console.log(`      bid tiba ${early} ms sebelum tutup (target 2500)`);
  assert.ok(early > 1900 && early < 3100, `timing meleset: ${early} ms`);
  ok('runSniper: bid 1.050.000 terkirim dengan cookie, timing sesuai target');
  m.server.close();

  // 2. dry-run tidak boleh mengirim apa pun
  const endMs2 = Math.floor((Date.now() + 7000) / 1000) * 1000;
  const m2 = await startMock({ endMs: endMs2, price: 1000000 });
  const r2 = await runSniper(cfgFor(m2.base, { dryRun: true }), { onLog: () => {} });
  assert.strictEqual(r2.status, 'fired');
  assert.strictEqual(r2.dry, true);
  assert.strictEqual(m2.bids.length, 0);
  ok('dry-run: tidak ada request bid yang keluar');

  // 3. maxBid tidak cukup -> batal
  const m3 = await startMock({ endMs: Math.floor((Date.now() + 7000) / 1000) * 1000, price: 1990000 });
  const r3 = await runSniper(cfgFor(m3.base), { onLog: () => {} });
  assert.strictEqual(r3.status, 'aborted');
  assert.strictEqual(m3.bids.length, 0);
  ok('maxBid tidak cukup: bot batal, tidak menembak');

  // 4. lelang sudah berakhir
  const m4 = await startMock({ endMs: Math.floor((Date.now() - 5000) / 1000) * 1000, price: 1000000 });
  const r4 = await runSniper(cfgFor(m4.base), { onLog: () => {} });
  assert.strictEqual(r4.status, 'ended');
  assert.strictEqual(m4.bids.length, 0);
  ok('lelang sudah berakhir: tidak menembak');

  // 5. tombol Stop
  const m5 = await startMock({ endMs: Math.floor((Date.now() + 60000) / 1000) * 1000, price: 1000000 });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 1500);
  const t0 = Date.now();
  const r5 = await runSniper(cfgFor(m5.base), { onLog: () => {}, signal: ctrl.signal });
  assert.strictEqual(r5.status, 'cancelled');
  assert.ok(Date.now() - t0 < 4000);
  assert.strictEqual(m5.bids.length, 0);
  ok('Stop: bot berhenti cepat dan tidak mengirim bid');

  // 6. server mati / URL salah -> error jelas, bukan crash
  await assert.rejects(() => runSniper(cfgFor('http://127.0.0.1:1'), { onLog: () => {} }), /Gagal mengambil data lot/);
  await assert.rejects(() => runSniper({}), /Konfigurasi tidak valid/);
  ok('server mati / config kosong: error yang jelas');

  for (const x of [m2, m3, m4, m5]) x.server.close();
}

async function inspectTests() {
  const m = await startMock({ endMs: Math.floor((Date.now() + 3000) / 1000) * 1000, price: 1000000 });
  const r = await inspectState(cfgFor(m.base));
  const harga = r.paths.find((x) => x.path === 'data.harga');
  const waktu = r.paths.find((x) => x.path === 'data.selesai');
  assert.strictEqual(harga.kind, 'harga');
  assert.strictEqual(waktu.kind, 'waktu');
  ok('inspectState: field harga dan waktu tutup terdeteksi otomatis');

  await assert.rejects(() => testConnection(cfgFor(m.base, { pricePath: 'data.salah' })), /tidak ditemukan.*Contoh path yang ada: .*data\.harga/);
  await assert.rejects(() => testConnection(cfgFor(m.base, { pricePath: 'data.selesai' })), /bukan angka/);
  ok('path salah: pesan error menyebut contoh path yang ada');

  const t = await testConnection(cfgFor(m.base));
  assert.strictEqual(t.plannedAmount, 1050000);
  assert.ok(t.warnings.some((w) => w.includes('Sisa waktu terlalu pendek')));
  const t2 = await testConnection(cfgFor(m.base, { maxBid: 1020000 }));
  assert.strictEqual(t2.plannedAmount, null);
  assert.ok(t2.warnings.some((w) => w.startsWith('Simulasi bid gagal')));
  const t3 = await testConnection({ ...cfgFor(m.base), bidUrl: '', maxBid: '' });
  assert.ok(t3.warnings.some((w) => w.includes('dilewati')));
  ok('testConnection: simulasi bid + peringatan (waktu pendek, maxBid kurang, config belum lengkap)');
  m.server.close();
}

(async () => {
  parserTests();
  configTests();
  await mainTests();
  await inspectTests();
  console.log(`\n${pass} kelompok tes lulus`);
})().catch((e) => {
  console.error('\nGAGAL:', e.message);
  process.exit(1);
});
