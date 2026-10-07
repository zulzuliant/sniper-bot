'use strict';
// Pemakaian:
//   LELANG_COOKIE="..." node src/cli.js          jalankan bot
//   LELANG_COOKIE="..." node src/cli.js --test   tes koneksi saja (ambil harga & waktu tutup sekali)
const fs = require('node:fs');
const path = require('node:path');
const { runSniper, testConnection } = require('./core');

const file = path.join(__dirname, '..', 'config.json');
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Gagal membaca ${file}: ${e.message}`);
  process.exit(1);
}
if (process.env.LELANG_COOKIE) cfg.cookie = process.env.LELANG_COOKIE;

const ctrl = new AbortController();
process.on('SIGINT', () => {
  console.log('\nMenghentikan bot...');
  ctrl.abort();
});

(async () => {
  if (process.argv.includes('--test')) {
    const r = await testConnection(cfg, { signal: ctrl.signal });
    console.log({ ...r, endTime: new Date(r.endTime).toISOString(), remaining: `${(r.remainingMs / 1000).toFixed(1)}s` });
    return;
  }
  const r = await runSniper(cfg, { signal: ctrl.signal });
  console.log('Selesai:', r.status);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
