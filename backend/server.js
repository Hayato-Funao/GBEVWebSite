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
const IS_DUMMY    = !process.env.SITE_URL;   // 改修(SP連携マージ): Python方式ではSITE_URLで接続有無を判定
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
    // 改修(第7回追補2): キャッシュ制御ヘッダを付与してブラウザが古い JS/CSS を再利用しないようにする
    res.writeHead(200, {
      'Content-Type':  MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma':        'no-cache',
      'Expires':       '0',
    });
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
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',  // 改修(SP連携マージ): DELETE追加
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // 改修(第13回): PATCH /api/action-item/:id/status — 事務局アクションリストのステータス更新 W-5/W-12
  const actionStatusMatch = pathname.match(/^\/api\/action-item\/(\d+)\/status$/);
  if (actionStatusMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const body = await readBody(req);
      await sp.runCommand('update_action_status', [actionStatusMatch[1], body.status]);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/action-item/status:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(第13回): PATCH /api/action-item/:id/state — 事務局アクションリストの状態列更新 W-7
  const actionStateMatch = pathname.match(/^\/api\/action-item\/(\d+)\/state$/);
  if (actionStateMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const body = await readBody(req);
      await sp.runCommand('update_action_state', [actionStateMatch[1], body.state]);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/action-item/state:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(第12回): GET /api/action-item/:id — 事務局アクションリストの単一行を取得
  // 改修: idはTitle列の値（非数値・日本語も許容）。復号してPythonに渡す
  const actionItemMatch = pathname.match(/^\/api\/action-item\/([^\/]+)$/);
  if (actionItemMatch && method === 'GET') {
    if (IS_DUMMY) return jsonOk(res, { dummy: true, id: 0, category: '統合HILS利用', applicant: 'テスト太郎', machineType: '機種X' });
    try {
      const item = await sp.runCommand('get_action_item', [decodeURIComponent(actionItemMatch[1])]);
      jsonOk(res, normalizeActionItem(item));
    } catch (e) {
      console.error('GET /api/action-item:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── GET /api/reservations ──
  if (pathname === '/api/reservations' && method === 'GET') {
    if (IS_DUMMY) return jsonOk(res, DUMMY_RESERVATIONS);
    try {
      const items = await sp.getListItems();    // 改修(SP連携マージ): トークン取得はPython内部で完結
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
      const body = await readBody(req);
      const item = await sp.addListItem(null, toSpFields(body));  // 改修(SP連携マージ): トークン引数はPython橋渡し層で不使用
      jsonOk(res, { success: true, item });
    } catch (e) {
      console.error('POST /api/reservations:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── PATCH / DELETE /api/reservations/:id ──
  const idMatch = pathname.match(/^\/api\/reservations\/(\d+)$/);  // 改修(SP連携マージ): PATCHとDELETEで共用
  if (idMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const body = await readBody(req);
      await sp.updateListItem(null, idMatch[1], toSpFields(body));  // 改修(SP連携マージ): トークン引数はPython橋渡し層で不使用
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/reservations:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(SP連携マージ): DELETE /api/reservations/:id（SPからアイテムを削除する）
  if (idMatch && method === 'DELETE') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      await sp.deleteListItem(null, idMatch[1]);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('DELETE /api/reservations:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── 静的ファイル配信 ──
  serveStatic(req, res, pathname);
});

// 改修(第13回): SP列名変換を統合HILS使用履歴リストの実内部名に差替え
// field_1=設備, field_6=設備使用開始日, field_7=設備使用終了日,
// OData__x7533__x8acb__x8005__x540d_=使用者名（申請者名）, Title=ラベル（案件名）
// colorはHILS使用履歴リストに列がないため固定値（#fde68a）で返す
function normalizeSpItem(item) {
  // SharePointのDateTime列はISO形式（例: /Date(1234567890000)/またはYYYY-MM-DDTHH:mm:ssZ）で返る
  // 日付部分のみ（YYYY-MM-DD）を抽出して返す
  function extractDate(val) {
    if (!val) return '';
    // /Date(ミリ秒)/ 形式
    const msMatch = String(val).match(/\/Date\((\d+)\)\//);
    if (msMatch) {
      return new Date(parseInt(msMatch[1])).toISOString().split('T')[0];
    }
    // ISO形式
    if (String(val).includes('T')) return val.split('T')[0];
    return val;
  }
  return {
    id:      item.Id,
    machine: item.field_1                                       || '',
    start:   extractDate(item.field_6),
    end:     extractDate(item.field_7),
    label:   item.Title                                         || '',
    color:   '#fde68a',  // 使用履歴リストにcolor列なし → UI固定値
    user:    item['OData__x7533__x8acb__x8005__x540d_']         || '',
  };
}

// 改修(第12回): 事務局アクションリスト行のSP列名→フロント項目変換
function normalizeActionItem(item) {
  return {
    id:          item.Id,
    category:    item['OData__x5206__x985e_']                                                       || '',  // 分類
    applicant:   item['OData__x7533__x8acb__x8005__x540d_']                                         || '',  // 申請者名
    email:       item['OData__x7533__x8acb__x8005__x30e1__x30'] || '',  // 申請者メールアドレス（SP内部名32文字截断）
    machineType: item['OData__x6a5f__x7a2e__x547c__x79f0_']                                         || '',  // 機種呼称（ラベル生成用）
  };
}

// 改修(第13回): フロント項目→統合HILS使用履歴リストのSP列名変換
// field_1=設備, field_6=設備使用開始日(DateTime), field_7=設備使用終了日(DateTime),
// Title=ラベル（案件名）, OData__x7533__x8acb__x8005__x540d_=使用者名
// color列は存在しないため書き込まない
function toSpFields(data) {
  const f = {};
  if (data.label   !== undefined) f.Title                                      = data.label;
  if (data.machine !== undefined) f.field_1                                     = data.machine;
  // DateTime列: ISO形式（T00:00:00Z）でSharePointに渡す
  if (data.start   !== undefined) f.field_6                                     = data.start ? data.start.split('T')[0] + 'T00:00:00Z' : null;
  if (data.end     !== undefined) f.field_7                                     = data.end   ? data.end.split('T')[0]   + 'T00:00:00Z' : null;
  if (data.user    !== undefined) f['OData__x7533__x8acb__x8005__x540d_']       = data.user;
  // 改修: 使用者アドレス列（申請者メールアドレス）へ書き込み。空の場合はスキップ（編集時の意図しないブランク上書き防止）
  if (data.email) f['OData__x7533__x8acb__x8005__x30a2__x30'] = data.email;
  // color は使用履歴リストに列がないため書き込みスキップ
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
  if (IS_DUMMY) console.log('  ※ SITE_URL未設定のためダミーデータで動作中');
  else          console.log(`  SharePoint: ${process.env.SITE_URL}`);
});
