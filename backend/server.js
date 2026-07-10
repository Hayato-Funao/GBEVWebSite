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

// 改修(起動連携): 凡例色リストCSVのパスと行数上限を設定
// 本番環境ではサーバーPC上の絶対パスを LEGEND_CSV_PATH に指定すること
const CSV_PATH     = process.env.LEGEND_CSV_PATH || path.join(__dirname, '../凡例色リスト.csv');
const CSV_MAX_ROWS = parseInt(process.env.LEGEND_CSV_MAX || '500', 10);

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

  // 改修(第14回): PATCH /api/action-item/:id/accept — 事務局アクションリストの承知/辞退列を更新 W-9
  const acceptMatch = pathname.match(/^\/api\/action-item\/(\d+)\/accept$/);
  if (acceptMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const { acceptStatus } = await readBody(req);  // '承知' or '辞退'
      await sp.runCommand('update_action_accept', [acceptMatch[1], acceptStatus]);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/action-item/accept:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(第14回): PATCH /api/action-item/:id/extend — 期間変更申請データをSPに記録 W-10
  const extendMatch = pathname.match(/^\/api\/action-item\/(\d+)\/extend$/);
  if (extendMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const { newEnd, reason, newStart } = await readBody(req);
      await sp.runCommand('update_action_extend', [extendMatch[1], newEnd, reason, newStart || '']);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/action-item/extend:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(第14回): POST /api/mail — Graph API /me/sendMail 経由でメール送信
  if (pathname === '/api/mail' && method === 'POST') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const { to, subject, body } = await readBody(req);
      await sp.runCommand('send_mail', [to, subject, body]);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('POST /api/mail:', e.message);
      jsonErr(res, 500, e.message);
    }
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

  // 改修(起動連携): GET /api/legend-colors — 凡例色リストCSVを配列として返す
  if (pathname === '/api/legend-colors' && method === 'GET') {
    try {
      jsonOk(res, parseLegendCsv());
    } catch (e) {
      console.error('GET /api/legend-colors:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(起動連携): POST /api/legend-colors — 凡例色リストCSVに行を追記/上書き
  if (pathname === '/api/legend-colors' && method === 'POST') {
    try {
      const body = await readBody(req);
      appendLegendCsv(body);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('POST /api/legend-colors:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(起動連携): DELETE /api/legend-colors?machine=&start=&end= — 凡例色リストCSVの該当行を削除
  if (pathname === '/api/legend-colors' && method === 'DELETE') {
    try {
      const machine = urlObj.searchParams.get('machine') || '';
      const start   = urlObj.searchParams.get('start')   || '';
      const end     = urlObj.searchParams.get('end')     || '';
      deleteLegendCsv(machine, start, end);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('DELETE /api/legend-colors:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // ── 静的ファイル配信 ──
  serveStatic(req, res, pathname);
});

// ────────────────────────────────────────────
// 改修(起動連携): 凡例色リストCSV ヘルパー
// CSVスキーマ（11列）:
//   タイトル,StartDate,EndDate,ProjectName,Color,BorrowerName,
//   ApplicantName,Status,LegendId,Remark,Marks
// 突合キー: タイトル(machine) + StartDate(start) + EndDate(end)
// ────────────────────────────────────────────

const CSV_HEADERS = [
  'タイトル', 'StartDate', 'EndDate', 'ProjectName', 'Color', 'BorrowerName',
  'ApplicantName', 'Status', 'LegendId', 'Remark', 'Marks',
];

// 日付変換: YYYY/MM/DD → YYYY-MM-DD（ISO）
function csvDateToIso(s) {
  if (!s) return '';
  return s.replace(/\//g, '-');
}
// 日付変換: YYYY-MM-DD（ISO） → YYYY/MM/DD
function isoDateToCsv(s) {
  if (!s) return '';
  return s.split('T')[0].replace(/-/g, '/');
}
// CSV値のクォート除去（"foo" → foo、内部の"" → "）
function unquote(s) {
  if (!s) return '';
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}
// CSV値をクォート付き文字列に変換（" → ""）
function quoteVal(v) {
  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
}
// 1行のCSV文字列を値配列に分割（カンマ区切り・クォート対応）
function splitCsvLine(line) {
  const vals = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { vals.push(cur); cur = ''; }
      else cur += c;
    }
  }
  vals.push(cur);
  return vals;
}

// CSVを読み込み行オブジェクト配列を返す（ファイル無しは []）
function parseLegendCsv() {
  let raw;
  try {
    raw = fs.readFileSync(CSV_PATH, 'utf8');
  } catch (_) {
    return [];
  }
  // 改修(文字コード): UTF-8 BOM（U+FEFF）が付いている場合は除去してから分割
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 1) return [];
  // ヘッダ行はスキップ
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    const machine    = unquote(vals[0] || '');
    const startRaw   = unquote(vals[1] || '');
    const endRaw     = unquote(vals[2] || '');
    const project    = unquote(vals[3] || '');
    const color      = unquote(vals[4] || '');
    const borrower   = unquote(vals[5] || '');
    const applicant  = unquote(vals[6] || '');
    const status     = unquote(vals[7] || '') || 'normal';
    const legendId   = unquote(vals[8] || '');
    const remark     = unquote(vals[9] || '');
    let   marks      = [];
    try { marks = JSON.parse(unquote(vals[10] || '') || '[]'); } catch (_) {}
    result.push({
      machine,
      start:     csvDateToIso(startRaw),
      end:       csvDateToIso(endRaw),
      project,
      color,
      borrower,
      applicant,
      status,
      legendId,
      remark,
      marks,
    });
  }
  return result;
}

// 行オブジェクト配列をCSVファイルに書き戻す
function writeLegendCsv(rows) {
  const headerLine = CSV_HEADERS.map(quoteVal).join(',');
  const dataLines  = rows.map(r => [
    quoteVal(r.machine   || ''),
    quoteVal(isoDateToCsv(r.start   || '')),
    quoteVal(isoDateToCsv(r.end     || '')),
    quoteVal(r.project   || ''),
    quoteVal(r.color     || ''),
    quoteVal(r.borrower  || ''),
    quoteVal(r.applicant || ''),
    quoteVal(r.status    || 'normal'),
    quoteVal(r.legendId  || ''),
    quoteVal(r.remark    || ''),
    quoteVal(JSON.stringify(r.marks || [])),
  ].join(','));
  // 改修(文字コード): UTF-8 BOMを先頭に付与（日本語Windowsのアプリが文字化けしないよう）
  const bom = '﻿';
  fs.writeFileSync(CSV_PATH, bom + [headerLine, ...dataLines].join('\r\n') + '\r\n', 'utf8');
}

// 突合キーを生成（machine|start|end）
function csvKey(machine, start, end) {
  return `${machine}|${(start || '').split('T')[0]}|${(end || '').split('T')[0]}`;
}

// 同一 machine+start+end があれば上書き、無ければ追記。満杯時は先頭行を削除
function appendLegendCsv(row) {
  const rows = parseLegendCsv();
  const key  = csvKey(row.machine, row.start, row.end);
  const idx  = rows.findIndex(r => csvKey(r.machine, r.start, r.end) === key);
  const newRow = {
    machine:   row.machine   || '',
    start:     (row.start    || '').split('T')[0],
    end:       (row.end      || '').split('T')[0],
    project:   row.project   || '',
    color:     row.color     || '#fde68a',
    borrower:  row.borrower  || '',
    applicant: row.applicant || '',
    status:    row.status    || 'normal',
    legendId:  row.legendId  || '',
    remark:    row.remark    || '',
    marks:     Array.isArray(row.marks) ? row.marks : [],
  };
  if (idx >= 0) {
    rows[idx] = newRow;  // 上書き
  } else {
    rows.push(newRow);   // 追記
    // 行数上限を超えた場合は古い先頭行から削除
    while (rows.length > CSV_MAX_ROWS) rows.shift();
  }
  writeLegendCsv(rows);
}

// 同一 machine+start+end の行を削除して書き戻す（該当無しは何もしない）
function deleteLegendCsv(machine, start, end) {
  const rows    = parseLegendCsv();
  const key     = csvKey(machine, start, end);
  const filtered = rows.filter(r => csvKey(r.machine, r.start, r.end) !== key);
  if (filtered.length !== rows.length) {
    writeLegendCsv(filtered);
  }
}

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
    color:    '#fde68a',  // 使用履歴リストにcolor列なし → UI固定値
    user:     item['OData__x7533__x8acb__x8005__x540d_']        || '',
    // 改修: 使用履歴リストに新規追加された借用者名列を取得（承知/辞退ページで表示）
    borrower: item['OData__x501f__x7528__x8005__x540d_']        || '',
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
