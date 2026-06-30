'use strict';
// 外部パッケージ不要 - Node.js 標準ライブラリのみ使用
const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── .env 手動読み込み ──
function loadEnv() {
  try {
    fs.readFileSync(path.join(__dirname, '../.env'), 'utf8')
      .split('\n')
      .forEach(line => {
        const m = line.match(/^([^#=\s][^=]*)=(.*)/);
        if (m) process.env[m[1].trim()] = m[2].trim();
      });
  } catch (_) {}
}
loadEnv();

const PORT        = parseInt(process.env.PORT || '3000');
const IS_DUMMY    = !process.env.TENANT_ID;
const FRONTEND    = path.join(__dirname, '../frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── ヘルパー ──
function jsonOk(res, data) {
  const body = JSON.stringify(data);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonErr(res, status, message) {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = path.join(FRONTEND, safePath);

  // パストラバーサル防止
  if (!filePath.startsWith(FRONTEND)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not Found'); }
      else { res.writeHead(500); res.end('Server Error'); }
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── SharePoint クライアント（ダミー時は使わない）──
let sp;
if (!IS_DUMMY) {
  sp = require('./sp_client');
}

// ── HTTPサーバー ──
const server = http.createServer(async (req, res) => {
  const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;
  const method   = req.method;

  // CORS プリフライト
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── GET /api/reservations ──
  if (pathname === '/api/reservations' && method === 'GET') {
    if (IS_DUMMY) return jsonOk(res, DUMMY_RESERVATIONS);
    try {
      const token = await sp.getAppToken();
      const items = await sp.getListItems(token);
      jsonOk(res, items.map(normalizeSpItem));
    } catch (e) {
      console.error('GET /api/reservations:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── POST /api/reservations ──
  if (pathname === '/api/reservations' && method === 'POST') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const body  = await readBody(req);
      const token = await sp.getAppToken();
      const item  = await sp.addListItem(token, toSpFields(body));
      jsonOk(res, { success: true, item });
    } catch (e) {
      console.error('POST /api/reservations:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── PATCH /api/reservations/:id ──
  const patchMatch = pathname.match(/^\/api\/reservations\/(\d+)$/);
  if (patchMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const body  = await readBody(req);
      const token = await sp.getAppToken();
      await sp.updateListItem(token, patchMatch[1], toSpFields(body));
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/reservations:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── 静的ファイル配信 ──
  serveStatic(req, res, pathname);
});

// ── SP列名変換（実際のSPリスト列名に合わせて調整）──
function normalizeSpItem(item) {
  return {
    id:      item.Id,
    machine: item.Title        || '',
    start:   item.StartDate    || '',
    end:     item.EndDate      || '',
    label:   item.ProjectName  || '',
    color:   item.Color        || '#fde68a',
    user:    item.BorrowerName || '',
  };
}

function toSpFields(data) {
  const f = {};
  if (data.machine !== undefined) f.Title        = data.machine;
  if (data.start   !== undefined) f.StartDate    = data.start;
  if (data.end     !== undefined) f.EndDate      = data.end;
  if (data.label   !== undefined) f.ProjectName  = data.label;
  if (data.color   !== undefined) f.Color        = data.color;
  if (data.user    !== undefined) f.BorrowerName = data.user;
  return f;
}

// ── ダミーデータ（筐体A〜T 表記）──
const DUMMY_RESERVATIONS = [
  { id: 1, machine: '筐体C', start: '2026-06-01', end: '2026-06-05', label: '3YW 国内開発', legendId: 'leg4', color: '#00B050', user: '' },
  { id: 2, machine: '筐体C', start: '2026-06-09', end: '2026-06-09', label: 'A-XPX',        legendId: 'leg1', color: '#8DB4E2', user: '' },
  { id: 3, machine: '筐体H', start: '2026-06-01', end: '2026-07-04', label: '202605_006',   legendId: 'leg3', color: '#92D050', user: '' },
  { id: 4, machine: '筐体S', start: '2026-06-14', end: '2026-06-18', label: 'BATTテスト',   legendId: 'leg4', color: '#00B050', user: '' },
  { id: 5, machine: '筐体A', start: '2026-06-10', end: '2026-06-15', label: 'Gen4開発',     legendId: 'leg3', color: '#92D050', user: '' },
  { id: 6, machine: '筐体E', start: '2026-06-07', end: '2026-06-12', label: 'EDR-XPX',      legendId: 'leg1', color: '#8DB4E2', user: '' },
  { id: 7, machine: '筐体L', start: '2026-05-20', end: '2026-07-10', label: '長期貸出',     legendId: 'leg5', color: '#FFC000', user: '' },
  { id: 8, machine: '筐体P', start: '2026-06-20', end: '2026-06-25', label: 'XPX-FI',       legendId: 'leg2', color: '#E63283', user: '' },
];

server.listen(PORT, () => {
  console.log(`HILS予約Webアプリ起動: http://localhost:${PORT}`);
  if (IS_DUMMY) console.log('  ※ .env未設定のためダミーデータで動作中');
});
