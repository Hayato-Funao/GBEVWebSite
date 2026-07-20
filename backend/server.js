'use strict';
// 外部パッケージ不要 - Node.js 標準ライブラリのみ使用
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline'); // 改修: 起動時コンソール入力でメール宛先/CCを設定するため使用

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

// 改修(CSV集約): CSVファイルが増えクラッタ化したため、全CSVを CSVデータ\ フォルダへ集約する
// 本番環境ではサーバーPC上の絶対パスを各 *_PATH / *_DIR 環境変数に指定すること
const CSV_DATA_DIR = path.join(__dirname, '../CSVデータ');

// 改修(起動連携): 凡例色リストCSVのパスと行数上限を設定
const CSV_PATH     = process.env.LEGEND_CSV_PATH || path.join(CSV_DATA_DIR, '凡例色リスト.csv');
const CSV_MAX_ROWS = parseInt(process.env.LEGEND_CSV_MAX || '500', 10);

// 改修(状態分離): 予備日/設備故障を記録する状態リストCSVのパス（休日はHOLIDAY_CSV_PATHへ分離済み）
// 通常予約は凡例色リストCSV、非通常（予備日/設備故障）は本CSVに分離して記録する
const STATUS_CSV_PATH = process.env.STATUS_CSV_PATH || path.join(CSV_DATA_DIR, '状態リスト.csv');

// 改修(筐体マスタ共通化): 筐体マスタCSV（ルーム別）を格納するディレクトリ
const MACHINE_CSV_DIR   = process.env.MACHINE_CSV_DIR || path.join(CSV_DATA_DIR, '筐体マスタ');
// ルーム名 → CSVファイル名の対応表（許可ルームをここで固定し、パストラバーサルを防止）
const MACHINE_CSV_FILES = { west: '筐体一覧_west.csv', south: '筐体一覧_south.csv' };

// 改修(凡例共通化): 凡例マスタCSV（全ルーム共通・単一ファイル）のパス
const LEGEND_MASTER_PATH = process.env.LEGEND_MASTER_PATH || path.join(CSV_DATA_DIR, '凡例マスタ.csv');

// 改修(休日設定): 休日リストCSV（全ルーム共通・単一ファイル・日付のみ）のパス
// 休日は筐体に依存しないため凡例マスタと同じ「配列全置換」方式で管理する
const HOLIDAY_CSV_PATH = process.env.HOLIDAY_CSV_PATH || path.join(CSV_DATA_DIR, '休日リスト.csv');

// 改修(マニュアルHTTP配信): マニュアルPDFの配信元ディレクトリ
// 本番はWebアプリ階層が無くbackendの一つ上が直接マニュアル\のため既定値でそのまま正しい
const MANUAL_DIR = process.env.MANUAL_DIR || path.join(__dirname, '../マニュアル');

// 改修: メール宛先/CC設定 ── 開発者が起動時にコンソールから事務局宛先(To)・各CCを入力できるようにする。
// Node(フロント発メール)とPythonバッチ(hils_alert.py)の両方から参照するため、専用JSONファイルへ永続化する。
const MAIL_CONFIG_PATH    = path.join(__dirname, 'mail_config.json');
const MAIL_CONFIG_DEFAULT = {
  pmoTo:   'hayato_funao_gst@jp.honda', // 事務局宛メールの宛先（複数可・カンマ区切り）
  pmoCc:   '', // 事務局宛メールのCC（複数可・カンマ区切り）
  userCc:  '', // ユーザー宛メールのCC（複数可・カンマ区切り）
  alertCc: '', // アラートメール（利用終了前日案内）のCC（複数可・カンマ区切り）
};

// メール設定をファイルから読み込む（存在しない/壊れている場合は既定値を使用）
function loadMailConfig() {
  try {
    const raw = fs.readFileSync(MAIL_CONFIG_PATH, 'utf8');
    return { ...MAIL_CONFIG_DEFAULT, ...JSON.parse(raw) };
  } catch (_) {
    return { ...MAIL_CONFIG_DEFAULT };
  }
}

// メール設定をファイルへ保存
function saveMailConfig(cfg) {
  fs.writeFileSync(MAIL_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

let mailConfig = loadMailConfig();

// 改修: サーバ起動時にコンソールで宛先/CCを入力させる。
// 宛先(To)は必須項目のため「空欄Enter=現状維持」とするが、CCは「未設定（CCなし）」も正当な状態のため
// 「空欄Enter=CCなしとして確定（現状の値があっても上書きでクリアされる）」とし、Toとは挙動を分ける。
// 改修(再修正): 当初は非TTY判定(process.stdin.isTTY)でタスクスケジューラ実行時をスキップする方式だったが、
// Windowsタスクスケジューラの「ログオン有無に関わらず実行」では、コンソールサブシステムのプロセスに
// 非表示コンソールが割り当てられ isTTY が例外を投げずに true と評価される場合があることが実機で判明した。
// この場合 rl.question() が誰も入力できない非表示コンソールで永久に応答待ちとなり、schtasks側からは
// 「0x800710E0（入力待ちで一時停止）」として観測され、サイトが起動しない不具合を起こした。
// isTTYへの依存自体をやめ、環境変数 HILS_MAIL_PROMPT=1 が明示的に設定されている場合のみプロンプトを
// 表示する方式に変更する（既定は常にスキップ）。手動起動用の 起動.bat / 開発起動.bat では本変数を
// セットして従来の対話UXを維持し、_daemon.bat（タスクスケジューラ経由）は未設定のため常にスキップされる。
function promptMailConfig() {
  return new Promise(resolve => {
    if (process.env.HILS_MAIL_PROMPT !== '1') {
      console.log('（HILS_MAIL_PROMPT未設定のためメール宛先/CC設定プロンプトをスキップします）');
      return resolve();
    }
    // 改修(不具合修正): 上記フラグが立っている場合でも、process.stdinへの初回アクセス自体
    // （.isTTY参照やreadline初期化）が環境によって例外(EBADF等)を投げることがあるため、
    // 念のためtry/catchで保護し、例外時は非対話とみなして安全にスキップする（起動を絶対に止めない）。
    let isInteractive = false;
    try {
      isInteractive = !!process.stdin.isTTY;
    } catch (_) {
      isInteractive = false; // stdinハンドルが存在しない実行環境では例外になり得るため非対話とみなす
    }
    if (!isInteractive) {
      console.log('（コンソールが検出できないためメール宛先/CC設定プロンプトをスキップします）');
      return resolve();
    }
    try {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      // 第3要素isCc: true=CC項目（空欄でCCなしを確定）、false=宛先(To)項目（空欄で現状維持）
      const items = [
        ['pmoTo',   '事務局宛メールの宛先(To)',                  false],
        ['pmoCc',   '事務局宛メールのCC',                        true],
        ['userCc',  'ユーザー宛メールのCC',                      true],
        ['alertCc', 'アラートメール（利用終了前日案内）のCC',    true],
      ];
      const ask = i => {
        if (i >= items.length) {
          rl.close();
          saveMailConfig(mailConfig);
          return resolve();
        }
        const [key, label, isCc] = items[i];
        const hint = isCc ? '複数可・カンマ区切り／空欄でCCなし' : '複数可・カンマ区切り／空欄で現状維持';
        rl.question(
          `${label} [現在値: ${mailConfig[key] || '(未設定)'}]（${hint}）: `,
          answer => {
            const trimmed = answer.trim();
            if (isCc) {
              // CCは空欄入力をそのまま確定させる（現状値の保持ではなく「CCなし」への明示的な変更）
              mailConfig[key] = trimmed;
            } else if (trimmed) {
              mailConfig[key] = trimmed;
            }
            ask(i + 1);
          }
        );
      };
      console.log('── メール宛先/CC設定 ──');
      console.log('　宛先(To)：空欄Enterで現状維持 ／ CC：空欄Enterで「CCなし」として登録（現状維持ではない）');
      ask(0);
    } catch (e) {
      // readline初期化等で例外が起きても起動は継続する（既定値のまま起動）
      console.error('メール宛先/CC設定プロンプトの初期化に失敗しました。スキップします:', e.message);
      resolve();
    }
  });
}

const PORT        = parseInt(process.env.PORT || '3000');
const IS_DUMMY    = !process.env.SITE_URL;   // 改修(SP連携マージ): Python方式ではSITE_URLで接続有無を判定
// 改修(第16回): 本番は dist/ から配信。dist/ が存在しなければ開発用の frontend/ にフォールバック
// （現状frontendはクラシックスクリプトの静的アプリのためビルド未実施でも動作する）
const DIST        = path.join(__dirname, '../dist');
const FRONTEND    = fs.existsSync(DIST) ? DIST : path.join(__dirname, '../frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',  // 改修(マニュアルHTTP配信): マニュアルPDF配信用
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

  // 改修: PATCH /api/action-item/:id/cancel — 利用取消依頼の取消理由を事務局アクションリストへ記録
  // （期間変更申請と同様に理由のみを保存し、ステータスは変更しない。ステータス遷移は事務局の削除操作時に行う）
  const cancelMatch = pathname.match(/^\/api\/action-item\/(\d+)\/cancel$/);
  if (cancelMatch && method === 'PATCH') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const { reason } = await readBody(req);
      await sp.runCommand('update_action_cancel', [cancelMatch[1], reason || '']);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('PATCH /api/action-item/cancel:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修: GET /api/mail-config — コンソールで設定した事務局宛先(To)・CCをフロントへ配布
  // （alertCcはPythonバッチ側のみで使用するため配布対象外）
  if (pathname === '/api/mail-config' && method === 'GET') {
    return jsonOk(res, { pmoTo: mailConfig.pmoTo, pmoCc: mailConfig.pmoCc, userCc: mailConfig.userCc });
  }

  // 改修(第14回): POST /api/mail — Graph API /me/sendMail 経由でメール送信
  // 改修: CC対応のため body から cc を受け取り sp_helper.py へ渡す
  if (pathname === '/api/mail' && method === 'POST') {
    if (IS_DUMMY) return jsonOk(res, { success: true, dummy: true });
    try {
      const { to, subject, body, cc } = await readBody(req);
      await sp.runCommand('send_mail', [to, subject, body, cc || '']);
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
    // 改修: 1案件=1予約ガードの判定用にstatusを追加（ダミー時は常に登録可の初期値）
    if (IS_DUMMY) return jsonOk(res, { dummy: true, id: 0, category: '統合HILS利用', applicant: 'テスト太郎', machineType: '機種X', status: '0.仮申請受領前' });
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

  // 改修(状態分離): GET /api/status-list — 状態リストCSV（予備日/設備故障/休日）を配列として返す
  if (pathname === '/api/status-list' && method === 'GET') {
    try {
      jsonOk(res, parseLegendCsv(STATUS_CSV_PATH));
    } catch (e) {
      console.error('GET /api/status-list:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(状態分離): POST /api/status-list — 状態リストCSVに行を追記/上書き
  if (pathname === '/api/status-list' && method === 'POST') {
    try {
      const body = await readBody(req);
      appendLegendCsv(body, STATUS_CSV_PATH);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('POST /api/status-list:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(状態分離): DELETE /api/status-list?machine=&start=&end= — 状態リストCSVの該当行を削除
  if (pathname === '/api/status-list' && method === 'DELETE') {
    try {
      const machine = urlObj.searchParams.get('machine') || '';
      const start   = urlObj.searchParams.get('start')   || '';
      const end     = urlObj.searchParams.get('end')     || '';
      deleteLegendCsv(machine, start, end, STATUS_CSV_PATH);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('DELETE /api/status-list:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(筐体マスタ共通化): GET /api/machines?room=west|south — 筐体マスタCSVを返す
  if (pathname === '/api/machines' && method === 'GET') {
    const room = urlObj.searchParams.get('room') || '';
    if (!MACHINE_CSV_FILES[room]) {
      jsonErr(res, 400, `不正なroom指定: ${room}`);
      return;
    }
    try {
      let data = parseMachineCsv(room);
      if (data === null) {
        // 未初期化時: westは既定シードで新規作成、southは空で返す（南ルームはSP予約から動的生成されるため）
        data = room === 'west'
          ? { machines: DEFAULT_MACHINES.slice(), spares: DEFAULT_SPARES.slice(), assignees: {}, addresses: {} }
          : { machines: [], spares: [], assignees: {}, addresses: {} };
        writeMachineCsv(room, data);
      }
      jsonOk(res, data);
    } catch (e) {
      console.error('GET /api/machines:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(筐体マスタ共通化): POST /api/machines?room=west|south — 筐体マスタCSVをルーム単位で全置換保存
  if (pathname === '/api/machines' && method === 'POST') {
    const room = urlObj.searchParams.get('room') || '';
    if (!MACHINE_CSV_FILES[room]) {
      jsonErr(res, 400, `不正なroom指定: ${room}`);
      return;
    }
    try {
      const body = await readBody(req);
      writeMachineCsv(room, body);
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('POST /api/machines:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(凡例共通化): GET /api/legend — 凡例マスタCSVを配列で返す（全PC共通）
  // CSV未作成時は既定シード（DEFAULT_LEGEND）で新規作成する
  if (pathname === '/api/legend' && method === 'GET') {
    try {
      let data = parseLegendMaster();
      if (data === null) {
        data = DEFAULT_LEGEND.slice();
        writeLegendMaster(data);
      }
      jsonOk(res, data);
    } catch (e) {
      console.error('GET /api/legend:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(凡例共通化): POST /api/legend — 凡例マスタCSVを配列全置換で保存（全PC共通）
  if (pathname === '/api/legend' && method === 'POST') {
    try {
      const body = await readBody(req);
      writeLegendMaster(Array.isArray(body) ? body : (body.legend || []));
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('POST /api/legend:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(休日設定): GET /api/holidays — 休日リストCSVをISO日付文字列の配列で返す（全PC共通）
  // CSV未作成時は空配列を返す（凡例マスタと異なり初期シードは不要）
  if (pathname === '/api/holidays' && method === 'GET') {
    try {
      jsonOk(res, parseHolidayList());
    } catch (e) {
      console.error('GET /api/holidays:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(休日設定): POST /api/holidays — 休日リストCSVを配列全置換で保存（全PC共通）
  if (pathname === '/api/holidays' && method === 'POST') {
    try {
      const body = await readBody(req);
      writeHolidayList(Array.isArray(body) ? body : (body.holidays || []));
      jsonOk(res, { success: true });
    } catch (e) {
      console.error('POST /api/holidays:', e.message);
      jsonErr(res, 500, e.message);
    }
    return;
  }

  // 改修(マニュアルHTTP配信): マニュアルPDFをアプリ自身から配信する。
  // SharePointリンクはアクセス権次第で閲覧できない場合があるため、PDF実体(アプリルート直下の マニュアル\ に
  // 手動配置済み)を同一ホストから返す。serveStatic は FRONTEND(frontend/またはdist/) 配下限定のため専用処理とする。
  // pathname はURL仕様上パーセントエンコードされているため、日本語パスの比較にはデコードが必要
  if (decodeURIComponent(pathname).startsWith('/マニュアル/') && method === 'GET') {
    const relPath  = decodeURIComponent(pathname).replace(/^\/マニュアル\//, '');
    const filePath = path.join(MANUAL_DIR, relPath);
    // パストラバーサル防止
    if (!filePath.startsWith(MANUAL_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not Found'); }
        else { res.writeHead(500); res.end('Server Error'); }
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.pdf'] });
      res.end(data);
    });
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
// 改修(状態分離): 凡例色リスト/状態リストの両CSVで共用するため、パスを引数化
function parseLegendCsv(csvPath = CSV_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(csvPath, 'utf8');
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
// 改修(状態分離): パスを引数化（凡例色リスト/状態リスト共用）
function writeLegendCsv(rows, csvPath = CSV_PATH) {
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
  fs.writeFileSync(csvPath, bom + [headerLine, ...dataLines].join('\r\n') + '\r\n', 'utf8');
}

// 突合キーを生成（machine|start|end）
function csvKey(machine, start, end) {
  return `${machine}|${(start || '').split('T')[0]}|${(end || '').split('T')[0]}`;
}

// 同一 machine+start+end があれば上書き、無ければ追記。満杯時は先頭行を削除
// 改修(状態分離): パスを引数化（凡例色リスト/状態リスト共用）
function appendLegendCsv(row, csvPath = CSV_PATH) {
  const rows = parseLegendCsv(csvPath);
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
  writeLegendCsv(rows, csvPath);
}

// 同一 machine+start+end の行を削除して書き戻す（該当無しは何もしない）
// 改修(状態分離): パスを引数化（凡例色リスト/状態リスト共用）
function deleteLegendCsv(machine, start, end, csvPath = CSV_PATH) {
  const rows    = parseLegendCsv(csvPath);
  const key     = csvKey(machine, start, end);
  const filtered = rows.filter(r => csvKey(r.machine, r.start, r.end) !== key);
  if (filtered.length !== rows.length) {
    writeLegendCsv(filtered, csvPath);
  }
}

// ────────────────────────────────────────────
// 改修(筐体マスタ共通化): 筐体マスタCSV ヘルパー（ルーム別、west/southで別ファイル）
// CSVスキーマ（4列）: 種別(machine|spare), 筐体名, 担当者, 表示順
// 表示順は保存時に0始まりで振り直し、グリッドの行順（機種→予備の並び）を保持する
// ────────────────────────────────────────────

// メイン筐体の既定シード（筐体A〜筐体T）。西ルーム初回起動時にのみ使用
const DEFAULT_MACHINES = [...'ABCDEFGHIJKLMNOPQRST'.split('').map(c => '筐体' + c)];
// 予備の既定シード
const DEFAULT_SPARES = ['予備1', '予備2'];

// ルーム名からCSVパスを生成する（未対応のルームはnullを返す）
function machineCsvPath(room) {
  const file = MACHINE_CSV_FILES[room];
  if (!file) return null;
  return path.join(MACHINE_CSV_DIR, file);
}

// 筐体マスタCSVを読み込み { machines, spares, assignees } を返す
// ファイルが存在しない場合はnullを返す（呼び出し側で初期シード投入の判断に使う）
function parseMachineCsv(room) {
  const csvPath = machineCsvPath(room);
  if (!csvPath) return null;
  let raw;
  try {
    raw = fs.readFileSync(csvPath, 'utf8');
  } catch (_) {
    return null;
  }
  // UTF-8 BOM（U+FEFF）を除去してから分割
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 1) return { machines: [], spares: [], assignees: {}, addresses: {} };
  // 改修: アドレス列追加（5列: 種別,筐体名,担当者,アドレス,表示順）に伴い、
  // 旧形式（4列: 種別,筐体名,担当者,表示順）との後方互換をヘッダ列数で判定する
  const headerCols     = splitCsvLine(lines[0]).length;
  const hasAddressCol  = headerCols >= 5;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    rows.push(hasAddressCol ? {
      type:     unquote(vals[0] || ''),
      name:     unquote(vals[1] || ''),
      assignee: unquote(vals[2] || ''),
      address:  unquote(vals[3] || ''),
      order:    parseInt(unquote(vals[4] || '0'), 10) || 0,
    } : {
      type:     unquote(vals[0] || ''),
      name:     unquote(vals[1] || ''),
      assignee: unquote(vals[2] || ''),
      address:  '',  // 旧形式はアドレス列を持たないため空
      order:    parseInt(unquote(vals[3] || '0'), 10) || 0,
    });
  }
  // 表示順（保存時に振った連番）で昇順ソートしてから種別ごとに振り分ける
  rows.sort((a, b) => a.order - b.order);
  const machines  = [];
  const spares    = [];
  const assignees = {};
  const addresses = {};  // 改修: 筐体ごとの手入力識別情報（メールアドレスとは別物）
  rows.forEach(r => {
    if (!r.name) return;
    if (r.type === 'spare') spares.push(r.name);
    else machines.push(r.name);
    if (r.assignee) assignees[r.name] = r.assignee;
    if (r.address)  addresses[r.name] = r.address;
  });
  return { machines, spares, assignees, addresses };
}

// 筐体マスタ（{machines, spares, assignees, addresses}）をCSVへルーム単位で全置換保存する
function writeMachineCsv(room, data) {
  const csvPath = machineCsvPath(room);
  if (!csvPath) return;
  // 格納フォルダが無ければ作成（初回起動時）
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const machines  = Array.isArray(data.machines) ? data.machines : [];
  const spares    = Array.isArray(data.spares)   ? data.spares   : [];
  const assignees = (data.assignees && typeof data.assignees === 'object') ? data.assignees : {};
  // 改修: アドレス（筐体ごとの手入力識別情報。メールアドレスとは別物）
  const addresses = (data.addresses && typeof data.addresses === 'object') ? data.addresses : {};
  const headerLine = ['種別', '筐体名', '担当者', 'アドレス', '表示順'].map(quoteVal).join(',');
  let order = 0;
  const dataLines = [];
  // メイン筐体→予備の順で表示順を振り直す（グリッドの行順と一致させる）
  machines.forEach(name => {
    dataLines.push(['machine', name, assignees[name] || '', addresses[name] || '', order++].map(quoteVal).join(','));
  });
  spares.forEach(name => {
    dataLines.push(['spare', name, assignees[name] || '', addresses[name] || '', order++].map(quoteVal).join(','));
  });
  // UTF-8 BOMを先頭に付与（日本語Windowsのアプリが文字化けしないよう）
  const bom = '﻿';
  fs.writeFileSync(csvPath, bom + [headerLine, ...dataLines].join('\r\n') + '\r\n', 'utf8');
}

// ────────────────────────────────────────────
// 改修(凡例共通化): 凡例マスタCSV ヘルパー（全ルーム共通・単一ファイル）
// CSVスキーマ（4列）: id, name, color, order
// 凡例定義（凡例パネルの名前＋色）を全PC共通化するため、localStorageからサーバーCSVへ移行する
// ────────────────────────────────────────────

// CSV未作成時に書き出す初期凡例（frontend/app.js の LEGEND_SEED と一致させること）
const DEFAULT_LEGEND = [
  { id: 'leg1', name: 'XPX（FI/EDR）',          color: '#8DB4E2' },
  { id: 'leg2', name: 'XPX構築',                color: '#E63283' },
  { id: 'leg3', name: 'マル特・TM',             color: '#92D050' },
  { id: 'leg4', name: '一般募集',               color: '#00B050' },
  { id: 'leg5', name: '事務局メンテ',           color: '#FFC000' },
  { id: 'leg6', name: '機材の不合格（バッファ）', color: '#00B0F0' },
  { id: 'leg7', name: 'AP2PIかつFHEV案件',       color: '#D457BF' },
  { id: 'leg8', name: '日程仮置き',             color: '#FFFF00' },
];

// 凡例マスタCSVを読み込み [{id, name, color}] を返す
// ファイルが存在しない場合はnullを返す（呼び出し側で初期シード投入の判断に使う）
function parseLegendMaster() {
  let raw;
  try {
    raw = fs.readFileSync(LEGEND_MASTER_PATH, 'utf8');
  } catch (_) {
    return null;
  }
  // UTF-8 BOM（U+FEFF）を除去してから分割
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 1) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    rows.push({
      id:    unquote(vals[0] || ''),
      name:  unquote(vals[1] || ''),
      color: unquote(vals[2] || ''),
      order: parseInt(unquote(vals[3] || '0'), 10) || 0,
    });
  }
  // 表示順（保存時に振った連番）で昇順ソート
  rows.sort((a, b) => a.order - b.order);
  return rows.filter(r => r.id).map(r => ({ id: r.id, name: r.name, color: r.color }));
}

// 凡例マスタ（[{id, name, color}]）をCSVへ全置換保存する
function writeLegendMaster(legend) {
  // 格納先フォルダが無ければ作成（初回起動時）
  fs.mkdirSync(path.dirname(LEGEND_MASTER_PATH), { recursive: true });
  const rows = Array.isArray(legend) ? legend : [];
  const headerLine = ['id', 'name', 'color', 'order'].map(quoteVal).join(',');
  const dataLines = rows.map((leg, idx) =>
    [leg.id || '', leg.name || '', leg.color || '', idx].map(quoteVal).join(',')
  );
  // UTF-8 BOMを先頭に付与（日本語Windowsのアプリが文字化けしないよう）
  const bom = '﻿';
  fs.writeFileSync(LEGEND_MASTER_PATH, bom + [headerLine, ...dataLines].join('\r\n') + '\r\n', 'utf8');
}

// ────────────────────────────────────────────
// 改修(休日設定): 休日リストCSV ヘルパー（全ルーム共通・単一ファイル・配列全置換方式）
// CSVスキーマ（1列）: date（ISO形式 YYYY-MM-DD）
// 事務局が設定した休日は全PC共通で反映するため、凡例マスタと同じ全置換方式で管理する
// ────────────────────────────────────────────

// 休日リストCSVを読み込み、ISO日付文字列の配列を返す
// ファイルが存在しない場合は空配列を返す（凡例マスタと異なり初期シードは不要）
function parseHolidayList() {
  let raw;
  try {
    raw = fs.readFileSync(HOLIDAY_CSV_PATH, 'utf8');
  } catch (_) {
    return [];
  }
  // UTF-8 BOM（U+FEFF）を除去してから分割
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const dates = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    const d = unquote(vals[0] || '');
    if (d) dates.push(d);
  }
  return dates;
}

// 休日リスト（ISO日付文字列の配列）をCSVへ全置換保存する。重複除去・昇順ソートしてから書き込む
function writeHolidayList(dates) {
  // 格納先フォルダが無ければ作成（初回起動時）
  fs.mkdirSync(path.dirname(HOLIDAY_CSV_PATH), { recursive: true });
  const rows = Array.from(new Set(Array.isArray(dates) ? dates : [])).sort();
  const headerLine = quoteVal('date');
  const dataLines  = rows.map(d => quoteVal(d));
  // UTF-8 BOMを先頭に付与（日本語Windowsのアプリが文字化けしないよう）
  const bom = '﻿';
  fs.writeFileSync(HOLIDAY_CSV_PATH, bom + [headerLine, ...dataLines].join('\r\n') + '\r\n', 'utf8');
}

// 改修(第13回): SP列名変換を南HILSルーム 統合HILS使用履歴リストの実内部名に差替え
// field_1=設備, field_6=設備使用開始日, field_7=設備使用終了日,
// OData__x7533__x8acb__x8005__x540d_=申請者名列（内部名は作成時点の表示名「申請者名」のエンコードのまま。
// リネーム後の表示名「申請者名」と一致するため内部名の変更は不要）, Title=ラベル（案件名）
// 改修: 借用者名列はSharePoint側で削除されたため読み込まない
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
    // 改修: アドレス列（筐体ごとの手入力識別情報。メールアドレスとは別物。南HILSルームのみ使用）
    address:  item['OData__x30a2__x30c9__x30ec__x30b9_']         || '',
    // 改修(承知/辞退表示不具合): 事務局アクションリストID列を返却し、承知/辞退ページの予約突合キーに使う
    actionListId: item['OData__x4e8b__x52d9__x5c40__x30a2__x30'] != null
        ? item['OData__x4e8b__x52d9__x5c40__x30a2__x30'] : null,
  };
}

// 改修(第12回): 事務局アクションリスト行のSP列名→フロント項目変換
function normalizeActionItem(item) {
  return {
    id:          item.Id,
    category:    item['OData__x5206__x985e_']                                                       || '',  // 分類
    applicant:   item['OData__x7533__x8acb__x8005__x540d_']                                         || '',  // 申請者名
    email:       item['OData__x7533__x8acb__x8005__x30e1__x30'] || '',  // 申請者メールアドレス（SP内部名32文字截断）
    machineType: item['OData__x6a5f__x7a2e__x547c__x79f0_']                                         || '',  // 機種呼称
    // 改修: ラベル初期値を機種呼称から環境使用用途へ変更するため追加（SP内部名32文字截断）
    usage:       item['OData__x74b0__x5883__x4f7f__x7528__x75']                                     || '',  // 環境使用用途（ラベル生成用）
    // 改修: 1案件=1予約ガードの判定用にステータス列を追加（update_action_statusと同一の内部名）
    status:      item['OData__x30b9__x30c6__x30fc__x30bf__x30']                                     || '',
    // 改修: 利用取消依頼の取消理由列。事務局が予約削除時にこの有無でステータス遷移先を判定する
    cancelReason: item['OData__x53d6__x6d88__x7406__x7531_']                                        || '',
  };
}

// 改修(第13回): フロント項目→南HILSルーム 統合HILS使用履歴リストのSP列名変換
// field_1=設備, field_6=設備使用開始日(DateTime), field_7=設備使用終了日(DateTime),
// Title=ラベル（案件名）, OData__x7533__x8acb__x8005__x540d_=申請者名
// color列は存在しないため書き込まない
// 改修: 借用者列はSharePoint側で削除されたため書き込まない（申請者のみ）
function toSpFields(data) {
  const f = {};
  if (data.label   !== undefined) f.Title                                      = data.label;
  if (data.machine !== undefined) f.field_1                                     = data.machine;
  // DateTime列: ISO形式（T00:00:00Z）でSharePointに渡す
  if (data.start   !== undefined) f.field_6                                     = data.start ? data.start.split('T')[0] + 'T00:00:00Z' : null;
  if (data.end     !== undefined) f.field_7                                     = data.end   ? data.end.split('T')[0]   + 'T00:00:00Z' : null;
  // 申請者（f-applicant）は申請者名列へ
  if (data.applicant !== undefined) f['OData__x7533__x8acb__x8005__x540d_']     = data.applicant;
  // 改修: 使用者アドレス列（申請者メールアドレス）へ書き込み。空の場合はスキップ（編集時の意図しないブランク上書き防止）
  if (data.email) f['OData__x7533__x8acb__x8005__x30a2__x30'] = data.email;
  // 改修: アドレス列（筐体ごとの手入力識別情報。メールアドレスとは別物。南HILSルームのみ）へ書き込み。
  // 空の場合はスキップ（既存emailと同方針。編集時の意図しないブランク上書き防止）
  if (data.address) f['OData__x30a2__x30c9__x30ec__x30b9_'] = data.address;
  // 改修: 事務局アクションリストID列（内部名 _x4e8b__x52d9__x5c40__x30a2__x30）へSP内部IDを数値で書き込み。未設定はスキップ
  if (data.actionListId != null) f['OData__x4e8b__x52d9__x5c40__x30a2__x30'] = data.actionListId;
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

// 改修: 起動時のメール宛先/CCコンソール入力を待ってからHTTP待受を開始する
// 改修(不具合修正): promptMailConfig()側でも例外を握っているが、二重の安全網として
// ここでもtry/catchし、メール設定プロンプトに起因するいかなる異常があってもserver.listen()に
// 必ず到達させる（タスクスケジューラ等の無人起動でサイトが立ち上がらなくなる事態を防ぐ）
(async () => {
  try {
    await promptMailConfig();
  } catch (e) {
    console.error('メール宛先/CC設定プロンプトでエラーが発生しました。既定値のまま起動を継続します:', e.message);
  }
  server.listen(PORT, () => {
    console.log(`HILS予約Webアプリ起動: http://localhost:${PORT}`);
    if (IS_DUMMY) console.log('  ※ SITE_URL未設定のためダミーデータで動作中');
    else          console.log(`  SharePoint: ${process.env.SITE_URL}`);
  });
})();
