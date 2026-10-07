'use strict';
// Web lokal: node src/server.js  -> buka http://localhost:3210
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { runSniper, testConnection, inspectState, validateConfig } = require('./core');

const PORT = Number(process.env.PORT) || 3210;
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const INDEX = path.join(__dirname, '..', 'public', 'index.html');

let run = null; // { ctrl }
let history = [];
const clients = new Set();

function push(type, data = {}) {
  if (type === 'log') {
    history.push({ type, ...data });
    if (history.length > 300) history.shift();
  }
  const line = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const r of clients) r.write(line);
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((ok, no) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 1e6) {
        req.destroy();
        no(new Error('Body terlalu besar'));
      }
    });
    req.on('end', () => {
      try {
        ok(d ? JSON.parse(d) : {});
      } catch {
        no(new Error('JSON tidak valid'));
      }
    });
  });

const server = http.createServer(async (req, res) => {
  // Tolak akses dari host/origin lain (anti DNS-rebinding & CSRF dari situs lain)
  if (!HOSTS.includes(req.headers.host)) return send(res, 403, { error: 'Host tidak diizinkan' });
  if (req.headers.origin && !HOSTS.some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, { error: 'Origin tidak diizinkan' });

  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(INDEX));
    }
    if (req.method === 'GET' && req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'state', running: !!run })}\n\n`);
      for (const h of history) res.write(`data: ${JSON.stringify(h)}\n\n`);
      clients.add(res);
      return req.on('close', () => clients.delete(res));
    }
    if (req.method === 'POST' && req.url === '/api/test') {
      const { config } = await readBody(req);
      return send(res, 200, await testConnection(config || {}));
    }
    if (req.method === 'POST' && req.url === '/api/inspect') {
      const { config } = await readBody(req);
      return send(res, 200, await inspectState(config || {}));
    }
    if (req.method === 'POST' && req.url === '/api/start') {
      if (run) return send(res, 409, { error: 'Bot sedang berjalan' });
      const { config } = await readBody(req);
      const { errors } = validateConfig(config || {});
      if (errors.length) return send(res, 400, { errors });
      history = [];
      const ctrl = new AbortController();
      run = { ctrl };
      push('state', { running: true });
      runSniper(config, { signal: ctrl.signal, onLog: (line) => push('log', { line }), onEvent: (event) => push('event', { event }) })
        .then(
          (result) => push('done', { result }),
          (e) => {
            push('log', { line: `ERROR ${e.message}` });
            push('done', { result: { status: 'error', message: e.message } });
          },
        )
        .finally(() => {
          run = null;
          push('state', { running: false });
        });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/stop') {
      if (run) run.ctrl.abort();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'Tidak ditemukan' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Sniper bot siap: http://localhost:${PORT}`));
process.on('SIGINT', () => {
  if (run) run.ctrl.abort();
  process.exit(0);
});
