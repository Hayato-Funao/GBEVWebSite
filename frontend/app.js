'use strict';

// ────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────
// 改修: メイン筐体のデフォルト一覧（予備は別管理）
const HILS_MACHINES = [
  ...'ABCDEFGHIJKLMNOPQRST'.split('').map(c => '筐体' + c),
];
// 改修: 予備のデフォルト一覧（メイン筐体と分離してグリッド最下部に配置）
const HILS_SPARES = ['予備1', '予備2'];

const WEEKDAY_JP   = ['月', '火', '水', '木', '金', '土', '日'];
const CAL_MIN      = { year: 2025, month: 12 };
// 改修(第7回): MAX_BIZ_DAYS 撤廃（上限なし）
// 改修: 予約状態（予備日・設備故障）の表示色とラベル定数
const STATUS_SPARE_COLOR   = '#00B0F0'; // 予備日：水色
const STATUS_HOLIDAY_COLOR = '#c8c8c8'; // 改修(第4回): 休日：土日と同じグレー
const STATUS_SPARE_TEXT    = '※予備日';
const STATUS_FAULT_TEXT    = '故障';
const EDGE_PX        = 10; // リサイズ端の判定幅（px）
// 改修(第7回追補): 日付列の最小幅（px）。動的フィット計算がこれを下回った場合に使用
const DATE_COL_MIN   = 18;

// 改修(第8回): 検証完了日★マーカーの種別定義（種別キー・表示ラベル・★表記の対応表）
const VERIFY_MARKS = [
  { key: 'tmg',   label: 'TMG検証',   star: 'TMG★'   },
  { key: 'diag',  label: '診断機検証', star: '診断機★' },
  { key: 'iumpr', label: 'IUMPR検証', star: '★'       },
];
// 改修(第8回): 種別キー → ★表示テキスト変換（未知の種別は汎用★を返す）
function starTextForType(type) {
  const m = VERIFY_MARKS.find(v => v.key === type);
  return m ? m.star : '★';
}
// 改修(第9回): mark個別のタイトル（title）を優先し「タイトル＋★」を返す。
//              titleが未定義の旧データはlabelにフォールバックして後方互換を維持
function markStarText(mk) {
  const m    = VERIFY_MARKS.find(v => v.key === mk.type);
  const name = (mk.title != null) ? mk.title : (m ? m.label : '');
  return name + '★';
}

// ────────────────────────────────────────────
// 改修(第6回): クエリパラメータによる権限判定（見た目のみ・認証ではない）
//   ?user=admin → 事務局モード（削除・編集ボタンを表示）
//   それ以外    → 使用者モード（延長申請ボタンを表示、ダブルクリック編集を無効化）
// ────────────────────────────────────────────
const _urlParams = new URLSearchParams(location.search);
const isAdmin    = _urlParams.get('user') === 'admin';

// 改修: ?page=accept で承知/辞退ページを単独表示（使用確定通知メールのリンクから直接開く専用URL）
const _acceptMode = _urlParams.get('page') === 'accept';
if (_acceptMode) {
  // ナビタブを非表示（メールから直接開く単独ページのため不要）
  document.querySelector('.nav-tabs').classList.add('hidden');
  // 承知/辞退ページをアクティブ化し、ビュー画面を非表示
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-accept').classList.add('active');
}

// ────────────────────────────────────────────
// 凡例カラーパレット（xlsx色分けルールより抽出）
// ────────────────────────────────────────────
const LEGEND_PALETTE = [
  '#8DB4E2', // 水色
  '#E63283', // マゼンタ
  '#92D050', // 薄緑
  '#00B050', // 緑
  '#FFC000', // 橙
  '#00B0F0', // 濃水色
  '#D457BF', // 紫
  '#FFFF00', // 黄
  '#FC498E', // ピンク
  '#FF0000', // 赤
  '#D9D9D9', // グレー
];

// 凡例シード（色分けルール + 國岡追加）
const LEGEND_SEED = [
  { id: 'leg1', name: 'XPX（FI/EDR）',          color: '#8DB4E2' },
  { id: 'leg2', name: 'XPX構築',                color: '#E63283' },
  { id: 'leg3', name: 'マル特・TM',             color: '#92D050' },
  { id: 'leg4', name: '一般募集',               color: '#00B050' },
  { id: 'leg5', name: '事務局メンテ',           color: '#FFC000' },
  { id: 'leg6', name: '機材の不合格（バッファ）', color: '#00B0F0' },
  { id: 'leg7', name: 'AP2PIかつFHEV案件',       color: '#D457BF' },
  { id: 'leg8', name: '日程仮置き',             color: '#FFFF00' },
];

const RES_STORAGE_KEY     = 'hils_reservations_v1';
// 改修(筐体マスタ共通化): 筐体マスタ（machines/spares/assignees）はサーバー側CSVへ移行したため
// localStorageキー（旧: hils_machines_v1 / hils_spares_v1 / hils_assignees_v1）は廃止
// 改修(凡例共通化): 凡例（_legend）もサーバー側CSVへ移行したため、localStorageキー（旧: hils_legend_v1）は廃止
const ASSIGNEE_VISIBLE_KEY  = 'hils_assignee_visible_v1';  // 改修: 担当者列の表示/非表示フラグ（全ルーム共通・画面表示設定のためlocalStorageのまま）

// ────────────────────────────────────────────
// 改修(凡例共通化): 凡例ストア（サーバー側CSV、全ルーム共通の単一ファイル）
// 旧実装はlocalStorageに保存していたためPC毎に内容が独立していた。
// /api/legend 経由でサーバーPC上のCSVへ保存し、全PC共通の情報にする。
// ────────────────────────────────────────────

// 凡例マスタをサーバーCSVから取得する。通信失敗時はLEGEND_SEED（既定値）を返す
async function fetchLegend() {
  try {
    const res = await fetch('/api/legend');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) && data.length ? data : LEGEND_SEED.map(l => ({ ...l }));
  } catch (e) {
    console.error('凡例マスタCSV取得失敗:', e);
    return LEGEND_SEED.map(l => ({ ...l }));
  }
}
// 凡例マスタを全置換でサーバーへ保存する（fire-and-forget、失敗はログのみ）
async function saveLegend(legend) {
  try {
    await fetch('/api/legend', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(legend),
    });
  } catch (e) {
    console.error('凡例マスタCSV保存失敗:', e);
  }
}
function getLegendMap(legend) {
  const m = {};
  legend.forEach(l => { m[l.id] = l; });
  return m;
}
function genLegendId() {
  return 'leg_' + Date.now() + Math.random().toString(36).slice(2, 5);
}
// 改修: 指定インデックス以外の凡例が使用中の色集合を返す（小文字HEXで正規化）
function getUsedLegendColors(excludeIdx) {
  const used = new Set();
  _legend.forEach((leg, i) => {
    if (i === excludeIdx) return;
    if (leg.color) used.add(leg.color.toLowerCase());
  });
  return used;
}
// 改修: パレットから未使用の先頭色を返す（全色使用済みの場合は null）
function pickUnusedPaletteColor() {
  const used = getUsedLegendColors(-1);
  return LEGEND_PALETTE.find(hex => !used.has(hex.toLowerCase())) || null;
}

// 改修(凡例共通化): 初期値は空配列。init()内で fetchLegend() によりサーバーCSVから非同期取得する
let _legend = [];

// ────────────────────────────────────────────
// 改修(筐体マスタ共通化): 筐体マスタストア（サーバー側CSV、ルーム別ファイル）
// 旧実装はlocalStorageに保存していたためPC毎に内容が独立していた。
// /api/machines?room=west|south 経由でサーバーPC上のCSVへ保存し、全PC共通の情報にする。
// ────────────────────────────────────────────

// 指定ルームの筐体マスタ（machines/spares/assignees）をサーバーから取得する
// 通信失敗時は従来のフォールバック値（westは既定筐体A〜T＋予備、southは空）を返す
async function fetchMachineMaster(room) {
  try {
    const res = await fetch(`/api/machines?room=${room}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      machines:  Array.isArray(data.machines)  ? data.machines  : [],
      spares:    Array.isArray(data.spares)    ? data.spares    : [],
      assignees: (data.assignees && typeof data.assignees === 'object') ? data.assignees : {},
      // 改修: アドレス（筐体ごとの手入力識別情報。メールアドレスとは別物）
      addresses: (data.addresses && typeof data.addresses === 'object') ? data.addresses : {},
    };
  } catch (e) {
    console.error('筐体マスタCSV取得失敗:', e);
    return room === 'west'
      ? { machines: HILS_MACHINES.slice(), spares: HILS_SPARES.slice(), assignees: {}, addresses: {} }
      : { machines: [], spares: [], assignees: {}, addresses: {} };
  }
}

// west/south両ルームの筐体マスタを取得し、state.machinesByRoom等のルーム別マップへ格納する
async function loadRoomMaster() {
  const [west, south] = await Promise.all([fetchMachineMaster('west'), fetchMachineMaster('south')]);
  state.machinesByRoom  = { west: west.machines,  south: south.machines };
  state.sparesByRoom    = { west: west.spares,    south: south.spares };
  state.assigneesByRoom = { west: west.assignees, south: south.assignees };
  // 改修: アドレスマップもルーム別に格納
  state.addressesByRoom = { west: west.addresses, south: south.addresses };
}

// 指定ルームの筐体マスタ（machines/spares/assignees/addresses）をサーバーへ全置換保存する
// 既存のCSV書き込みAPI（apiAppendLegendColor等）と同様、fire-and-forgetで送信し失敗はログのみ
async function saveRoomMaster(room) {
  try {
    await fetch(`/api/machines?room=${room}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        machines:  state.machinesByRoom[room]  || [],
        spares:    state.sparesByRoom[room]    || [],
        assignees: state.assigneesByRoom[room] || {},
        // 改修: アドレス（筐体ごとの手入力識別情報。メールアドレスとは別物）
        addresses: state.addressesByRoom[room] || {},
      }),
    });
  } catch (e) {
    console.error('筐体マスタCSV保存失敗:', e);
  }
}

// 現在ルームのメイン筐体一覧を保存する（呼び出し元は編集操作中の表示ルーム＝state.currentRoom）
function saveMachines() { saveRoomMaster(state.currentRoom); }
// 現在ルームの予備一覧を保存する
function saveSpares() { saveRoomMaster(state.currentRoom); }
// 現在ルームの担当者マップを保存する
function saveAssignees() { saveRoomMaster(state.currentRoom); }
// 改修: 現在ルームのアドレスマップを保存する（筐体ごとの手入力識別情報。メールアドレスとは別物）
function saveAddresses() { saveRoomMaster(state.currentRoom); }
// 改修: 担当者列の表示/非表示フラグをlocalStorageから読み込む（未設定・不正時は true で表示）
function loadAssigneeVisible() {
  try {
    const raw = localStorage.getItem(ASSIGNEE_VISIBLE_KEY);
    if (raw !== null) return JSON.parse(raw) !== false;
  } catch (_) {}
  return true; // 初期値: 表示
}
// 改修: 担当者列の表示/非表示を #gantt-table の CSS クラスで切り替える
function applyAssigneeVisibility(visible) {
  const tbl = document.getElementById('gantt-table');
  if (!tbl) return;
  // 改修: 使用者モードでは担当者列自体が不要なため、指定にかかわらず常に非表示にする
  if (!isAdmin) visible = false;
  // visible=false のとき assignee-hidden クラスを付与して列を非表示にする
  tbl.classList.toggle('assignee-hidden', !visible);
}

// 改修: アドレス列の表示/非表示を #gantt-table の CSS クラスで切り替える（南HILSルームのみ表示）
function applyAddressVisibility(room) {
  const tbl = document.getElementById('gantt-table');
  if (!tbl) return;
  tbl.classList.toggle('address-hidden', room !== 'south');
}

// 改修: 南HILSルームでは担当者列がそもそも不要なため、ルームに応じて列自体の表示/非表示と
// チェックボックスの有効/無効を切り替える。南HILSルームでは常に非表示・操作不可、
// 西HILSルームでは保存済みのユーザー設定（チェックボックス）に従って表示/非表示を復元する。
function applyAssigneeVisibilityForRoom(room) {
  const chk = document.getElementById('assignee-visible-chk');
  // 改修: 使用者モードでは担当者列・チェックボックス自体が不要なため常に非表示・操作不可にする
  if (!isAdmin) {
    applyAssigneeVisibility(false);
    if (chk) chk.disabled = true;
    return;
  }
  if (room === 'south') {
    applyAssigneeVisibility(false);
    if (chk) chk.disabled = true;
  } else {
    if (chk) chk.disabled = false;
    applyAssigneeVisibility(loadAssigneeVisible());
  }
}

// ────────────────────────────────────────────
// 予約ストア（localStorage）
// ────────────────────────────────────────────
function loadReservations() {
  try {
    const raw = localStorage.getItem(RES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}
function saveReservations(reservations) {
  localStorage.setItem(RES_STORAGE_KEY, JSON.stringify(reservations));
}

let _nextLocalId = 1;
function genLocalId() { return _nextLocalId++; }

// ────────────────────────────────────────────
// アプリ状態
// ────────────────────────────────────────────
const state = {
  year:          new Date().getFullYear(),
  month:         new Date().getMonth() + 1,
  viewStart:     null,     // 改修(第7回): 通し表示の開始日（先月の月初）
  viewEnd:       null,     // 改修(第7回): 通し表示の終了日（3か月先/年度末の長い方）
  viewDates:     [],       // 改修(第7回): 表示期間の全日配列（列インデックス = 添字）
  reservations:  [],
  currentRoom:    'west',                    // 改修(第4回): 現在選択中のルーム（'west'|'south'）
  machinesByRoom: { west: [], south: [] },   // 改修(第4回): ルーム別メイン筐体リスト
  sparesByRoom:   { west: [], south: [] },   // 改修(第4回): ルーム別予備リスト
  assigneesByRoom: { west: {}, south: {} },  // 改修(第4回): ルーム別担当者マップ
  // 改修: ルーム別アドレスマップ（筐体ごとに手入力する識別情報。メールアドレスとは別物。南HILSルームのみ使用）
  addressesByRoom: { west: {}, south: {} },
  machines:      [],               // メイン筐体リスト（currentRoomへのビュー。syncRoomViewsで更新）
  spares:        [],               // 改修: 予備リスト（currentRoomへのビュー。syncRoomViewsで更新）
  assignees:     {},               // 改修: 担当者マップ（currentRoomへのビュー。syncRoomViewsで更新）
  addresses:     {},               // 改修: アドレスマップ（currentRoomへのビュー。syncRoomViewsで更新）
  selectedCells: new Set(),
  selectedResId: null,
  anchorCell:    null,
  formMode:      null,  // 改修: サイドパネル表示中のモード('register'|'edit'|'view'|null)
  // 改修: 複数筐体（行）をまたぐ一括登録用。登録ダイアログ表示中のみ対象筐体名配列を保持する（単一選択時は要素数1、非登録時はnull）
  multiMachines: null,
  // 改修(第12回): 起動時に取得した事務局アクションリストのID（W-6）
  actionItemId:  null,
  // 改修: 1案件=1予約ガード判定用の現在ステータス（"N.xxxx"形式）
  actionStatus:  '',
  // 改修: このアクションIDに紐づく予約行のspId（削除時のガード解除判定用）
  actionResSpId: null,
  // 改修(第14回): 辞退時の使用履歴行削除用に保持するSP内部ID
  actionHilsId:  null,
  // 改修(起動連携): 辞退時のCSV行削除用に保持する使用履歴行の設備/開始日/終了日
  actionHilsRes: null,
  // 改修(第12回): URLパラメータ経由の自動記入用データ（W-4）
  autoFill:      null,
};

// ────────────────────────────────────────────
// 改修: 1案件=1予約ガード（事務局アクションリストのステータスによる登録抑止）
// ────────────────────────────────────────────
// ステータス "N.xxxx" の先頭番号を返す
function actionStatusNum(s) { return String(s || '').split('.')[0]; }
// これらの番号は既に予約登録済み（または処理中/終了）とみなし、2件目の登録をブロックする
const BLOCK_STATUS_NUMS = ['1', '3', '9', '10'];
// 予約削除時にステータスを初期値へ戻さない番号（否認・取り下げの管理状態を維持）
const KEEP_STATUS_NUMS  = ['90', '91'];

// ────────────────────────────────────────────
// 改修(案件跨ぎ誤操作防止): 別案件（別?id=）で登録された予約への編集・削除をブロックするための判定
// ────────────────────────────────────────────
// res.actionListId（登録時の案件ID）と現在開いている案件(state.actionTitleId)が
// 両方とも設定済みかつ不一致の場合のみ「別案件の予約」と判定する。
// 案件に紐づかない予約（予備日・設備故障・休日・手動登録）や、案件コンテキスト無しで
// 開いている全体管理画面（?id=を指定していない場合）には一切影響しない。
function isForeignCaseReservation(res) {
	if (!res || res.actionListId == null) return false;
	if (!state.actionTitleId) return false;
	return String(res.actionListId) !== String(state.actionTitleId);
}
// 別案件予約の操作をブロックした際に表示する警告文
function alertForeignCaseReservation(res) {
	alert('この予約は別案件（予約ID: ' + res.actionListId + '）で登録されています。該当案件の起動リンクから開いて操作してください。');
}

// 改修: メイン筐体と予備を結合した全環境名リストを返す（行インデックス計算に使用）
function getAllMachines() {
  return [...state.machines, ...state.spares];
}

// 改修(筐体マスタ共通化): 筐体名の重複判定用に前後空白除去+小文字化して正規化する
// 南ルームはSP予約由来の設備名とCSVマスタの既存名が表記ゆれで重複しうるため、
// 追加・マージ処理では必ずこの正規化キーで突合すること
function normalizeMachineName(name) {
  return String(name || '').trim().toLowerCase();
}

// 改修(第4回): 現在ルームのデータを state.machines/spares/assignees へバインドする
function syncRoomViews() {
  state.machines  = state.machinesByRoom[state.currentRoom];
  state.spares    = state.sparesByRoom[state.currentRoom];
  state.assignees = state.assigneesByRoom[state.currentRoom];
  // 改修: アドレスマップも現在ルームのビューへバインド
  state.addresses = state.addressesByRoom[state.currentRoom];
}

// ────────────────────────────────────────────
// 日付ユーティリティ
// ────────────────────────────────────────────
function isoToDate(str) {
  const [y, m, d] = str.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dateToIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
// 改修(第7回): 表示期間を初期化する（先月月初〜3か月先月末/年度末の長い方）
function initViewRange() {
  const today = new Date();
  // 開始: 先月の月初
  state.viewStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  // 終了: 今日+3か月の月末 と 今年度末（翌3/31）の長い方
  const threeEnd  = new Date(today.getFullYear(), today.getMonth() + 4, 0);
  const fy        = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const fiscalEnd = new Date(fy + 1, 2, 31);
  state.viewEnd   = threeEnd > fiscalEnd ? threeEnd : fiscalEnd;
  // 全日配列を構築（列インデックス = 添字）
  state.viewDates = [];
  const d = new Date(state.viewStart);
  while (d <= state.viewEnd) {
    state.viewDates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
}
// 改修(第7回): 日付 → 列インデックス（表示範囲外は null）
function dateToCol(date) {
  const vs   = state.viewStart;
  const d    = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const s    = new Date(vs.getFullYear(), vs.getMonth(), vs.getDate());
  const diff = Math.round((d - s) / 86400000);
  if (diff < 0 || diff >= state.viewDates.length) return null;
  return diff;
}
// 改修(第7回): 列インデックス → 日付
function colToDate(col) {
  return state.viewDates[col] || null;
}
function bizDaysBetween(start, end) {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// start（含む）から数えて n 営業日目の日付（土日スキップ）
function addBizDays(startDate, n) {
  if (n <= 0) return new Date(startDate);
  const d = new Date(startDate);
  let count = 0;
  while (true) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
}

// end（含む）が n 営業日目になるような最も早い開始日
function startForBizDays(endDate, n) {
  if (n <= 0) return new Date(endDate);
  const d = new Date(endDate);
  let count = 0;
  while (true) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() - 1);
  }
}

// ────────────────────────────────────────────
// メール送信ヘルパ（改修(第14回): /api/mail 経由でGraph API /me/sendMail を呼び出す）
// ────────────────────────────────────────────
// 改修: CC対応のため第4引数ccを追加（未指定時は省略可）
async function sendMail(to, subject, body, cc) {
  const res = await fetch('/api/mail', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ to, subject, body, cc: cc || '' }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// 改修: 事務局宛先(To)・CC・ユーザー宛CCはコンソール設定（backend/mail_config.json）から配布される。
// サーバから配布されるまでの初期値は空文字とし、mailConfig.pmoTo が空の間は事務局宛メールを送らない。
const mailConfig = { pmoTo: '', pmoCc: '', userCc: '' };

// 改修: 起動時にサーバから宛先/CC設定を取得する。取得失敗時は空のまま（事務局宛メールは送信不可）
async function loadMailConfig() {
	try {
		const cfg = await fetch('/api/mail-config').then(r => r.json());
		Object.assign(mailConfig, cfg);
	} catch (e) {
		console.error('メール宛先/CC設定の取得に失敗しました:', e);
	}
}

// 改修(メール文面): 共通件名ビルダ。筐体名があれば末尾に＜筐体名＞を付与
// 改修: アドレス（筐体ごとの手入力識別情報。メールアドレスとは別物）があれば＜アドレス 筐体名＞に拡張
// 改修: 複数筐体一括登録で連動予約がある場合、siblingCount（連動予約の件数）を＜…他N件＞として付記する
function buildMailSubject(title, machine, address, siblingCount) {
	const inner  = (address && machine) ? `${address} ${machine}` : (machine || '');
	const extra  = siblingCount ? ` 他${siblingCount}件` : '';
	const suffix = inner ? `＜${inner}${extra}＞` : '';
	return `【統合HILS（61号棟南HILSルーム）予約】${title}${suffix}`;
}

// 改修: メール件名用アドレスを取得する共通ヘルパー。
// state.addresses は syncRoomViews() で現在ルームのアドレスマップにバインドされているため、
// 西HILSルームでは常に空（アドレス列は南HILSルームのみ使用）となり自然にフォールバックする
function resolveMailAddress(machine) {
	return (machine && state.addresses[machine]) || '';
}

// 改修(メール文面): 全メール末尾の共通署名ブロック
// 改修: お問い合わせ先はコンソール設定の事務局宛先(pmoTo)先頭アドレスを使用
function mailSignature() {
	const contact = (mailConfig.pmoTo || '').split(',')[0].trim();
	return `\n────────────────────\n` +
		`統合HILS予約管理表事務局\n` +
		`お問い合わせ: ${contact}\n` +
		`予約管理表: ${location.origin}/\n` +
		`────────────────────`;
}

// ────────────────────────────────────────────
// ステータス表示
// ────────────────────────────────────────────
function setStatus(text, color = 'orange') {
  const el = document.getElementById('status-msg');
  if (text) {
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ────────────────────────────────────────────
// 改修: 処理中オーバーレイ制御
// メール送信・ステータス変更などの実行中は全画面オーバーレイ＋スピナーで操作をブロックする。
// 参照カウント方式にしているのは、登録処理でステータス更新とメール送信を並行実行する箇所があり、
// 片方の完了で先にオーバーレイを閉じてしまわないようにするため。
// ────────────────────────────────────────────
let busyCount = 0;
function showBusy(text = '処理中...') {
  busyCount++;
  const overlay = document.getElementById('busy-overlay');
  overlay.querySelector('.busy-text').textContent = text;
  overlay.classList.remove('hidden');
}
function hideBusy() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0) {
    document.getElementById('busy-overlay').classList.add('hidden');
  }
}

// ────────────────────────────────────────────
// バックエンド API
// ────────────────────────────────────────────
// 改修(SP連携マージ): エラー時は null を返して init() でlocalStorageフォールバック判定に使用
async function fetchReservations() {
  try {
    const res = await fetch('/api/reservations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('予約取得失敗:', e);
    setStatus('データ取得に失敗しました（ローカルデータを使用）', '#ef4444');
    return null;  // 改修(SP連携マージ): エラー時はnullでfetchできなかったことを示す
  }
}

// 改修(起動連携): 凡例色リストCSVを配列として取得する
async function fetchLegendColors() {
  try {
    const res = await fetch('/api/legend-colors');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('凡例色リストCSV取得失敗:', e);
    return [];
  }
}

// 改修(起動連携): 凡例色リストCSVに行を追記/上書きする
// 突合キー: machine + start + end
async function apiAppendLegendColor(resData) {
  try {
    await fetch('/api/legend-colors', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        machine:   resData.machine   || '',
        start:     resData.start     || '',
        end:       resData.end       || '',
        project:   resData.label     || '',
        color:     resData.color     || '#fde68a',
        borrower:  resData.user      || '',
        applicant: resData.applicant || '',
        status:    resData.status    || 'normal',
        legendId:  resData.legendId  || '',
        remark:    resData.remark    || '',
        marks:     resData.marks     || [],
      }),
    });
    return true;  // 改修: 呼び出し元で成否判定できるよう戻り値を追加（筐体名リネーム時の失敗カウント用）
  } catch (e) {
    console.error('凡例色リストCSV追記失敗:', e);
    return false;
  }
}

// 改修(起動連携): 凡例色リストCSVの該当行（machine+start+end）を削除する
async function apiDeleteLegendColor(machine, start, end) {
  if (!machine || !start || !end) return false;
  try {
    const params = new URLSearchParams({ machine, start, end });
    await fetch(`/api/legend-colors?${params}`, { method: 'DELETE' });
    return true;  // 改修: 呼び出し元で成否判定できるよう戻り値を追加（筐体名リネーム時の失敗カウント用）
  } catch (e) {
    console.error('凡例色リストCSV行削除失敗:', e);
    return false;
  }
}

// 改修(状態分離): 状態リストCSV（予備日/設備故障/休日）を配列として取得する
async function fetchStatusList() {
  try {
    const res = await fetch('/api/status-list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('状態リストCSV取得失敗:', e);
    return [];
  }
}

// 改修(状態分離): 状態リストCSVに行を追記/上書きする（SharePointには登録しない）
// 突合キー: machine + start + end
async function apiAppendStatus(resData) {
  try {
    await fetch('/api/status-list', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        machine:   resData.machine   || '',
        start:     resData.start     || '',
        end:       resData.end       || '',
        project:   resData.label     || '',
        color:     resData.color     || '#fde68a',
        borrower:  resData.user      || '',
        applicant: resData.applicant || '',
        status:    resData.status    || 'normal',
        legendId:  resData.legendId  || '',
        remark:    resData.remark    || '',
        marks:     resData.marks     || [],
      }),
    });
    return true;  // 改修: 呼び出し元で成否判定できるよう戻り値を追加（筐体名リネーム時の失敗カウント用）
  } catch (e) {
    console.error('状態リストCSV追記失敗:', e);
    return false;
  }
}

// 改修(状態分離): 状態リストCSVの該当行（machine+start+end）を削除する
async function apiDeleteStatus(machine, start, end) {
  if (!machine || !start || !end) return false;
  try {
    const params = new URLSearchParams({ machine, start, end });
    await fetch(`/api/status-list?${params}`, { method: 'DELETE' });
    return true;  // 改修: 呼び出し元で成否判定できるよう戻り値を追加（筐体名リネーム時の失敗カウント用）
  } catch (e) {
    console.error('状態リストCSV行削除失敗:', e);
    return false;
  }
}

// 改修(SP連携マージ): SP列に対応する最小項目を組み立てる
// 改修: user（使用者名列）は申請者欄の値を使用。email（使用者アドレス列）を追加
// 改修(事務局アクションリストID誤上書き防止): 第2引数isCreateを追加。
// isCreate=true（新規登録）の場合のみ、今開いている案件ID(state.actionTitleId)を
// actionListIdとして転記する。isCreate=false（既存予約の更新）の場合は、
// 予約が元々持つactionListId（resData.actionListId）をそのまま維持し、
// 今開いている案件IDで上書きしない。従来はupdate時も無条件に今開いている案件IDを
// 書き込んでいたため、別案件の予約を編集・ドラッグ移動・筐体名一括リネームした際に
// その予約の事務局アクションリストIDが今開いている案件IDへ誤って書き換わる不具合があった。
function buildSpPayload(resData, isCreate) {
  const lm    = getLegendMap(_legend);
  const color = (resData.legendId && lm[resData.legendId]) ? lm[resData.legendId].color : (resData.color || '#fde68a');
  return {
    machine: resData.machine,
    start:   resData.start,
    end:     resData.end,
    label:   resData.label     || '',
    color,
    // 改修(不具合修正): 従来ここで user に resData.applicant（申請者欄の値）を詰めており、
    // 借用者欄（resData.user）の値がSPへ一切送られていなかった（借用者名列が常に空になる原因）。
    // borrower/user 双方をそのまま送り、backend側 toSpFields() で借用者名列/使用者名列に振り分ける
    user:      resData.user      || '',  // 借用者（f-user）
    applicant: resData.applicant || '',  // 申請者（f-applicant）
    email:     resData.email     || '',  // 改修: 使用者アドレス列へ申請者メールアドレスを転記
    // 改修: アドレス列（筐体ごとの手入力識別情報。メールアドレスとは別物。南HILSルームのみ）
    address:   resData.address   || '',
    // 改修(事務局アクションリストID誤上書き防止): 新規登録時のみ今開いている案件IDを転記。
    // 更新時は予約が元々持つactionListIdをそのまま維持する
    actionListId: isCreate
      ? ((state.actionTitleId && /^\d+$/.test(state.actionTitleId)) ? Number(state.actionTitleId) : undefined)
      : resData.actionListId,
  };
}

// 改修: 複数筐体一括登録で連動する兄弟予約（同一groupId・自分以外）を取得する
// groupIdは一括登録時のみ発行される（openRegisterDialog→okBtn.onclick register分岐）。
// 単独登録の予約はgroupIdを持たないため、常に空配列を返す
function getGroupSiblings(res) {
  if (!res || res.groupId == null) return [];
  return state.reservations.filter(r => r !== res && r.groupId === res.groupId);
}

// 改修: machine/start/endの組から state.reservations 内の完全なレコードを検索する。
// state.actionHilsRes 等、SPの生データから作られた簡易オブジェクト（{machine,start,end}のみ・groupId無し）
// から、groupIdを含む完全なレコードを辿るために使う
function findFullReservation(partial) {
  if (!partial) return null;
  return state.reservations.find(r =>
    r.machine === partial.machine && r.start === partial.start && r.end === partial.end
  ) || null;
}

// 改修: メール件名の件数サフィックス・本文に付記する連動筐体一覧ブロックをまとめて返す。
// 連動予約が無ければ { count: 0, note: '' } を返し、呼び出し側の文面は従来通りになる
function getGroupMailInfo(resLike) {
  const full = (resLike && resLike.groupId != null) ? resLike : findFullReservation(resLike);
  const siblings = getGroupSiblings(full);
  if (!siblings.length) return { count: 0, note: '' };
  const lines = [full, ...siblings].map(r => {
    const addr = resolveMailAddress(r.machine);
    return addr ? ` ・${addr} ${r.machine}` : ` ・${r.machine}`;
  });
  return {
    count: siblings.length,
    note:  `\n■同時登録されている筐体（連動予約）\n${lines.join('\n')}\n`,
  };
}

// 改修(SP連携マージ): SPにアイテムを新規作成し、返却された SP の Id を返す
async function apiCreate(resData) {
  try {
    const res = await fetch('/api/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // 改修(事務局アクションリストID誤上書き防止): 新規登録なのでisCreate=true
      body:    JSON.stringify(buildSpPayload(resData, true)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.item && json.item.Id != null) ? json.item.Id : null;
  } catch (e) {
    console.error('SP登録失敗:', e);
    setStatus('SP保存に失敗しました（ローカルには保存済み）', '#ef4444');
    return null;
  }
}

// 改修(SP連携マージ): SP のアイテムを更新する
async function apiUpdate(spId, resData) {
  if (spId == null) return false;
  try {
    const res = await fetch(`/api/reservations/${spId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // 改修(事務局アクションリストID誤上書き防止): 既存予約の更新なのでisCreate=false
      // （予約が元々持つactionListIdを維持し、今開いている案件IDで上書きしない）
      body:    JSON.stringify(buildSpPayload(resData, false)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;  // 改修: 呼び出し元で成否判定できるよう戻り値を追加（筐体名リネーム時の失敗カウント用）
  } catch (e) {
    console.error('SP更新失敗:', e);
    setStatus('SP更新に失敗しました（ローカルには保存済み）', '#ef4444');
    return false;
  }
}

// 改修(SP連携マージ): SP のアイテムを削除する
async function apiDelete(spId) {
  if (spId == null) return;
  try {
    const res = await fetch(`/api/reservations/${spId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error('SP削除失敗:', e);
    setStatus('SP削除に失敗しました', '#ef4444');
  }
}

// 改修: 予約1件分の編集内容をSP（使用履歴リスト）／CSV（凡例色リスト・状態リスト）へ同期する。
// okBtn.onclick の edit 分岐から切り出したもので、呼び出し前に state.reservations[resId] は
// 変更後の内容へ更新済みであること。prevSpId/prevStatus/prevMachine/prevStart/prevEnd は
// 変更前の値（正規/非正規の切替判定・旧CSV行の削除キーに使用）。
// 複数筐体一括登録の連動予約（兄弟）にも同じロジックを使い回すために関数化した。
async function syncReservationEdit(resId, prevSpId, prevStatus, prevMachine, prevStart, prevEnd) {
  const wasNormal = prevStatus === 'normal';
  const isNormal  = (state.reservations[resId].status || 'normal') === 'normal';
  if (isNormal) {
    // 改修(SP連携マージ): spIdがあれば更新、なければ新規作成してspIdを保存
    if (prevSpId != null) {
      await apiUpdate(prevSpId, state.reservations[resId]);
    } else {
      const newSpId = await apiCreate(state.reservations[resId]);
      if (newSpId != null) {
        state.reservations[resId].spId = newSpId;
        saveReservations(state.reservations);
      }
    }
    // 改修(起動連携): 凡例色リストCSVを更新（同一 machine+start+end で上書き）
    await apiAppendLegendColor(state.reservations[resId]);
    // 改修(状態分離): 非正規→正規への変更時は、旧・状態リストCSVの行を削除する
    if (!wasNormal) await apiDeleteStatus(prevMachine, prevStart, prevEnd);
  } else {
    // 改修(状態分離): 予備日/設備故障/休日へ変更（または非正規のまま編集）: SPは更新せず状態リストCSVへ記録
    if (prevSpId != null) {
      // 正規→非正規への変更: 既存のSP行・凡例色リストCSV行を削除しspIdを外す
      await apiDelete(prevSpId);
      await apiDeleteLegendColor(prevMachine, prevStart, prevEnd);
      state.reservations[resId].spId = null;
      saveReservations(state.reservations);
    }
    await apiAppendStatus(state.reservations[resId]);
  }
}

// ────────────────────────────────────────────
// 予約→セルマップ構築
// ────────────────────────────────────────────
// 改修(第7回): 引数から year/month を撤去し viewDates 基準に変更
function buildResCellMap(reservations) {
  const legendMap  = getLegendMap(_legend);
  const map        = {};
  getAllMachines().forEach(m => { map[m] = {}; });

  const viewStart = state.viewStart;
  const viewEnd   = state.viewEnd;

  reservations.forEach((res, resId) => {
    // 改修(第4回): 現在ルームの予約のみを描画する
    if ((res.room || 'west') !== state.currentRoom) return;
    if (!map[res.machine]) return;

    const resStart = isoToDate(res.start);
    const resEnd   = isoToDate(res.end);
    // 改修(第7回): クリップ境界を viewStart/viewEnd に変更
    if (resEnd < viewStart || resStart > viewEnd) return;

    const dispStart   = resStart < viewStart ? new Date(viewStart) : new Date(resStart);
    const dispEnd     = resEnd   > viewEnd   ? new Date(viewEnd)   : new Date(resEnd);
    const isRealStart = resStart >= viewStart;
    const isRealEnd   = resEnd   <= viewEnd;

    // 改修: 状態に応じて色を解決
    const resStatus = res.status || 'normal';
    let color;
    if (resStatus === 'spare') {
      color = STATUS_SPARE_COLOR;
    } else if (resStatus === 'fault') {
      color = '#d9d9d9';
    } else if (resStatus === 'holiday') {
      color = STATUS_HOLIDAY_COLOR;
    } else {
      color = (res.legendId && legendMap[res.legendId])
        ? legendMap[res.legendId].color
        : (res.color || '#fde68a');
    }

    let firstCol = null;
    let lastCol  = null;

    for (let d = new Date(dispStart); d <= dispEnd; d.setDate(d.getDate() + 1)) {
      // 改修(第7回): 列インデックスを dateToCol で算出
      const col  = dateToCol(d);
      if (col === null) continue;
      const wday = d.getDay();
      if (wday === 0 || wday === 6) continue;
      if (firstCol === null) firstCol = col;
      lastCol = col;
      map[res.machine][col] = {
        resId,
        color,
        status:    resStatus,
        label:     res.label || '',
        legendId:  res.legendId || '',
        applicant: res.applicant || '',
        isStart:   false,
        isEnd:     false,
      };
    }
    if (firstCol !== null) map[res.machine][firstCol].isStart = isRealStart;
    if (lastCol  !== null) {
      map[res.machine][lastCol].isEnd  = isRealEnd;
      map[res.machine][lastCol].remark = res.remark || '';
    }
    // 改修(第8回): 全検証完了★を開始セルに格納（ラベル内配置のため）
    if (firstCol !== null) {
      map[res.machine][firstCol].resMarks = res.marks || [];
    }
  });

  return map;
}

// ────────────────────────────────────────────
// カレンダー描画
// ────────────────────────────────────────────
// 改修(第7回): 月ごとページ分けから期間通し表示（左右スクロール）へ全面再構築
function renderCalendar() {
  const { reservations, selectedCells, selectedResId } = state;
  const viewDates  = state.viewDates;
  const totalCols  = viewDates.length;

  const today  = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();

  // 改修(第7回): 表示範囲をラベルに反映
  const vsY = state.viewStart.getFullYear();
  const vsM = state.viewStart.getMonth() + 1;
  const veY = state.viewEnd.getFullYear();
  const veM = state.viewEnd.getMonth() + 1;
  document.getElementById('month-label').textContent =
    `${vsY}年${vsM}月 〜 ${veY}年${veM}月`;

  // 改修(第7回追補): colgroup を毎回再構築して列幅を確定する
  // table-layout:fixed では colgroup の col 幅が rowspan/colspan に優先されるため
  // 月見出し行(colspan N)に覆われた日付列の幅も確実に制御できる
  const table = document.getElementById('gantt-table');
  const existingCg = table.querySelector('colgroup');
  if (existingCg) existingCg.remove();
  const cg = document.createElement('colgroup');
  // 改修: 列順入れ替え（アドレス→筐体→担当者）。アドレス列を筐体列より先に追加する
  // 改修: アドレス列（筐体ごとの手入力識別情報。メールアドレスとは別物。南HILSルームのみ表示、幅80px/非表示0px）
  const colAddress = document.createElement('col');
  colAddress.className = 'col-address';
  colAddress.style.width = table.classList.contains('address-hidden') ? '0px' : '80px';
  cg.appendChild(colAddress);
  // 筐体列（170px固定）
  const colMachine = document.createElement('col');
  colMachine.className = 'col-machine';
  colMachine.style.width = '170px';
  cg.appendChild(colMachine);
  // 担当者列（表示時80px / 非表示時0px）
  const colAssignee = document.createElement('col');
  colAssignee.className = 'col-assignee';
  colAssignee.style.width = table.classList.contains('assignee-hidden') ? '0px' : '80px';
  cg.appendChild(colAssignee);
  // 日付列（CSS変数 --date-col-w を参照。初期値は仮置き、直後に applyDateColWidth で更新）
  for (let i = 0; i < totalCols; i++) {
    const colDate = document.createElement('col');
    colDate.className  = 'col-date';
    colDate.style.width = 'var(--date-col-w, 26px)';
    cg.appendChild(colDate);
  }
  table.insertBefore(cg, table.firstChild);

  // thead（改修(第7回): 2行構成 ─ 行1:月見出し / 行2:日付）
  const thead = document.getElementById('gantt-head');
  thead.innerHTML = '';

  // 行1: 月見出し行
  const monthRow   = document.createElement('tr');
  // 改修(第7回): 筐体列・担当者列は rowSpan=2 で両ヘッダ行を占有
  // 改修: 列順入れ替え（アドレス→筐体→担当者）。アドレス列見出しを筐体列より先に追加する
  // 改修: アドレス列見出し（筐体ごとの手入力識別情報。メールアドレスとは別物）
  const thAddress = document.createElement('th');
  thAddress.className   = 'address-col';
  thAddress.rowSpan     = 2;
  thAddress.textContent = 'アドレス';
  monthRow.appendChild(thAddress);

  const thMachine  = document.createElement('th');
  thMachine.className   = 'machine-col';
  thMachine.rowSpan     = 2;
  thMachine.textContent = '筐体';
  monthRow.appendChild(thMachine);

  const thAssignee = document.createElement('th');
  thAssignee.className   = 'assignee-col';
  thAssignee.rowSpan     = 2;
  thAssignee.textContent = '担当者';
  monthRow.appendChild(thAssignee);

  // 改修(第7回): 月ごとに colspan 結合した月見出しセルを生成
  let mCol = 0;
  while (mCol < totalCols) {
    const dRef = viewDates[mCol];
    const yr = dRef.getFullYear();
    const mo = dRef.getMonth();
    let span = 0;
    let c = mCol;
    while (c < totalCols && viewDates[c].getFullYear() === yr && viewDates[c].getMonth() === mo) {
      span++;
      c++;
    }
    const thMonth = document.createElement('th');
    thMonth.className   = 'month-col';
    thMonth.colSpan     = span;
    thMonth.textContent = `${yr}年${dRef.getMonth() + 1}月`;
    monthRow.appendChild(thMonth);
    mCol = c;
  }
  thead.appendChild(monthRow);

  // 行2: 日付行
  const dateRow = document.createElement('tr');
  for (let col = 0; col < totalCols; col++) {
    const d    = viewDates[col];
    const wday = d.getDay();
    const isWkd = (wday === 0 || wday === 6);
    const isTod = d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD;
    // 曜日表示用インデックス変換（JS: 0=日〜6=土 → WEEKDAY_JP: 0=月〜6=日）
    const wdayJp = wday === 0 ? 6 : wday - 1;
    const th = document.createElement('th');
    th.className   = 'date-col' + (isWkd ? ' weekend' : '') + (isTod ? ' today-hd' : '');
    th.dataset.col = col;
    th.innerHTML   = `${d.getDate()}<br><span style="font-size:10px;font-weight:normal">${WEEKDAY_JP[wdayJp]}</span>`;
    dateRow.appendChild(th);
  }
  thead.appendChild(dateRow);

  // tbody
  const tbody    = document.getElementById('gantt-body');
  tbody.innerHTML = '';
  // 改修(第7回): buildResCellMap の引数変更（year/month 撤去）
  const resCells = buildResCellMap(reservations);

  // ドラッグ中プレビュー
  const previewMap = {};
  const ghostKeys  = new Set();
  if (_drag.active && _drag.previewCells && _drag.ghostCells) {
    const lm = getLegendMap(_legend);
    const dragRes = reservations[_drag.resId];
    const pc = (dragRes && dragRes.legendId && lm[dragRes.legendId])
      ? lm[dragRes.legendId].color
      : (dragRes ? (dragRes.color || '#fde68a') : '#fde68a');
    _drag.previewCells.forEach(k => { previewMap[k] = pc; });
    _drag.ghostCells.forEach(k => ghostKeys.add(k));
  }

  // 行描画ヘルパー
  function buildMachineRow(machine, rowIdx) {
    const tr = document.createElement('tr');

    // 機種名セル（左固定列）
    const tdMachine = document.createElement('td');
    tdMachine.className = 'machine-col';
    tdMachine.title     = isAdmin ? `${machine}（ダブルクリックで編集）` : machine;

    const nameSpan = document.createElement('span');
    nameSpan.className   = 'machine-name';
    nameSpan.textContent = machine;
    tdMachine.appendChild(nameSpan);

    if (isAdmin) {
      const machineDelBtn = document.createElement('button');
      machineDelBtn.className   = 'machine-del-btn';
      machineDelBtn.textContent = '×';
      machineDelBtn.title       = '削除';
      machineDelBtn.addEventListener('click', e => {
        e.stopPropagation();
        const hasRes = state.reservations.some(r => r.machine === machine && (r.room || 'west') === state.currentRoom);
        if (hasRes) {
          alert(`「${machine}」には予約が登録されているため削除できません。\n先に予約を削除してください。`);
          return;
        }
        if (!confirm(`「${machine}」を削除しますか？`)) return;
        if (rowIdx < state.machines.length) {
          state.machines.splice(rowIdx, 1);
          saveMachines();
        } else {
          state.spares.splice(rowIdx - state.machines.length, 1);
          saveSpares();
        }
        delete state.assignees[machine];
        saveAssignees();
        renderCalendar();
      });
      tdMachine.appendChild(machineDelBtn);
    }

    if (isAdmin) {
      tdMachine.addEventListener('dblclick', () => {
        const oldName   = getAllMachines()[rowIdx];
        const editInput = document.createElement('input');
        editInput.type      = 'text';
        editInput.value     = oldName;
        editInput.className = 'machine-edit-input';
        tdMachine.textContent = '';
        tdMachine.appendChild(editInput);
        editInput.focus();
        editInput.select();

        // 改修: 筐体名リネーム時に予約データ（統合HILS使用履歴リスト／凡例色リストCSV／状態リストCSV）が
        // 旧筐体名のまま放置されると、次回起動時の南ルーム自動同期で旧筐体名が幽霊行として復活する不具合があった。
        // 対象予約がある場合は確認のうえ、新筐体名で書き戻し・旧筐体名側を削除する（asyncに変更）
        async function commitEdit() {
          const newName = editInput.value.trim();
          if (newName && newName !== oldName) {
            // 改修: リネーム対象筐体・対象ルームに紐づく予約を洗い出す
            const affected = state.reservations.filter(res =>
              res.machine === oldName && (res.room || 'west') === state.currentRoom
            );
            // 改修: 既存予約がある場合は確認。キャンセルならリネーム自体を中止する
            if (affected.length > 0 && !confirm(
              `筐体名「${oldName}」には${affected.length}件の予約データがあります。\n` +
              `リネームすると、統合HILS使用履歴リスト等の予約データも新しい筐体名「${newName}」に更新されます。\n` +
              `よろしいですか？`
            )) {
              renderCalendar();
              return;
            }
            if (rowIdx < state.machines.length) {
              state.machines[rowIdx] = newName;
              saveMachines();
            } else {
              state.spares[rowIdx - state.machines.length] = newName;
              saveSpares();
            }
            state.reservations = state.reservations.map(res =>
              (res.machine === oldName && (res.room || 'west') === state.currentRoom)
                ? { ...res, machine: newName }
                : res
            );
            saveReservations(state.reservations);
            if (Object.prototype.hasOwnProperty.call(state.assignees, oldName)) {
              state.assignees[newName] = state.assignees[oldName];
              delete state.assignees[oldName];
              saveAssignees();
            }
            // 改修: 筐体名変更時にアドレスマップのキーも追従させる
            if (Object.prototype.hasOwnProperty.call(state.addresses, oldName)) {
              state.addresses[newName] = state.addresses[oldName];
              delete state.addresses[oldName];
              saveAddresses();
            }
            renderCalendar();  // 改修: ローカル表示を先に確定させてから、以下でSP/CSVへ反映する

            // 改修: 対象予約を統合HILS使用履歴リスト／凡例色リストCSV／状態リストCSVへ新筐体名で反映
            if (affected.length > 0) {
              showBusy('予約データを更新中...');
              let failCount = 0;
              for (const res of affected) {
                const renamed = { ...res, machine: newName };
                let ok = true;
                if ((res.status || 'normal') === 'normal') {
                  // 通常予約: SPの使用履歴リスト＋凡例色リストCSVを新筐体名側へ、旧筐体名側は削除
                  if (res.spId != null) ok = await apiUpdate(res.spId, renamed) && ok;
                  ok = await apiAppendLegendColor(renamed) && ok;
                  ok = await apiDeleteLegendColor(oldName, res.start, res.end) && ok;
                } else {
                  // 予備日/設備故障/休日: 状態リストCSVのみ（SP未連携）
                  ok = await apiAppendStatus(renamed) && ok;
                  ok = await apiDeleteStatus(oldName, res.start, res.end) && ok;
                }
                if (!ok) failCount++;
              }
              hideBusy();
              setStatus(
                failCount > 0
                  ? `筐体名は変更しましたが、${failCount}/${affected.length}件の予約データ更新に失敗しました。手動で確認してください。`
                  : `筐体名を変更し、${affected.length}件の予約データを更新しました。`,
                failCount > 0 ? 'red' : undefined
              );
            }
            return;
          }
          renderCalendar();
        }

        editInput.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { editInput.blur(); }
          if (e.key === 'Escape') { renderCalendar(); }
        });
        editInput.addEventListener('blur', commitEdit);
      });
    }

    // 改修: 列順入れ替え（アドレス→筐体→担当者）のため、tdMachineのDOM追加をここでは行わず
    // アドレスセル構築後にまとめて追加する（tdMachine自体はここまでで構築済み）

    // 改修: アドレスセル（筐体ごとの手入力識別情報。メールアドレスとは別物。南HILSルームのみ）
    const tdAddress = document.createElement('td');
    tdAddress.className = 'address-col';
    tdAddress.title     = isAdmin ? 'アドレス（ダブルクリックで編集）' : 'アドレス';
    tdAddress.textContent = state.addresses[machine] || '';

    if (isAdmin) {
      tdAddress.addEventListener('dblclick', () => {
        const currentVal   = state.addresses[machine] || '';
        const addressInput = document.createElement('input');
        addressInput.type      = 'text';
        addressInput.value     = currentVal;
        addressInput.className = 'address-edit-input';
        tdAddress.textContent   = '';
        tdAddress.appendChild(addressInput);
        addressInput.focus();
        addressInput.select();

        function commitAddress() {
          const newVal = addressInput.value.trim();
          if (newVal !== currentVal) {
            if (newVal) {
              state.addresses[machine] = newVal;
            } else {
              delete state.addresses[machine];
            }
            saveAddresses();
          }
          renderCalendar();
        }

        addressInput.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { addressInput.blur(); }
          if (e.key === 'Escape') { renderCalendar(); }
        });
        addressInput.addEventListener('blur', commitAddress);
      });
    }

    // 改修: 列順入れ替え（アドレス→筐体→担当者）。アドレス列を筐体列より先にDOM追加する
    tr.appendChild(tdAddress);
    tr.appendChild(tdMachine);

    // 担当者セル
    const tdAssignee = document.createElement('td');
    tdAssignee.className = 'assignee-col';
    tdAssignee.title     = isAdmin ? '担当者（ダブルクリックで編集）' : '担当者';
    tdAssignee.textContent = state.assignees[machine] || '';

    if (isAdmin) {
      tdAssignee.addEventListener('dblclick', () => {
        const currentVal    = state.assignees[machine] || '';
        const assigneeInput = document.createElement('input');
        assigneeInput.type      = 'text';
        assigneeInput.value     = currentVal;
        assigneeInput.className = 'assignee-edit-input';
        tdAssignee.textContent  = '';
        tdAssignee.appendChild(assigneeInput);
        assigneeInput.focus();
        assigneeInput.select();

        function commitAssignee() {
          const newVal = assigneeInput.value.trim();
          if (newVal !== currentVal) {
            if (newVal) {
              state.assignees[machine] = newVal;
            } else {
              delete state.assignees[machine];
            }
            saveAssignees();
          }
          renderCalendar();
        }

        assigneeInput.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { assigneeInput.blur(); }
          if (e.key === 'Escape') { renderCalendar(); }
        });
        assigneeInput.addEventListener('blur', commitAssignee);
      });
    }

    tr.appendChild(tdAssignee);

    // 改修(第7回): 全表示期間の列（totalCols）を描画
    for (let col = 0; col < totalCols; col++) {
      const d     = viewDates[col];
      const wday  = d.getDay();
      const isWkd = (wday === 0 || wday === 6);
      const isTod = d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD;
      const cellKey = `${rowIdx}-${col}`;
      const resInfo = resCells[machine]?.[col];

      const td = document.createElement('td');
      let cls = 'gantt-cell';
      if (isWkd) cls += ' weekend';
      if (isTod) cls += ' today-cell';
      if (selectedCells.has(cellKey)) cls += ' selected';
      if (resInfo && selectedResId === resInfo.resId) cls += ' res-selected';
      td.className = cls;
      td.dataset.row = rowIdx;
      td.dataset.col = col;

      if (resInfo) {
        const isGhost = ghostKeys.has(cellKey);
        if (isGhost) {
          td.style.backgroundColor = resInfo.color;
          td.classList.add('drag-ghost');
        } else {
          td.style.backgroundColor = resInfo.color;
        }
        td.dataset.resId = resInfo.resId;
        td.classList.add('res-cell');

        if (resInfo.isStart) td.classList.add('res-edge-left');
        if (resInfo.isEnd)   td.classList.add('res-edge-right');
        if (resInfo.status === 'spare')   td.classList.add('res-spare');
        if (resInfo.status === 'fault')   td.classList.add('res-fault');
        if (resInfo.status === 'holiday') td.classList.add('res-holiday');
        const sameLeft  = resCells[machine]?.[col - 1]?.resId === resInfo.resId;
        const sameRight = resCells[machine]?.[col + 1]?.resId === resInfo.resId;
        if (sameRight)  td.classList.add('res-join-right');
        if (!sameLeft)  td.classList.add('res-seg-left');
        if (!sameRight) td.classList.add('res-seg-right');

        if (resInfo.isStart && resInfo.status !== 'holiday') {
          let text;
          if (resInfo.status === 'spare')      text = STATUS_SPARE_TEXT;
          else if (resInfo.status === 'fault') text = STATUS_FAULT_TEXT;
          else text = resInfo.applicant ? `${resInfo.applicant}）${resInfo.label}` : resInfo.label;

          const labelEl = document.createElement('span');
          labelEl.className = 'res-label';

          const legName   = (_legend.find(l => l.id === resInfo.legendId) || {}).name || '';
          const isXpxLink = resInfo.status === 'normal' && isXpxLinkLegend(legName);
          if (isXpxLink) {
            const a = document.createElement('a');
            a.className = 'res-label-link';
            a.href = XPX_LINK_URL; a.target = '_blank'; a.rel = 'noopener';
            a.title = 'Ctrl＋クリックでPowerAppsを開く';
            a.textContent = text;
            a.addEventListener('mousedown', ev => {
              if (ev.ctrlKey || ev.metaKey) ev.stopPropagation();
            });
            a.addEventListener('click', ev => {
              if (ev.ctrlKey || ev.metaKey) ev.stopPropagation();
              else ev.preventDefault();
            });
            labelEl.appendChild(a);
          } else {
            labelEl.textContent = text;
          }
          td.appendChild(labelEl);

          // 改修(第8回): 検証完了★をlabelEl内に絶対配置（開始セルと同じz-indexコンテキストになるため選択時も全★が表示される）
          (resInfo.resMarks || []).forEach(mk => {
            const mkCol = dateToCol(isoToDate(mk.date));
            if (mkCol === null || mkCol < col) return;  // 表示範囲外・開始より前はスキップ
            const mkSpan = document.createElement('span');
            mkSpan.className   = 'res-mark';
            mkSpan.textContent = markStarText(mk); // 改修(第9回): 検証名手動編集対応（名前＋★で表示）
            // 完了日セル右端を基点に右→左でテキストを配置（★が右端に来る）
            // 改修(第7回追補5): 列幅ハードコード26→CSS変数に変更（31日フィットで列幅が変動するため）
            // calc(9999px - 列数 * 実列幅 + 余白3px)
            mkSpan.style.right = `calc(9999px - ${(mkCol - col + 1)} * var(--date-col-w, 26px) + 3px)`;
            labelEl.appendChild(mkSpan);
          });
        }

        if (resInfo.isEnd && resInfo.remark) {
          const remarkEl = document.createElement('span');
          remarkEl.className   = 'res-remark';
          remarkEl.textContent = resInfo.remark;
          td.appendChild(remarkEl);
        }

        if (isAdmin) {
          td.addEventListener('mousemove', e => {
            if (_drag.active) return;
            const rect = td.getBoundingClientRect();
            const xIn  = e.clientX - rect.left;
            const isL  = resInfo.isStart && xIn < EDGE_PX;
            const isR  = resInfo.isEnd   && xIn > rect.width - EDGE_PX;
            td.style.cursor = (isL || isR) ? 'ew-resize' : 'grab';
          });
        }
        td.addEventListener('mousedown', onResMouseDown);
        td.addEventListener('click', () => {
          if (_resMoved) return;
          onResClick(resInfo.resId);
        });
        // 改修: 事務局は編集ダイアログ、使用者は閲覧専用ダイアログを開く
        td.addEventListener('dblclick', () => {
          if (isAdmin) {
            openEditDialog(resInfo.resId);
          } else {
            openViewDialog(resInfo.resId);
          }
        });
      } else if (!isWkd && isAdmin) {
        td.addEventListener('mousedown', onCellMouseDown);
        td.addEventListener('mouseover', onCellMouseOver);
      }

      // プレビュー上書き
      if (previewMap[cellKey] !== undefined) {
        td.style.backgroundColor = previewMap[cellKey];
        td.classList.add('drag-preview');
      }

      tr.appendChild(td);
    }
    return tr;
  }

  // メイン筐体行を描画
  state.machines.forEach((machine, localIdx) => {
    tbody.appendChild(buildMachineRow(machine, localIdx));
  });

  // 筐体追加行（事務局のみ）
  if (isAdmin) {
    const addTr = document.createElement('tr');
    addTr.className = 'machine-add-row';

    const addTdHeader = document.createElement('td');
    addTdHeader.className = 'machine-col';

    const addBtn = document.createElement('button');
    addBtn.className   = 'machine-add-btn';
    addBtn.textContent = '＋';
    addBtn.title       = '筐体を追加';
    addBtn.addEventListener('click', () => {
      const lastMain = state.machines[state.machines.length - 1] || '';
      const lastChar = lastMain.replace('筐体', '');
      const nextCode = lastChar.length === 1
        ? String.fromCharCode(lastChar.charCodeAt(0) + 1)
        : '';
      const defName  = nextCode ? `筐体${nextCode}` : '';
      const input    = prompt('追加する筐体名を入力してください', defName);
      if (!input || !input.trim()) return;
      const trimmed = input.trim();
      // 改修(筐体マスタ共通化): 表記ゆれ（前後空白・大小文字）を無視して重複判定する
      const trimmedNorm = normalizeMachineName(trimmed);
      if (getAllMachines().some(m => normalizeMachineName(m) === trimmedNorm)) {
        alert(`「${trimmed}」はすでに存在します。`);
        return;
      }
      state.machines.push(trimmed);
      saveMachines();
      renderCalendar();
    });
    // 改修: 列順入れ替え（アドレス→筐体→担当者）。アドレス列の空セルを筐体列より先に追加する
    const addTdAddress = document.createElement('td');
    addTdAddress.className = 'address-col machine-add-cell';
    // 改修: 筐体追加(＋)ボタンは実際に表示されている一番左の列に置く。
    // 西HILSルームはアドレス列が非表示のため筐体列に、南HILSルームはアドレス列に配置する
    if (state.currentRoom === 'south') {
      addTdAddress.appendChild(addBtn);
    } else {
      addTdHeader.appendChild(addBtn);
    }
    addTr.appendChild(addTdAddress);
    addTr.appendChild(addTdHeader);

    const addTdAssignee = document.createElement('td');
    addTdAssignee.className = 'assignee-col machine-add-cell';
    addTr.appendChild(addTdAssignee);

    // 改修(第7回): totalCols 列分の空セルを生成
    for (let col = 0; col < totalCols; col++) {
      const d     = viewDates[col];
      const wday  = d.getDay();
      const isWkd = (wday === 0 || wday === 6);
      const addTd = document.createElement('td');
      addTd.className = 'gantt-cell machine-add-cell' + (isWkd ? ' weekend' : '');
      addTr.appendChild(addTd);
    }
    tbody.appendChild(addTr);
  }

  // 予備区切り行
  {
    const divTr = document.createElement('tr');
    divTr.className = 'spare-divider-row';
    const divTd = document.createElement('td');
    // 改修(第7回): totalCols + 機種名列 + 担当者列
    divTd.colSpan = totalCols + 2;
    divTr.appendChild(divTd);
    tbody.appendChild(divTr);
  }

  // 予備行を描画
  state.spares.forEach((machine, localIdx) => {
    const rowIdx = state.machines.length + localIdx;
    tbody.appendChild(buildMachineRow(machine, rowIdx));
  });

  // 改修(第7回追補4): thead・tbody 構築後に呼ぶことで
  // --date-col-w（31日フィット幅）・テーブル確定幅・--assignee-left（担当者列位置）を
  // 初回表示から正しく設定する（thead 構築前に呼ぶと machineTh が null になる問題を解消）
  applyDateColWidth();
}

// ────────────────────────────────────────────
// 予約ドラッグ（移動 / リサイズ）
// ────────────────────────────────────────────
let _resMoved = false;
const _drag = {
  active:       false,
  mode:         null,   // 'move' | 'rs' | 're'
  resId:        null,
  origRow:      null,
  origStart:    null,
  origEnd:      null,
  origBiz:      0,
  clickCol:     null,
  previewCells: null,
  ghostCells:   null,
  newStart:     null,
  newEnd:       null,
  newRow:       null,
  didMove:      false,
};

function onResMouseDown(e) {
  if (!isAdmin) return;
  if (e.button !== 0) return;
  _resMoved = false;
  e.preventDefault();
  e.stopPropagation();

  const td    = e.currentTarget;
  const resId = parseInt(td.dataset.resId);
  const col   = parseInt(td.dataset.col);
  const row   = parseInt(td.dataset.row);
  const res   = state.reservations[resId];
  if (!res) return;
  // 改修(案件跨ぎ誤操作防止): 別案件で登録された予約はドラッグでの移動・期間変更をさせない
  if (isForeignCaseReservation(res)) {
    alertForeignCaseReservation(res);
    return;
  }

  const rect  = td.getBoundingClientRect();
  const xIn   = e.clientX - rect.left;
  const isL   = td.classList.contains('res-edge-left')  && xIn < EDGE_PX;
  const isR   = td.classList.contains('res-edge-right') && xIn > rect.width - EDGE_PX;
  const mode  = isL ? 'rs' : isR ? 're' : 'move';

  const origStart = isoToDate(res.start);
  const origEnd   = isoToDate(res.end);

  _drag.active       = true;
  _drag.mode         = mode;
  _drag.resId        = resId;
  _drag.origRow      = row;
  _drag.origStart    = origStart;
  _drag.origEnd      = origEnd;
  _drag.origBiz      = bizDaysBetween(origStart, origEnd);
  _drag.clickCol     = col;
  _drag.previewCells = null;
  _drag.ghostCells   = null;
  _drag.newStart     = null;
  _drag.newEnd       = null;
  _drag.newRow       = null;
  _drag.didMove      = false;

  document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';

  state.selectedResId = resId;
  state.selectedCells = new Set();
}

document.addEventListener('mousemove', onDragResMove);
document.addEventListener('mouseup',   onDragResUp);

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const td = el.closest('td[data-row]');
  if (!td) return null;
  return { row: parseInt(td.dataset.row), col: parseInt(td.dataset.col) };
}

function nearestWeekday(date, forward) {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + (forward ? 1 : -1));
  }
  return d;
}

// 改修(第7回): viewDates 基準に全面変更・MAX_BIZ_DAYS クランプを撤廃
function onDragResMove(e) {
  if (!_drag.active) return;

  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) return;

  const viewDates  = state.viewDates;
  const totalCols  = viewDates.length;
  const { mode, resId, origRow, origStart, origEnd, origBiz, clickCol } = _drag;
  const res       = state.reservations[resId];
  if (!res) return;

  const curRow = cell.row;
  // 改修(第7回): curCol を viewDates の範囲にクランプ
  const curCol  = Math.max(0, Math.min(cell.col, totalCols - 1));
  const curDate = viewDates[curCol];

  let newStart = new Date(origStart);
  let newEnd   = new Date(origEnd);
  let newRow   = origRow;

  if (mode === 'move') {
    // 改修(第7回): 元の開始列を dateToCol で求める（範囲外は端点にクランプ）
    let origDispCol = dateToCol(origStart);
    if (origDispCol === null) {
      origDispCol = origStart < state.viewStart ? 0 : totalCols - 1;
    }
    const offset = clickCol - origDispCol;
    const nsCol  = Math.max(0, Math.min(curCol - offset, totalCols - 1));
    const ns     = nearestWeekday(new Date(viewDates[nsCol]), true);
    // 改修(第7回): MAX_BIZ_DAYS クランプ撤廃。元の営業日数をそのまま適用
    const ne     = addBizDays(ns, origBiz);
    newStart     = ns;
    newEnd       = ne;
    newRow       = curRow;
  } else if (mode === 're') {
    let ne = nearestWeekday(curDate, false);
    if (ne < origStart) ne = nearestWeekday(new Date(origStart), true);
    // 改修(第7回): MAX_BIZ_DAYS による再クランプ撤廃
    newStart = new Date(origStart);
    newEnd   = ne;
    newRow   = origRow;
  } else if (mode === 'rs') {
    let ns = nearestWeekday(curDate, true);
    if (ns > origEnd) ns = nearestWeekday(new Date(origEnd), false);
    // 改修(第7回): MAX_BIZ_DAYS による再クランプ撤廃
    newStart = ns;
    newEnd   = new Date(origEnd);
    newRow   = origRow;
  }

  _drag.didMove  = true;
  _drag.newStart = newStart;
  _drag.newEnd   = newEnd;
  _drag.newRow   = newRow;

  // 改修(第7回): プレビュー/ゴーストセルを viewDates 基準で算出
  const previewCells = new Set();
  const ghostCells   = new Set();

  for (let d = new Date(newStart); d <= newEnd; d.setDate(d.getDate() + 1)) {
    const c = dateToCol(d);
    if (c !== null && d.getDay() !== 0 && d.getDay() !== 6) previewCells.add(`${newRow}-${c}`);
  }
  for (let d = new Date(origStart); d <= origEnd; d.setDate(d.getDate() + 1)) {
    const c = dateToCol(d);
    if (c !== null && d.getDay() !== 0 && d.getDay() !== 6) ghostCells.add(`${origRow}-${c}`);
  }

  _drag.previewCells = previewCells;
  _drag.ghostCells   = ghostCells;

  renderCalendar();
}

function onDragResUp() {
  if (!_drag.active) return;
  _drag.active = false;
  document.body.style.cursor = '';

  const moved = _drag.didMove;
  _resMoved   = moved;

  if (moved && _drag.newStart && _drag.newEnd) {
    const { resId, newStart, newEnd, newRow } = _drag;
    const res        = state.reservations[resId];
    const newMachine = getAllMachines()[newRow];
    if (res && !checkOverlap(resId, newMachine, newStart, newEnd)) {
      state.reservations[resId] = {
        ...res,
        machine: newMachine,
        start:   dateToIso(newStart),
        end:     dateToIso(newEnd),
      };
      saveReservations(state.reservations);
      // 改修(SP連携マージ): SP を非同期更新（楽観更新。checkOverlapはローカルで保証済み）
      const spId = state.reservations[resId].spId;
      if (spId != null) apiUpdate(spId, state.reservations[resId]);
    }
  }

  _drag.previewCells = null;
  _drag.ghostCells   = null;
  _drag.newStart     = null;
  _drag.newEnd       = null;
  _drag.didMove      = false;

  if (moved) {
    updateInfoPanel();
    renderCalendar();
  }
}

function checkOverlap(excludeResId, machine, ns, ne) {
  return state.reservations.some((res, idx) => {
    if (idx === excludeResId) return false;
    if (res.machine !== machine) return false;
    const rs = isoToDate(res.start);
    const re = isoToDate(res.end);
    return !(ne < rs || ns > re);
  });
}

// ────────────────────────────────────────────
// セル範囲ドラッグ（新規選択用）
// ────────────────────────────────────────────
let _isDragging        = false;
let _reclickCandidate  = false;
let _dragMoved         = false;

function onCellMouseDown(e) {
  if (_drag.active) return;
  const td  = e.currentTarget;
  const row = parseInt(td.dataset.row);
  const col = parseInt(td.dataset.col);

  _reclickCandidate = state.selectedCells.has(`${row}-${col}`);
  _dragMoved        = false;

  _isDragging = true;

  state.selectedResId = null;
  state.selectedCells = new Set([`${row}-${col}`]);
  state.anchorCell    = { row, col };

  updateInfoPanel();
  renderCalendar();
}

// 改修(第7回): 曜日判定を viewDates[c] から取得
// 改修: 統合HILS利用時にSCLX+HELIOS等を同時予約できるよう、行ロックを撤廃し
// アンカー行〜現在行 × アンカー列〜現在列の矩形範囲（複数筐体をまたぐ範囲）を選択対象にする
function onCellMouseOver(e) {
  if (!_isDragging || !state.anchorCell) return;
  const td  = e.currentTarget;
  const row = parseInt(td.dataset.row);
  const col = parseInt(td.dataset.col);

  const anchor = state.anchorCell;
  if (row !== anchor.row || col !== anchor.col) _dragMoved = true;

  const minCol = Math.min(anchor.col, col);
  const maxCol = Math.max(anchor.col, col);
  const minRow = Math.min(anchor.row, row);
  const maxRow = Math.max(anchor.row, row);

  state.selectedCells = new Set();
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      // 改修(第7回): 曜日判定を viewDates[c].getDay() で直接取得
      const wday = state.viewDates[c].getDay();
      if (wday !== 0 && wday !== 6) state.selectedCells.add(`${r}-${c}`);
    }
  }
  renderCalendar();

  // 改修: 登録フォーム表示中は選択範囲の開始日・終了日をリアルタイムで反映
  if (state.formMode === 'register') {
    const startEl = document.getElementById('f-start');
    const endEl   = document.getElementById('f-end');
    if (startEl && endEl && state.viewDates[minCol] && state.viewDates[maxCol]) {
      // ISO日付文字列(YYYY-MM-DD)に変換してフォームへ反映
      const toIso = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };
      startEl.value = toIso(state.viewDates[minCol]);
      endEl.value   = toIso(state.viewDates[maxCol]);
      // 改修: 日付変更イベントを発火させて営業日数・警告表示を更新
      startEl.dispatchEvent(new Event('change'));
    }
  }
}

document.addEventListener('mouseup', () => {
  if (_reclickCandidate && !_dragMoved) {
    clearSelection();
    renderCalendar();
  }
  _isDragging       = false;
  _reclickCandidate = false;
  _dragMoved        = false;
});

function onResClick(resId) {
  state.selectedResId = resId;
  state.selectedCells = new Set();
  state.anchorCell    = null;
  updateInfoPanel();
  applyResSelectionHighlight(resId);
}

function applyResSelectionHighlight(resId) {
  const table = document.getElementById('gantt-table');
  if (!table) return;
  table.querySelectorAll('.gantt-cell.selected, .gantt-cell.res-selected')
       .forEach(td => td.classList.remove('selected', 'res-selected'));
  table.querySelectorAll(`.gantt-cell[data-res-id="${resId}"]`)
       .forEach(td => td.classList.add('res-selected'));
}

// ────────────────────────────────────────────
// 選択情報パネル
// ────────────────────────────────────────────
function updateInfoPanel() {
  const { selectedResId, reservations } = state;
  const hint      = document.getElementById('info-hint');
  const machine   = document.getElementById('info-machine');
  const period    = document.getElementById('info-period');
  const label     = document.getElementById('info-label');
  const applicant  = document.getElementById('info-applicant');
  // 改修(マージ): 削除ボタンをダイアログ内へ移設・XPX受領ボタン撤去のため参照を削除
  const extendBtn    = document.getElementById('info-extend-btn');
  // 改修: 利用取消依頼ボタン（使用者モード・予約選択時に表示）
  const cancelBtn    = document.getElementById('info-cancel-btn');
  // 改修: 利用終了報告ボタン（使用者モード・予約選択時に表示）
  const reportBtn    = document.getElementById('info-report-btn');

  if (selectedResId === null || !reservations[selectedResId]) {
    hint.classList.remove('hidden');
    [machine, period, label, applicant, extendBtn, cancelBtn, reportBtn].forEach(el => el.classList.add('hidden'));
    return;
  }

  const res   = reservations[selectedResId];
  const start = isoToDate(res.start);
  const end   = isoToDate(res.end);
  const biz   = bizDaysBetween(start, end);

  let periodStr;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    periodStr = `${start.getMonth()+1}月${start.getDate()}日〜${end.getDate()}日`;
  } else {
    periodStr = `${start.getMonth()+1}月${start.getDate()}日〜${end.getMonth()+1}月${end.getDate()}日`;
  }

  hint.classList.add('hidden');
  [machine, period, label].forEach(el => el.classList.remove('hidden'));
  // 改修(マージ): 削除ボタンはダイアログ内のため情報パネルからは表示制御不要
  // 改修: 期間変更申請・利用取消依頼・利用終了報告は使用者モードのみ表示
  if (!isAdmin) {
    extendBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    reportBtn.classList.remove('hidden');    // 改修: 利用終了報告（使用者モード）
  } else {
    extendBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    reportBtn.classList.add('hidden');
  }
  machine.textContent = `筐体:  ${res.machine}`;
  period.textContent  = `期間:  ${periodStr}  （${biz}営業日）`;
  const statusLabel = res.status === 'spare'   ? STATUS_SPARE_TEXT
                    : res.status === 'fault'   ? STATUS_FAULT_TEXT
                    : res.status === 'holiday' ? '休日'
                    : (res.label || '');
  const resLeg = _legend.find(l => l.id === res.legendId);
  if (resLeg && isXpxLinkLegend(resLeg.name) && res.status === 'normal' && res.label) {
    label.textContent = 'ラベル:  ';
    const infoA = document.createElement('a');
    infoA.className = 'info-label-link';
    infoA.href      = XPX_LINK_URL;
    infoA.target    = '_blank';
    infoA.rel       = 'noopener';
    infoA.textContent = res.label;
    label.appendChild(infoA);
  } else {
    label.textContent = `ラベル:  ${statusLabel}`;
  }

  if (res.applicant) {
    applicant.textContent = `申請者:  ${res.applicant}`;
    applicant.classList.remove('hidden');
  } else {
    applicant.classList.add('hidden');
  }
}

// ────────────────────────────────────────────
// 改修(第7回): 月ナビ → スクロール移動化
// ────────────────────────────────────────────

// sticky固定列の合計幅を返す
function getStickyWidth(wrapper) {
  const mc = wrapper.querySelector('th.machine-col');
  // 改修: アドレス列（筐体列と担当者列の間、南HILSルームのみ表示）もsticky幅に加算
  const adc = wrapper.querySelector('th.address-col');
  const ac = wrapper.querySelector('th.assignee-col');
  return (mc ? mc.offsetWidth : 170) + (adc ? adc.offsetWidth : 0) + (ac ? ac.offsetWidth : 80);
}

// 指定日付の列が gantt-wrapper の左端（sticky列の右側）に来るよう水平スクロール
function scrollToDate(date) {
  const col = dateToCol(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
  if (col === null) return;
  const wrapper = document.querySelector('.gantt-wrapper');
  if (!wrapper) return;
  const th = wrapper.querySelector(`thead th[data-col="${col}"]`);
  if (!th) return;
  const thAbsLeft  = th.getBoundingClientRect().left + wrapper.scrollLeft - wrapper.getBoundingClientRect().left;
  const stickyW    = getStickyWidth(wrapper);
  wrapper.scrollLeft = Math.max(0, thAbsLeft - stickyW);
}

// 現在スクロール位置でsticky列の右端に最も近い列インデックスを返す
function getVisibleStartCol() {
  const wrapper = document.querySelector('.gantt-wrapper');
  if (!wrapper) return 0;
  const stickyW    = getStickyWidth(wrapper);
  const wrapperLeft = wrapper.getBoundingClientRect().left;
  const boundary   = wrapperLeft + stickyW;
  const ths = [...wrapper.querySelectorAll('thead th[data-col]')];
  for (const th of ths) {
    if (th.getBoundingClientRect().left >= boundary) return parseInt(th.dataset.col);
  }
  return state.viewDates.length > 0 ? state.viewDates.length - 1 : 0;
}

// 改修(第7回追補): 日付列幅を動的に計算して CSS変数と colgroup に反映する
// ウィンドウ幅 / 担当者列表示状態が変わるたびに呼び出す
function applyDateColWidth() {
  const table   = document.getElementById('gantt-table');
  const wrapper = document.querySelector('.gantt-wrapper');
  if (!table || !wrapper) return;
  // 改修: アドレス列（南HILSルームのみ表示）の幅も加算対象に追加
  const addressW  = table.classList.contains('address-hidden') ? 0 : 80;
  const assigneeW = table.classList.contains('assignee-hidden') ? 0 : 80;
  const machineW  = 170;
  const avail     = wrapper.clientWidth - machineW - addressW - assigneeW;
  const w         = Math.max(DATE_COL_MIN, Math.floor(avail / 31));
  // CSS変数に設定（th.date-col / td.gantt-cell が参照）
  table.style.setProperty('--date-col-w', w + 'px');
  // colgroup の col.col-date 幅も同期更新
  table.querySelectorAll('col.col-date').forEach(col => { col.style.width = w + 'px'; });
  // 改修(第7回追補4): table-layout:fixed は確定幅がないと自動レイアウトにフォールバックする
  // テーブル全体の px 幅を設定して fixed レイアウトを発火させる
  // これにより colgroup 幅が厳密に反映され、日付ヘッダと予約バーの列ズレが解消する
  const totalDateCols = state.viewDates ? state.viewDates.length : 0;
  table.style.width = (machineW + addressW + assigneeW + totalDateCols * w) + 'px';
  // 改修(第7回追補2): 担当者列 sticky left を筐体列の実描画幅に追従させる
  // ハードコードの left:169px がずれた場合でも隙間なく密着させるための恒久対策
  // 改修: 列順入れ替え（アドレス→筐体→担当者）。筐体列はアドレス列の実描画幅（非表示時は0）に追従させる
  const machineTh = table.querySelector('thead th.machine-col');
  const addressTh = table.querySelector('thead th.address-col');
  if (addressTh) table.style.setProperty('--machine-left', addressTh.offsetWidth + 'px');
  if (machineTh) {
    // 改修: 担当者列 sticky left は「アドレス列幅（非表示時は0）＋筐体列幅」に追従させる（列の並び順が変わっても合計幅は不変）
    const addressOffsetW = addressTh ? addressTh.offsetWidth : 0;
    table.style.setProperty('--assignee-left', (machineTh.offsetWidth + addressOffsetW) + 'px');
  }
}

// 改修(第7回): 前月ボタン → 現在表示月の前の月初へスクロール
document.getElementById('prev-btn').addEventListener('click', () => {
  const col = getVisibleStartCol();
  const d   = state.viewDates[col];
  if (!d) return;
  scrollToDate(new Date(d.getFullYear(), d.getMonth() - 1, 1));
});
// 改修(第7回): 次月ボタン → 現在表示月の次の月初へスクロール
document.getElementById('next-btn').addEventListener('click', () => {
  const col = getVisibleStartCol();
  const d   = state.viewDates[col];
  if (!d) return;
  scrollToDate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
});
// 改修(第7回): 今月ボタン → 今日の列へスクロール
document.getElementById('today-btn').addEventListener('click', () => {
  scrollToDate(new Date());
});

function clearSelection() {
  state.selectedCells = new Set();
  state.selectedResId = null;
  state.anchorCell    = null;
  updateInfoPanel();
}

document.addEventListener('mousedown', e => {
  if (!state.selectedCells.size && state.selectedResId === null) return;
  const inCell    = e.target.closest('.gantt-cell');
  const inInfo    = e.target.closest('#info-panel');
  const inReg     = e.target.closest('#register-btn');
  // 改修: モーダル廃止に伴い、サイドパネル内クリックでも選択を維持
  const inDialog  = e.target.closest('#side-panel');
  if (!inCell && !inInfo && !inReg && !inDialog) {
    clearSelection();
    renderCalendar();
  }
}, true);

// ────────────────────────────────────────────
// ページナビ
// ────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });
  });
});

// 改修(第4回): ルーム切替プルダウンの change ハンドラ
document.getElementById('room-select').addEventListener('change', e => {
  const room = e.target.value;
  if (room === state.currentRoom) return;
  state.currentRoom = room;
  syncRoomViews();
  // 改修: アドレス列は南HILSルームのみ表示（renderCalendar前にクラスを確定させる）
  applyAddressVisibility(room);
  // 改修: 担当者列は南HILSルームでは不要のため列自体を非表示にする（renderCalendar前にクラスを確定させる）
  applyAssigneeVisibilityForRoom(room);
  clearSelection();
  renderCalendar();
});

// 改修: 担当者列チェックボックスの change ハンドラ
document.getElementById('assignee-visible-chk').addEventListener('change', e => {
  // 改修: 南HILSルームでは担当者列自体が不要なため、チェックボックス操作を無効化している（保険として再度ガード）
  if (state.currentRoom === 'south') return;
  const visible = e.target.checked;
  localStorage.setItem(ASSIGNEE_VISIBLE_KEY, JSON.stringify(visible));
  applyAssigneeVisibility(visible);
  // 改修(第7回追補): 担当者列の表示/非表示で有効幅が変わるため列幅を再計算
  applyDateColWidth();
});

// ────────────────────────────────────────────
// 凡例パネル
// ────────────────────────────────────────────
function renderLegendPanel() {
  const panel = document.getElementById('legend-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="legend-title">凡例</div>';

  _legend.forEach((leg, idx) => {
    const row = document.createElement('div');
    row.className = 'legend-row';

    const swatch = document.createElement('div');
    swatch.className = 'legend-swatch';
    swatch.style.background = leg.color;
    if (isAdmin) {
      swatch.title = '色を変更';
      swatch.addEventListener('click', e => {
        e.stopPropagation();
        openColorPicker(swatch, idx);
      });
    }
    row.appendChild(swatch);

    if (isAdmin) {
      const nameInput = document.createElement('input');
      nameInput.type      = 'text';
      nameInput.className = 'legend-name-input';
      nameInput.value     = leg.name;
      nameInput.addEventListener('change', () => {
        _legend[idx].name = nameInput.value.trim() || _legend[idx].name;
        saveLegend(_legend);
      });
      row.appendChild(nameInput);

      const delBtn = document.createElement('button');
      delBtn.className   = 'legend-del-btn';
      delBtn.textContent = '×';
      delBtn.title       = '削除';
      delBtn.addEventListener('click', () => {
        _legend.splice(idx, 1);
        saveLegend(_legend);
        renderLegendPanel();
        renderCalendar();
      });
      row.appendChild(delBtn);
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className   = 'legend-name-input';
      nameSpan.textContent = leg.name;
      row.appendChild(nameSpan);
    }

    panel.appendChild(row);
  });

  if (isAdmin) {
    const addBtn = document.createElement('button');
    addBtn.className   = 'legend-add-btn';
    addBtn.textContent = '＋ 凡例追加';
    addBtn.addEventListener('click', () => {
      const color = pickUnusedPaletteColor() || LEGEND_PALETTE[0];
      _legend.push({ id: genLegendId(), name: '新しい凡例', color });
      saveLegend(_legend);
      renderLegendPanel();
    });
    panel.appendChild(addBtn);
  }
}

// カラーパレットポップオーバー
let _activePopover = null;

function openColorPicker(anchorEl, legendIdx) {
  closeColorPicker();
  const pop = document.createElement('div');
  pop.className = 'color-popover';

  const used = getUsedLegendColors(legendIdx);

  function applyLegendColor(hex) {
    _legend[legendIdx].color = hex;
    saveLegend(_legend);
    closeColorPicker();
    renderLegendPanel();
    renderCalendar();
  }

  LEGEND_PALETTE.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'palette-swatch';
    sw.style.background = hex;
    const isSelf = _legend[legendIdx] && _legend[legendIdx].color.toLowerCase() === hex.toLowerCase();
    const isUsed = used.has(hex.toLowerCase());
    if (isSelf) sw.classList.add('palette-selected');
    if (isUsed) {
      sw.classList.add('palette-used');
      sw.title = hex + '（使用中）';
    } else {
      sw.title = hex;
      sw.addEventListener('click', e => { e.stopPropagation(); applyLegendColor(hex); });
    }
    pop.appendChild(sw);
  });

  const custom = document.createElement('input');
  custom.type  = 'color';
  custom.className = 'palette-custom';
  custom.value = (_legend[legendIdx] ? _legend[legendIdx].color : LEGEND_PALETTE[0]);
  custom.title = '任意色を入力';
  custom.addEventListener('click', e => e.stopPropagation());
  custom.addEventListener('change', e => {
    const hex = e.target.value;
    if (used.has(hex.toLowerCase())) {
      alert('その色は他の凡例で使用中です。別の色を選んでください。');
      return;
    }
    applyLegendColor(hex);
  });
  pop.appendChild(custom);

  anchorEl.parentElement.appendChild(pop);
  _activePopover = pop;
  setTimeout(() => {
    document.addEventListener('click', closeColorPicker, { once: true });
  }, 0);
}

function closeColorPicker() {
  if (_activePopover) { _activePopover.remove(); _activePopover = null; }
}

// ────────────────────────────────────────────
// 登録・編集ダイアログ
// ────────────────────────────────────────────
document.getElementById('register-btn').addEventListener('click', openRegisterDialog);

// 改修(マージ): info-delete-btn は撤去のためリスナ削除

document.getElementById('info-extend-btn').addEventListener('click', () => {
  // 改修: モーダル(extend-overlay)廃止→サイドパネル(extend-pane)に差し替え
  const res = state.reservations[state.selectedResId];
  // 改修(第7回): 開始日・終了日の両方を現在値で初期化
  if (res) {
    document.getElementById('ext-start').value = res.start.split('T')[0];
    document.getElementById('ext-end').value   = res.end.split('T')[0];
  }
  document.getElementById('ext-reason').value = '';
  // 改修: form-pane・cancel-pane・プレースホルダを排他非表示にしてextend-paneを表示
  document.getElementById('form-pane').classList.add('hidden');
  document.getElementById('cancel-pane').classList.add('hidden');
  document.getElementById('form-empty').classList.add('hidden');
  document.getElementById('extend-pane').classList.remove('hidden');
  state.formMode = null;  // 改修: 期間変更申請中は日付自動連動を無効
});

// 改修(第14回): async に変更（await sendMail 等を使用するため）
document.getElementById('ext-ok').addEventListener('click', async () => {
  const startVal  = document.getElementById('ext-start').value;
  const endVal    = document.getElementById('ext-end').value;
  const reasonVal = document.getElementById('ext-reason').value.trim();
  if (!reasonVal) {
    alert('変更理由を入力してください');
    return;
  }
  // 改修(第7回): 開始日が終了日より後の場合はエラー
  if (startVal && endVal && startVal > endVal) {
    alert('変更後終了日が変更後開始日より前です');
    return;
  }
  // 改修(第14回): 希望終了日・申請理由をSPにPATCH＋ステータスを9.期間変更申請中に更新＋PMO通知 W-10
  const extId = state.actionItemId;  // 第12回で保持したSP内部ID
  showBusy('期間変更申請を送信中...');  // 改修: 処理中オーバーレイ表示
  try {
    if (extId) {
      // ① アクションリストへ期間変更申請データをPATCH
      await fetch(`/api/action-item/${extId}/extend`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ newStart: startVal, newEnd: endVal, reason: reasonVal }),
      });
      // 改修: 1案件=1予約ガード用に現在ステータスを追従（サーバ側でステータスを9.期間変更申請中に更新）
      state.actionStatus = '9.期間変更申請中';
    }
    // ② PMOへ期間変更申請通知メール（改修(メール文面): 提案資料⑤に合わせて件名・本文を更新）
    const curRes     = state.actionHilsRes || (state.selectedResId != null ? state.reservations[state.selectedResId] : null);
    const extMachine = curRes?.machine || '';
    const curStart   = curRes?.start   || '';
    const curEnd     = curRes?.end     || '';
    // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
    const _group = getGroupMailInfo(curRes);
    await sendMail(
      mailConfig.pmoTo,
      buildMailSubject('期間変更申請の通知', extMachine, resolveMailAddress(extMachine), _group.count),
      `PMO ご担当者 様\n\n` +
      `下記予約について、申請者より期間変更の申請がありました。\n\n` +
      `■対象予約\n` +
      ` 予約ID  : ${state.actionTitleId}\n` +
      ` 筐体名  : ${extMachine}\n` +
      _group.note +
      (curStart || curEnd ? ` 現在の期間: ${curStart} 〜 ${curEnd}\n` : '') +
      `\n■申請された貸出期間\n` +
      ` 変更後期間: ${startVal || curStart} 〜 ${endVal}\n` +
      `\n■変更理由\n` +
      ` ${reasonVal}` +
      mailSignature(),
      mailConfig.pmoCc
    );
    setStatus('期間変更申請を送信しました。PMOへ通知しました。');
    // 改修: extend-paneを閉じてプレースホルダを表示
    closeFormPane();
  } catch (e) {
    console.error('期間変更申請エラー:', e);
    setStatus('期間変更申請の送信に失敗しました', 'red');
  } finally {
    hideBusy();  // 改修: 処理中オーバーレイ解除
  }
});
document.getElementById('ext-cancel').addEventListener('click', () => {
  // 改修: extend-paneを閉じてプレースホルダを表示
  closeFormPane();
});

// 改修(マージ): info-xpx-btn は撤去のためリスナ削除

// 改修: 利用取消依頼ボタン — cancel-paneを開いて取消理由の入力を求める（送信処理はcancel-ok側）
// ステータスは変更しない。ステータス遷移は事務局が予約を削除したタイミングに移した（deleteReservation参照）
document.getElementById('info-cancel-btn').addEventListener('click', () => {
  document.getElementById('cancel-reason').value = '';
  // 改修: form-pane・extend-pane・プレースホルダを排他非表示にしてcancel-paneを表示
  document.getElementById('form-pane').classList.add('hidden');
  document.getElementById('extend-pane').classList.add('hidden');
  document.getElementById('form-empty').classList.add('hidden');
  document.getElementById('cancel-pane').classList.remove('hidden');
  state.formMode = null;
});

// 改修: 利用取消依頼「依頼」ボタン — 取消理由を事務局アクションリストへ記録＋PMOへ通知メール送信
// （期間変更申請と同様に理由を残す。ステータスはここでは変更しない）
document.getElementById('cancel-ok').addEventListener('click', async () => {
  const cancelReason = document.getElementById('cancel-reason').value.trim();
  if (!cancelReason) {
    alert('取消理由を入力してください');
    return;
  }
  const cancelRes     = state.selectedResId != null ? state.reservations[state.selectedResId] : null;
  const cancelMachine = cancelRes?.machine || '';
  showBusy('利用取消依頼を送信中...');  // 改修: 処理中オーバーレイ表示
  try {
    // ① 取消理由を事務局アクションリストへ記録（ステータスは変更しない）
    if (state.actionItemId) {
      await fetch(`/api/action-item/${state.actionItemId}/cancel`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: cancelReason }),
      });
    }
    // ② PMOへ利用取消依頼通知メール送信（本文に取消理由を必ず記載）
    // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
    const _group = getGroupMailInfo(cancelRes);
    await sendMail(
      mailConfig.pmoTo,
      buildMailSubject('利用取消依頼の通知', cancelMachine, resolveMailAddress(cancelMachine), _group.count),
      `PMO ご担当者 様\n\n` +
      `下記予約について、申請者より利用取消の依頼がありました。\n\n` +
      `■対象予約\n` +
      ` 予約ID  : ${state.actionTitleId}\n` +
      ` 筐体名  : ${cancelMachine}\n` +
      _group.note +
      (cancelRes ? ` 現在の貸出期間: ${cancelRes.start} 〜 ${cancelRes.end}\n` : '') +
      `\n■取消理由\n` +
      ` ${cancelReason}\n` +
      mailSignature(),
      mailConfig.pmoCc
    );
    setStatus('利用取消依頼を送信しました。PMOへ通知しました。');
    closeFormPane();
  } catch (e) {
    console.error('利用取消依頼エラー:', e);
    setStatus('利用取消依頼の送信に失敗しました', 'red');
  } finally {
    hideBusy();  // 改修: 処理中オーバーレイ解除
  }
});

// 改修: 利用取消依頼「キャンセル」ボタン
document.getElementById('cancel-cancel').addEventListener('click', () => {
  closeFormPane();
});

// 改修(第15回): 利用終了報告ボタンのクリックハンドラ（使用者モード）W-17
// 事務局へ利用終了報告メールを送信する
document.getElementById('info-report-btn').addEventListener('click', async () => {
  if (!confirm('この予約の利用終了を報告しますか？')) return;
  // 選択中の予約（state.selectedResId はインデックス）
  const reportRes = state.selectedResId != null ? state.reservations[state.selectedResId] : null;
  showBusy('利用終了報告を送信中...');  // 改修: 処理中オーバーレイ表示
  try {
    // 改修(メール文面): 提案資料⑦に合わせて件名・本文を更新
    // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
    const _group = getGroupMailInfo(reportRes);
    await sendMail(
      mailConfig.pmoTo,
      buildMailSubject('利用終了報告', reportRes?.machine || '', resolveMailAddress(reportRes?.machine), _group.count),
      `PMO ご担当者 様\n\n` +
      `下記予約について、使用者より利用終了の報告がありました。\n` +
      `HILSの初期状態復帰の確認をお願いします。\n\n` +
      `■対象予約\n` +
      ` 予約ID  : ${state.actionTitleId}\n` +
      (reportRes
        ? ` 筐体名  : ${reportRes.machine}\n 貸出期間 : ${reportRes.start} 〜 ${reportRes.end}\n` + _group.note
        : '') +
      mailSignature(),
      mailConfig.pmoCc
    );
    setStatus('利用終了報告を送信しました。PMOへ通知しました。');
  } catch (e) {
    console.error('利用終了報告エラー:', e);
    setStatus('利用終了報告の送信に失敗しました', 'red');
  } finally {
    hideBusy();  // 改修: 処理中オーバーレイ解除
  }
});


// 改修: マニュアルボタン — ユーザー用/事務局用でリンクを分岐して新規タブで開く
const MANUAL_URL_USER  = 'https://globalhonda.sharepoint.com/:b:/r/sites/jphgt110776/Shared%20Documents/01_%E4%BA%88%E7%B4%84%E7%AE%A1%E7%90%86%E8%A1%A8/%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB/%E7%B5%B1%E5%90%88HILS%E4%BA%88%E7%B4%84%E3%82%B5%E3%82%A4%E3%83%88_%E3%83%A6%E3%83%BC%E3%82%B6%E3%83%BC%E7%94%A8%E6%93%8D%E4%BD%9C%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB.pdf?csf=1&web=1&e=j0h58j';
const MANUAL_URL_ADMIN = 'https://globalhonda.sharepoint.com/:b:/r/sites/jphgt110776/Shared%20Documents/01_%E4%BA%88%E7%B4%84%E7%AE%A1%E7%90%86%E8%A1%A8/%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB/%E7%B5%B1%E5%90%88HILS%E4%BA%88%E7%B4%84%E3%82%B5%E3%82%A4%E3%83%88_%E4%BA%8B%E5%8B%99%E5%B1%80%E7%94%A8%E6%93%8D%E4%BD%9C%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB.pdf?csf=1&web=1&e=0QUq9l';
document.getElementById('manual-btn').addEventListener('click', () => {
  window.open(isAdmin ? MANUAL_URL_ADMIN : MANUAL_URL_USER, '_blank');
});

// 改修(不具合修正): 事務局アクションリストの「承知/辞退/期間変更」列を更新する共通ヘルパー。
// fetchはHTTPエラーでも例外を投げないため、response.okを確認して呼び出し元のcatchへ失敗を伝える
// （従来はここを確認しておらず、SP書き込み失敗時も画面上は成功表示になってしまっていた）
async function patchActionAccept(itemId, acceptStatus) {
  if (!itemId) return;
  const res = await fetch(`/api/action-item/${itemId}/accept`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ acceptStatus }),
  });
  if (!res.ok) throw new Error(`承知/辞退列の更新に失敗しました（HTTP ${res.status}）`);
}

// 改修(第14回): 承知/辞退ページのボタンハンドラ — 実処理に置換（W-9）
// 変更依頼ボタン: 事務局アクションリストへ「期間変更」記録＋PMOへ予約内容変更依頼メール送信
document.getElementById('accept-change-btn').addEventListener('click', async () => {
  const reason = document.getElementById('accept-change-reason').value.trim();
  if (!reason) {
    alert('変更理由を入力してください');
    return;
  }
  // 改修(メール文面): 希望期間入力（#accept-new-start/#accept-new-end）を取得
  const newStart = document.getElementById('accept-new-start').value;
  const newEnd   = document.getElementById('accept-new-end').value;
  showBusy('変更依頼を送信中...');  // 改修: 処理中オーバーレイ表示
  try {
    // 改修(不具合修正): ①アクションリストの承知/辞退/期間変更列を「期間変更」に更新
    // （ステータス列・希望終了日・理由のSP書き込みは既存の別画面「期間変更申請」機能の範疇のため今回は行わない）
    await patchActionAccept(state.actionItemId, '期間変更');
    // ② 改修(メール文面): 提案資料②に合わせて件名・本文を更新
    const chgMachine = state.actionHilsRes?.machine || '';
    // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
    // （state.actionHilsResはSPの生データ由来の簡易オブジェクトでgroupIdを持たないため、
    //   getGroupMailInfo内部でfindFullReservationにより完全なレコードを引き直す）
    const _group = getGroupMailInfo(state.actionHilsRes);
    await sendMail(
      mailConfig.pmoTo,
      // 改修: 件名を「予約内容変更」から「日程変更」に変更（実質は使用期間の変更依頼のため）
      buildMailSubject('日程変更のご依頼', chgMachine, resolveMailAddress(chgMachine), _group.count),
      `PMO ご担当者 様\n\n` +
      `下記予約について、申請者より使用期間の変更依頼がありました。\n\n` +
      `■対象予約\n` +
      ` 予約ID  : ${state.actionTitleId}\n` +
      ` 筐体名  : ${chgMachine}\n` +
      _group.note +
      (state.actionHilsRes
        ? ` 現在の期間: ${state.actionHilsRes.start} 〜 ${state.actionHilsRes.end}\n`
        : '') +
      `\n■変更希望\n` +
      // 改修: 希望期間を変更理由の直上に常時記載（未入力でも行を出すため条件分岐を撤廃）
      ` 希望期間 : ${newStart || '（変更なし）'} 〜 ${newEnd || '（変更なし）'}\n` +
      ` 変更理由 : ${reason}` +
      mailSignature(),
      mailConfig.pmoCc
    );
    setStatus('変更依頼を送信しました');
    document.getElementById('accept-change-reason').value = '';
  } catch (e) {
    console.error('変更依頼メール送信エラー:', e);
    setStatus('変更依頼の送信に失敗しました', 'red');
  } finally {
    hideBusy();  // 改修: 処理中オーバーレイ解除
  }
});

// 承知ボタン: 事務局アクションリストへ「承知」記録＋PMOへ承知メール
// 承知時はステータス変更しない（1.仮申請受領を維持）
document.getElementById('accept-ok-btn').addEventListener('click', async () => {
  // URLのidはTitle値のため、SP内部IDを保持したstate.actionItemIdを使用する
  const acceptId = state.actionItemId;  // 第12回で保持したSP内部ID
  showBusy('承知処理を送信中...');  // 改修: 処理中オーバーレイ表示
  try {
    // ① アクションリストの承知/辞退/期間変更列を「承知」に更新
    await patchActionAccept(acceptId, '承知');
    // ② PMOへ承知メール送信（改修(メール文面): 提案資料③に合わせて件名・本文を更新）
    const okMachine = state.actionHilsRes?.machine || '';
    // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
    const _group = getGroupMailInfo(state.actionHilsRes);
    await sendMail(
      mailConfig.pmoTo,
      buildMailSubject('使用承知の通知', okMachine, resolveMailAddress(okMachine), _group.count),
      `PMO ご担当者 様\n\n` +
      `下記予約について、申請者より使用を「承知」する旨の回答がありました。\n\n` +
      `■対象予約\n` +
      ` 予約ID : ${state.actionTitleId}\n` +
      ` 筐体名 : ${okMachine}\n` +
      _group.note +
      (state.actionHilsRes
        ? ` 使用期間: ${state.actionHilsRes.start} 〜 ${state.actionHilsRes.end}\n`
        : '') +
      mailSignature(),
      mailConfig.pmoCc
    );
    setStatus('承知しました。PMOへ通知を送信しました。');
  } catch (e) {
    console.error('承知処理エラー:', e);
    setStatus('承知処理に失敗しました', 'red');
  } finally {
    hideBusy();  // 改修: 処理中オーバーレイ解除
  }
});

// 辞退ボタン: ステータスを91.申請者取り下げに更新＋使用履歴リスト削除＋PMOへ辞退メール
document.getElementById('accept-reject-btn').addEventListener('click', async () => {
  const rejectReason = document.getElementById('accept-reject-reason').value.trim();
  if (!rejectReason) {
    alert('辞退理由を入力してください');
    return;
  }
  // URLのidはTitle値のため、SP内部IDを保持したstate.actionItemIdを使用する
  const rejectId = state.actionItemId;  // 第12回で保持したSP内部ID
  showBusy('辞退処理を送信中...');  // 改修: 処理中オーバーレイ表示
  try {
    if (rejectId) {
      // ① アクションリストのステータスを「91.申請者取り下げ」に更新（既存ルート活用）
      await fetch(`/api/action-item/${rejectId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: '91.申請者取り下げ' }),
      });
      // ② 改修(不具合修正): 承知ボタンと異なりこれまで呼んでいなかった。承知/辞退/期間変更列を「辞退」に更新
      await patchActionAccept(rejectId, '辞退');
      // 改修: 1案件=1予約ガード用に現在ステータスを追従
      state.actionStatus = '91.申請者取り下げ';
      // ③ 統合HILS使用履歴リストから当該行を削除（突合成功時のみ。失敗時は辞退処理を継続）
      if (state.actionHilsId) {
        await fetch(`/api/reservations/${state.actionHilsId}`, { method: 'DELETE' });
        // 改修(起動連携): SP行削除に合わせてCSVの該当行も削除する
        if (state.actionHilsRes) {
          const { machine, start, end } = state.actionHilsRes;
          await apiDeleteLegendColor(machine, start, end);
        }
      }
    }
    // ④ PMOへ辞退メール送信（改修(メール文面): 提案資料④に合わせて件名・本文を更新）
    const rejMachine = state.actionHilsRes?.machine || '';
    // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
    const _group = getGroupMailInfo(state.actionHilsRes);
    await sendMail(
      mailConfig.pmoTo,
      buildMailSubject('使用辞退の通知', rejMachine, resolveMailAddress(rejMachine), _group.count),
      `PMO ご担当者 様\n\n` +
      `下記予約について、申請者より使用を「辞退」する旨の回答がありました。\n` +
      `本予約は予約管理表から削除されます。\n\n` +
      `■対象予約\n` +
      ` 予約ID : ${state.actionTitleId}\n` +
      ` 筐体名 : ${rejMachine}\n` +
      _group.note +
      (state.actionHilsRes
        ? ` 使用期間: ${state.actionHilsRes.start} 〜 ${state.actionHilsRes.end}\n`
        : '') +
      `\n■辞退理由\n` +
      ` ${rejectReason}` +
      mailSignature(),
      mailConfig.pmoCc
    );
    setStatus('辞退しました。PMOへ通知を送信しました。');
  } catch (e) {
    console.error('辞退処理エラー:', e);
    setStatus('辞退処理に失敗しました', 'red');
  } finally {
    hideBusy();  // 改修: 処理中オーバーレイ解除
  }
});

function deleteReservation(resId) {
  // 改修(案件跨ぎ誤操作防止): 別案件で登録された予約は削除させない
  if (isForeignCaseReservation(state.reservations[resId])) {
    alertForeignCaseReservation(state.reservations[resId]);
    return false;
  }
  // 改修: 複数筐体一括登録の連動予約（同一groupId）があれば、確認前に対象を洗い出し
  // confirm文言に件数を明示する。連動予約はresIdと一緒に削除する
  const target      = state.reservations[resId];
  const groupId     = target ? target.groupId : null;
  const siblingIds  = groupId != null
    ? state.reservations.map((_, i) => i).filter(i => i !== resId && state.reservations[i].groupId === groupId)
    : [];
  const confirmMsg  = siblingIds.length > 0
    ? `この予約を削除しますか？（連動する${siblingIds.length}件の予約も削除されます）`
    : 'この予約を削除しますか？';
  // 改修(マージ): 成否を返すよう変更（ダイアログ側で成功時のみ閉じるため）
  if (!confirm(confirmMsg)) return false;

  // 改修: 削除対象（本体＋連動する兄弟）をまとめて配列化し、spId/設備/日付/状態をspliceの前に退避する
  const targetIds = [resId, ...siblingIds];
  const deletions = targetIds.map(i => {
    const r = state.reservations[i];
    return {
      spId:    r ? r.spId    : null,
      machine: r ? r.machine : null,
      start:   r ? r.start   : null,
      end:     r ? r.end     : null,
      status:  r ? (r.status || 'normal') : 'normal',
    };
  });
  // 改修: インデックスの大きい順にspliceして後続要素の添字ズレを防ぐ
  [...targetIds].sort((a, b) => b - a).forEach(i => state.reservations.splice(i, 1));
  saveReservations(state.reservations);
  clearSelection();
  renderCalendar();

  // 改修: 本体・連動予約それぞれのSP/CSV削除を実行
  deletions.forEach(({ spId: dSpId, machine: dMachine, start: dStart, end: dEnd, status: dStatus }) => {
    if (dStatus === 'normal') {
      if (dSpId != null) apiDelete(dSpId);
      // 改修(起動連携): SPアイテム削除に合わせてCSVの該当行も削除する
      if (dMachine && dStart && dEnd) apiDeleteLegendColor(dMachine, dStart, dEnd);
    } else {
      // 改修(状態分離): 予備日/設備故障/休日はSharePoint未連携のため、状態リストCSVの該当行のみ削除する
      if (dMachine && dStart && dEnd) apiDeleteStatus(dMachine, dStart, dEnd);
    }
  });

  // 改修: 1案件=1予約ガード。削除対象（本体または連動予約のいずれか）に案件連携中のspIdが
  // 含まれていれば再登録可能にする。ただしステータスが 90/91（否認・取り下げ）の場合は
  // 管理状態を維持しステータス変更しない
  const deletedSpIds = deletions.map(d => d.spId);
  if (state.actionItemId && state.actionResSpId != null && deletedSpIds.includes(state.actionResSpId)) {
    if (!KEEP_STATUS_NUMS.includes(actionStatusNum(state.actionStatus))) {
      // 改修: ステータス遷移タイミングを「利用取消依頼申請時」から「事務局が予約を削除した時」へ変更。
      // 取消理由（事務局アクションリストの取消理由列）の有無で、取消依頼由来の削除か通常削除かを判定する。
      // 取消理由あり→91.申請者取り下げ、なし→従来通り0.仮申請受領前
      const actionId = state.actionItemId;
      (async () => {
        let nextStatus = '0.仮申請受領前';
        try {
          const actionRes = await fetch(`/api/action-item/${actionId}`);
          if (actionRes.ok) {
            const actionData = await actionRes.json();
            if (actionData.cancelReason) nextStatus = '91.申請者取り下げ';
          }
        } catch (e) {
          console.error('取消理由の確認に失敗しました:', e);
        }
        try {
          await fetch(`/api/action-item/${actionId}/status`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ status: nextStatus }),
          });
          state.actionStatus = nextStatus;
        } catch (e) {
          console.error('削除後ステータス更新エラー:', e);
        }
      })();
    }
    state.actionResSpId = null;
  }
  return true;
}

function openRegisterDialog() {
  if (!isAdmin) return;
  // 改修(状態分離): 1案件=1予約ガードは通常予約のみに適用するため、submit側（mode==='register'）へ移設した
  const sel = state.selectedCells;
  if (!sel.size) {
    alert('筐体と期間をカレンダー上で選択してから「＋ 登録」を押してください');
    return;
  }
  // 改修: 統合HILS利用時にSCLX+HELIOS等を同時予約できるよう、複数行（筐体）をまたぐ選択を許可する。
  // 選択行が複数の場合は各筐体に同一内容の予約を個別登録するため、対象筐体名を昇順で保持しておく
  const rows = [...new Set([...sel].map(k => parseInt(k.split('-')[0])))].sort((a, b) => a - b);
  const cols   = [...sel].map(k => parseInt(k.split('-')[1]));
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  // 改修(第7回): viewDates から開始・終了日を取得
  const startDate = state.viewDates[minCol];
  const endDate   = state.viewDates[maxCol];
  const defLeg    = _legend.length > 0 ? _legend[0].id : '';

  const allMachines = getAllMachines();
  // 改修: 複数筐体一括登録用に選択行を筐体名配列として保持する（単一選択時は要素数1）
  state.multiMachines = rows.map(r => allMachines[r]);

  showDialog('予約登録', {
    machine:   allMachines[rows[0]],
    startIso:  dateToIso(startDate),
    endIso:    dateToIso(endDate),
    label:     '',
    legendId:  defLeg,
    user:      '',             // 改修(SP連携マージ): 借用者
    applicant: '',
    remark:    '',
    assignee:  state.assignees[allMachines[rows[0]]] || '',  // 改修: ダイアログ担当者欄の初期値
    status:    'normal',
    room:      state.currentRoom,
    marks:     [],              // 改修(第8回): 検証完了日★初期値（空）
  }, 'register');
}

function openEditDialog(resId) {
  const res = state.reservations[resId];
  if (!res) return;
  // 改修(案件跨ぎ誤操作防止): 別案件で登録された予約は編集ダイアログを開かせない
  if (isForeignCaseReservation(res)) {
    alertForeignCaseReservation(res);
    return;
  }
  // 改修: 編集対象は常に単一筐体のため、複数筐体一括登録用の状態を必ずリセットする
  state.multiMachines = null;
  showDialog('予約を編集', {
    machine:   res.machine,
    startIso:  res.start.split('T')[0],
    endIso:    res.end.split('T')[0],
    label:     res.label     || '',
    legendId:  res.legendId  || (_legend.length > 0 ? _legend[0].id : ''),
    user:      res.user      || '',    // 改修(SP連携マージ): 借用者
    applicant: res.applicant || '',
    remark:    res.remark    || '',
    assignee:  state.assignees[res.machine] || '',  // 改修: ダイアログ担当者欄の初期値（担当者列の現在値）
    status:    res.status    || 'normal',
    room:      res.room      || 'west',
    marks:     res.marks     || [],     // 改修(第8回): 検証完了日★を復元
  }, 'edit', resId);
}

// 改修: 使用者向け 予約内容の閲覧（編集不可）
function openViewDialog(resId) {
  const res = state.reservations[resId];
  if (!res) return;
  // 改修: 閲覧対象は常に単一筐体のため、複数筐体一括登録用の状態を必ずリセットする
  state.multiMachines = null;
  showDialog('予約内容の確認', {
    machine:   res.machine,
    startIso:  res.start.split('T')[0],
    endIso:    res.end.split('T')[0],
    label:     res.label     || '',
    legendId:  res.legendId  || (_legend.length > 0 ? _legend[0].id : ''),
    user:      res.user      || '',    // 改修(SP連携マージ): 借用者
    applicant: res.applicant || '',
    remark:    res.remark    || '',
    assignee:  state.assignees[res.machine] || '',  // 改修: ダイアログ担当者欄の初期値（担当者列の現在値）
    status:    res.status    || 'normal',
    room:      res.room      || 'west',
    marks:     res.marks     || [],
  }, 'view', resId);
}

// 改修(第5回): 分類別の分割入力欄定義
const LABEL_FIELD_SETS = [
  { match: n => n.includes('FI/EDR'), prefix: '', parts: [
    { key: 'no',   label: '予約管理No', placeholder: '例）001',       required: true  },
    { key: 'name', label: '機種呼称',   placeholder: '例）ABCモデル',  required: true  },
    { key: 'eng',  label: 'ENGカテ',    placeholder: '任意',          required: false },
  ]},
  { match: n => n.includes('構築'), prefix: '', parts: [
    { key: 'name', label: '機種呼称', placeholder: '例）ABCモデル', required: true },
    { key: 'cat',  label: 'カテゴリ', placeholder: '例）カテゴリ',  required: true },
    { key: 'eng',  label: 'ENGカテ',  placeholder: '例）ENGカテ',   required: true },
  ]},
  // 改修(第16回): 一般募集ラベルに接頭辞 ')' を追加 U-1c
  // 改修: 一般募集ラベルの接頭辞 ')' を削除（凡例カテゴリの接頭辞削除依頼による）
  { match: n => n.includes('一般募集'), prefix: '', parts: [
    { key: 'no',   label: '予約管理No', placeholder: '例）001',       required: true },
    { key: 'code', label: '機種コード', placeholder: '例）ABCコード', required: true },
  ]},
];
function getLabelFieldSet(name) { return LABEL_FIELD_SETS.find(s => s.match(name)) || null; }
function composeLabel(fieldSet, values) {
  const joined = fieldSet.parts.map(p => (values[p.key] || '').trim()).filter(v => v !== '').join('_');
  return joined === '' ? '' : (fieldSet.prefix || '') + joined;
}
const XPX_LINK_URL = 'https://globalhonda.sharepoint.com/sites/jphgt110776/Lists/List/AllItems.aspx';
function isXpxLinkLegend(name) { return name.includes('FI/EDR'); }

function buildLegendSelect(selectedId) {
  return _legend.map(l => {
    const sel   = l.id === selectedId ? ' selected' : '';
    return `<option value="${l.id}"${sel}>${l.name}</option>`;
  }).join('');
}

// 改修: フォームペインを閉じてプレースホルダを表示するヘルパ
function closeFormPane() {
  document.getElementById('form-pane').classList.add('hidden');
  document.getElementById('extend-pane').classList.add('hidden');
  document.getElementById('cancel-pane').classList.add('hidden');  // 改修: 利用取消依頼ペインも排他非表示
  document.getElementById('form-empty').classList.remove('hidden');
  // 改修: フォームモードをリセット（日付自動連動の対象外にする）
  state.formMode = null;
}

function showDialog(title, data, mode, resId = null) {
  // 改修: モーダル(dialog-overlay)廃止→サイドパネル(form-pane)に差し替え
  const overlay = document.getElementById('form-pane');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl  = document.getElementById('dialog-body');
  const okBtn   = document.getElementById('dialog-ok');
  // 改修(マージ): 編集ダイアログ内削除ボタン（編集モード＋管理者のみ表示）
  const delBtn       = document.getElementById('dialog-delete-btn');
  // 改修: 利用終了ボタン（編集モード＋管理者のみ表示）
  const terminateBtn = document.getElementById('dialog-terminate-btn');

  titleEl.textContent = title;
  okBtn.textContent   = mode === 'register' ? '登録' : '保存';
  delBtn.classList.toggle('hidden', !(isAdmin && mode === 'edit'));
  terminateBtn.classList.toggle('hidden', !(isAdmin && mode === 'edit'));

  bodyEl.innerHTML = `
    <div class="form-row">
      <label>ルーム:</label>
      <!-- 改修: 設置場所（61号棟3F）をルーム名に併記 -->
      <select id="f-room" disabled>
        <option value="west"${(data.room || 'west') === 'west' ? ' selected' : ''}>西HILSルーム（61号棟3F）</option>
        <option value="south"${data.room === 'south' ? ' selected' : ''}>南HILSルーム（61号棟3F）</option>
      </select>
    </div>
    <div class="form-row">
      <label>筐体:</label>
      ${(mode === 'register' && state.multiMachines && state.multiMachines.length > 1)
        ? `<div id="f-machine-multi" class="multi-machine-list" title="矩形選択した筐体すべてに同一内容の予約を個別登録します">${state.multiMachines.join('、')}</div>
           <input type="hidden" id="f-machine" value="${data.machine}">`
        : `<select id="f-machine">
        ${getAllMachines().map(m =>
          `<option value="${m}"${m === data.machine ? ' selected' : ''}>${m}</option>`
        ).join('')}
      </select>`}
    </div>
    <div class="form-row">
      <label>状態:</label>
      <select id="f-status">
        <option value="normal"${(data.status || 'normal') === 'normal' ? ' selected' : ''}>通常</option>
        <option value="spare"${data.status === 'spare' ? ' selected' : ''}>予備日</option>
        <option value="fault"${data.status === 'fault' ? ' selected' : ''}>設備故障</option>
        <option value="holiday"${data.status === 'holiday' ? ' selected' : ''}>休日</option>
      </select>
    </div>
    <div class="form-row">
      <label>開始日:</label>
      <input type="date" id="f-start" value="${data.startIso}">
    </div>
    <div class="form-row">
      <label>終了日:</label>
      <input type="date" id="f-end" value="${data.endIso}">
    </div>
    <div id="form-row-legend" class="form-row">
      <label>分類:</label>
      <div class="legend-select-wrap">
        <div id="f-swatch" class="legend-select-swatch"></div>
        <select id="f-legend">${buildLegendSelect(data.legendId)}</select>
      </div>
    </div>
    <div id="f-label-fields"></div>
    <div id="form-row-label" class="form-row">
      <label>ラベル:</label>
      <input type="text" id="f-label" value="${data.label}" placeholder="プロジェクト名など">
    </div>
    <div id="form-row-user" class="form-row">
      <label>借用者:</label>
      <input type="text" id="f-user" value="${data.user || ''}" placeholder="氏名など">
    </div>
    <div id="form-row-applicant" class="form-row">
      <label>申請者:</label>
      <input type="text" id="f-applicant" value="${data.applicant || ''}" placeholder="氏名など">
    </div>
    <div id="form-row-remark" class="form-row">
      <label>備考:</label>
      <input type="text" id="f-remark" list="remark-options"
             value="${data.remark || ''}" placeholder="自由記入">
      <!-- 改修(第16回): 備考 datalist の「★」残骸オプション撤去 U-4（VERIFY_MARKS 系★には触れない） -->
      <datalist id="remark-options">
      </datalist>
    </div>
    <!-- 改修: 担当者欄（仕様05章 入力項目）。保存時に担当者列（state.assignees）と連動 -->
    <div id="form-row-assignee" class="form-row">
      <label>担当者:</label>
      <input type="text" id="f-assignee" value="${data.assignee || ''}" placeholder="担当者名">
    </div>
    <div id="form-row-marks" class="form-marks-group">
      <div class="form-marks-title">検証完了日（★）</div>
      ${VERIFY_MARKS.map(v => {
        const existing   = (data.marks || []).find(mk => mk.type === v.key);
        const checked    = existing ? ' checked' : '';
        const dateVal    = existing ? existing.date : (data.endIso || '');
        const disAttr    = existing ? '' : ' disabled';
        // 改修(第9回): タイトルの初期値（保存済みtitleを優先、なければlabel）
        const titleVal   = existing && existing.title != null ? existing.title : v.label;
        const badgeText  = titleVal + '★';
        return '<div class="form-row form-mark-row" id="form-mark-row-' + v.key + '">' +
               '<input type="checkbox" id="f-mark-' + v.key + '" class="f-mark-chk" data-key="' + v.key + '"' + checked + '>' +
               // 改修(第9回): ラベルを入力欄化（タイトルを直接編集可）
               '<input type="text" id="f-mark-title-' + v.key + '" class="f-mark-title"' + disAttr + ' value="' + titleVal + '" placeholder="検証名">' +
               '<input type="date" id="f-mark-date-' + v.key + '" class="f-mark-date"' + disAttr + ' value="' + dateVal + '">' +
               '<span id="f-mark-badge-' + v.key + '" class="mark-star-badge">' + badgeText + '</span>' +
               '</div>';
      }).join('')}
    </div>
    <div id="f-biz"  class="biz-label"></div>
    <div id="f-warn" class="warn-label hidden"></div>
  `;

  // 改修: 南HILSルームでは担当者列自体が不要なため、登録・編集ダイアログの担当者欄も非表示にする
  const assigneeRowEl = document.getElementById('form-row-assignee');
  if (assigneeRowEl) assigneeRowEl.classList.toggle('hidden', data.room === 'south');

  function updateSwatch() {
    const legId = document.getElementById('f-legend').value;
    const leg   = _legend.find(l => l.id === legId);
    const sw    = document.getElementById('f-swatch');
    if (sw) sw.style.background = leg ? leg.color : '#ccc';
  }
  document.getElementById('f-legend').addEventListener('change', updateSwatch);
  updateSwatch();

  function updateLabelFields() {
    const leg  = _legend.find(l => l.id === document.getElementById('f-legend').value);
    const name = leg ? leg.name : '';
    const fieldSet   = getLabelFieldSet(name);
    const container  = document.getElementById('f-label-fields');
    const labelInput = document.getElementById('f-label');
    if (!fieldSet) {
      container.innerHTML = '';
      labelInput.readOnly = false;
      labelInput.placeholder = 'プロジェクト名など';
      return;
    }
    container.innerHTML = fieldSet.parts.map(p =>
      `<div class="form-row"><label>${p.label}:</label>` +
      `<input type="text" class="f-label-part" data-key="${p.key}" placeholder="${p.placeholder}"></div>`
    ).join('');
    labelInput.readOnly = true;
    labelInput.placeholder = '（自動生成）';
    const recompose = () => {
      const values = {};
      container.querySelectorAll('.f-label-part').forEach(inp => { values[inp.dataset.key] = inp.value; });
      const composed = composeLabel(fieldSet, values);
      if (composed !== '') labelInput.value = composed;
    };
    container.querySelectorAll('.f-label-part').forEach(inp => inp.addEventListener('input', recompose));
  }
  document.getElementById('f-legend').addEventListener('change', updateLabelFields);
  updateLabelFields();

  // 改修(第7回): MAX_BIZ_DAYS 上限警告を撤廃。開始日>終了日エラーのみ残す
  function updateBiz() {
    const s    = document.getElementById('f-start').value;
    const e    = document.getElementById('f-end').value;
    const bEl  = document.getElementById('f-biz');
    const wEl  = document.getElementById('f-warn');
    if (!s || !e) return;
    const ds = isoToDate(s), de = isoToDate(e);
    if (ds > de) {
      bEl.textContent = '営業日数: —';
      wEl.textContent = '終了日が開始日より前です';
      wEl.classList.remove('hidden');
      okBtn.disabled = true;
      return;
    }
    const biz = bizDaysBetween(ds, de);
    bEl.textContent = `営業日数:  ${biz} 日`;
    // 改修(第7回): 上限警告撤廃
    wEl.classList.add('hidden');
    okBtn.disabled = false;
  }
  document.getElementById('f-start').addEventListener('change', updateBiz);
  document.getElementById('f-end').addEventListener('change', updateBiz);
  updateBiz();

  function updateStatusFields() {
    const status   = document.getElementById('f-status').value;
    const isNormal = status === 'normal';
    // 改修(SP連携マージ): form-row-user（借用者行）を追加
    // 改修: 担当者行（form-row-assignee）を追加
    ['form-row-label', 'form-row-legend', 'form-row-user', 'form-row-applicant', 'form-row-remark', 'form-row-assignee', 'form-row-marks'].forEach(id => {
      const row = document.getElementById(id);
      if (row) row.style.opacity = isNormal ? '1' : '0.4';
    });
    // 改修(SP連携マージ): f-user（借用者入力）を追加
    // 改修: f-assignee（担当者入力）を追加
    ['f-label', 'f-legend', 'f-user', 'f-applicant', 'f-remark', 'f-assignee'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isNormal;
    });
    // 改修(第8回): 通常状態以外では★マーカー入力を無効化
    // 改修(第9回): タイトル入力欄（f-mark-title）も同条件で無効化
    VERIFY_MARKS.forEach(v => {
      const chk  = document.getElementById('f-mark-' + v.key);
      const dt   = document.getElementById('f-mark-date-' + v.key);
      const tt   = document.getElementById('f-mark-title-' + v.key);
      if (chk) chk.disabled = !isNormal;
      // 完了日・タイトルはチェックONかつ通常状態のときのみ有効
      if (dt)  dt.disabled  = !isNormal || !(chk && chk.checked);
      if (tt)  tt.disabled  = !isNormal || !(chk && chk.checked);
    });
  }
  document.getElementById('f-status').addEventListener('change', updateStatusFields);
  updateStatusFields();

  // 改修(第12回): URLパラメータ経由の自動記入 W-4
  // 改修: 申請者名は借用者欄ではなく申請者欄（f-applicant）にセット
  if (mode === 'register' && state.autoFill) {
    const fApplicant = document.getElementById('f-applicant');
    if (fApplicant) fApplicant.value = state.autoFill.applicant;
    // ラベル（案件名）入力欄はフォーム種別依存のため、フィールドが存在する場合のみセット
    const fLabel = document.getElementById('f-label');
    if (fLabel) fLabel.value = state.autoFill.label;
  }

  // 改修(第8回): チェックボックスON/OFFで完了日入力欄を有効/無効切替
  // 改修(第9回): タイトル入力欄も同期、バッジのライブ更新リスナを追加
  VERIFY_MARKS.forEach(v => {
    const chk   = document.getElementById('f-mark-' + v.key);
    const dt    = document.getElementById('f-mark-date-' + v.key);
    const tt    = document.getElementById('f-mark-title-' + v.key);
    const badge = document.getElementById('f-mark-badge-' + v.key);
    if (chk) {
      chk.addEventListener('change', () => {
        if (dt)  dt.disabled = !chk.checked;
        if (tt)  tt.disabled = !chk.checked;
      });
    }
    // タイトル入力→バッジテキストをリアルタイム更新
    if (tt && badge) {
      tt.addEventListener('input', () => {
        badge.textContent = tt.value + '★';
      });
    }
  });

  // 改修: form-paneを表示し、extend-pane・cancel-pane・プレースホルダを排他非表示
  document.getElementById('extend-pane').classList.add('hidden');
  document.getElementById('cancel-pane').classList.add('hidden');
  document.getElementById('form-empty').classList.add('hidden');
  overlay.classList.remove('hidden');
  // 改修: 日付自動連動のためフォームモードを記録（登録時のみ連動）
  state.formMode = mode;

  // 改修: 閲覧モードは全入力欄を編集不可・保存ボタン非表示・キャンセルを「閉じる」に変更。
  //        DOM要素は使い回しのため、通常モードでは明示的に元の状態へ復元する。
  const cancelBtn = document.getElementById('dialog-cancel');
  if (mode === 'view') {
    bodyEl.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    okBtn.classList.add('hidden');
    cancelBtn.textContent = '閉じる';
  } else {
    okBtn.classList.remove('hidden');
    cancelBtn.textContent = 'キャンセル';
  }

  okBtn.onclick = async () => {  // 改修(SP連携マージ): SP API を await するため async 化
    const status   = document.getElementById('f-status').value;
    const legendId = document.getElementById('f-legend').value;
    const lm       = getLegendMap(_legend);
    const color    = lm[legendId] ? lm[legendId].color : '#fde68a';
    // 改修(第8回): チェック済み種別の検証完了日を marks 配列に格納
    // 改修(第9回): タイトル（title）も保存（予約ごとに個別管理）
    const marks = [];
    VERIFY_MARKS.forEach(v => {
      const chk = document.getElementById('f-mark-' + v.key);
      const dt  = document.getElementById('f-mark-date-' + v.key);
      const tt  = document.getElementById('f-mark-title-' + v.key);
      if (chk && chk.checked && !chk.disabled && dt && dt.value) {
        marks.push({ type: v.key, date: dt.value, title: tt ? tt.value.trim() : v.label });
      }
    });
    const resData  = {
      room:      document.getElementById('f-room').value,
      machine:   document.getElementById('f-machine').value,
      start:     document.getElementById('f-start').value,
      end:       document.getElementById('f-end').value,
      label:     document.getElementById('f-label').value.trim(),
      legendId,
      color,
      user:      document.getElementById('f-user').value.trim(),      // 改修(SP連携マージ): 借用者
      applicant: document.getElementById('f-applicant').value.trim(),
      email:     state.autoFill ? state.autoFill.email : '',         // 改修: 申請者メールアドレス（使用者アドレス列へ転記）
      // 改修: アドレス（筐体ごとの手入力識別情報。メールアドレスとは別物）。南HILSルームのみ保存対象
      address:   (state.currentRoom === 'south') ? (state.addresses[document.getElementById('f-machine').value] || '') : '',
      remark:    document.getElementById('f-remark').value.trim(),
      status,
      marks,     // 改修(第8回): 検証完了日★配列
    };
    // 改修(状態分離): 1案件=1予約ガードは通常予約の新規登録のみに適用する
    // （予備日/設備故障/休日はSharePoint未連携のため案件IDに関わらず複数件登録を許可）
    if (mode === 'register' && resData.status === 'normal' &&
        state.actionItemId && BLOCK_STATUS_NUMS.includes(actionStatusNum(state.actionStatus))) {
      alert('この案件はすでに予約登録済みです。事務局アクションリストを確認して他の項目からアクセスしなおしてください。');
      return;
    }
    // 改修: ダイアログの担当者欄を state.assignees に反映して担当者列と同期
    // 改修: 南HILSルームでは担当者列自体が不要なため、この反映処理を行わない
    if (state.currentRoom !== 'south') {
      const assigneeVal = (document.getElementById('f-assignee').value || '').trim();
      if (assigneeVal) {
        state.assignees[resData.machine] = assigneeVal;
      } else {
        delete state.assignees[resData.machine];
      }
      saveAssignees();
    }
    closeFormPane();
    if (mode === 'register') {
      resData._id = genLocalId();
      // 改修: 複数筐体一括登録の場合、兄弟予約と共有するグループIDを発行する
      // （連動編集・削除・メールの複数筐体表示は、このgroupIdを軸に予約同士を辿る）
      if (state.multiMachines && state.multiMachines.length > 1) {
        resData.groupId = genLocalId();
      }
      state.reservations.push(resData);
      // 改修(マージ): 登録直後は選択枠(緑)を解除し、登録した予約を赤枠選択状態にする
      state.selectedCells = new Set();
      state.selectedResId = state.reservations.length - 1;
      saveReservations(state.reservations);
      renderCalendar();
      updateInfoPanel();

      // 改修: 統合HILS利用時にSCLX+HELIOS等を同時予約できるよう、複数筐体を選択して登録した場合は
      // 主筐体（1件目・resData）以外の筐体にも同一内容の予約を個別登録する。
      // 案件（アクションリスト）連携・確定通知メール送信は主筐体のみに適用し、1案件=1予約の原則を維持する。
      const extraMachines = (state.multiMachines && state.multiMachines.length > 1)
        ? state.multiMachines.slice(1)
        : [];
      if (extraMachines.length > 0) {
        showBusy('他の筐体へ登録中...');
        try {
          for (const m of extraMachines) {
            const extraData = {
              ...resData,
              machine: m,
              // 改修: アドレスは筐体ごとの値のため、主筐体のものをそのまま使い回さず筐体別に取得する
              address: (state.currentRoom === 'south') ? (state.addresses[m] || '') : '',
            };
            extraData._id = genLocalId();
            state.reservations.push(extraData);
            saveReservations(state.reservations);
            if (extraData.status !== 'normal') {
              // 予備日/設備故障/休日: SharePointには一切登録せず状態リストCSVへ記録
              await apiAppendStatus(extraData);
              continue;
            }
            const extraSpId = await apiCreate(extraData);
            if (extraSpId != null) {
              state.reservations[state.reservations.length - 1].spId = extraSpId;
              saveReservations(state.reservations);
            }
            await apiAppendLegendColor(extraData);
          }
        } finally {
          hideBusy();
          renderCalendar();
        }
      }
      // 改修: 複数筐体一括登録用の状態は使用済みのためリセットする
      state.multiMachines = null;

      // 改修(状態分離): 通常はSharePoint連携、予備日/設備故障/休日は状態リストCSVのみに記録する
      if (resData.status !== 'normal') {
        // 予備日/設備故障/休日: SharePointには一切登録せず状態リストCSVへ記録。案件IDのガードも適用しない
        await apiAppendStatus(resData);
        return;
      }
      // 改修: 処理中オーバーレイ表示（SP登録〜凡例色リスト追記の間）
      showBusy('登録処理中...');
      try {
        // 改修(SP連携マージ): SPに登録し、返却IdをspIdとして保存（楽観更新）
        const newSpId = await apiCreate(resData);
        if (newSpId != null) {
          state.reservations[state.selectedResId].spId = newSpId;
          saveReservations(state.reservations);
          // 改修: 1案件=1予約ガード用に、このアクションIDに紐づく予約行のspIdを記録
          if (state.actionItemId) state.actionResSpId = newSpId;
        }
        // 改修(起動連携): 凡例色リストCSVに追記（色・状態等リッチ項目を永続化）
        await apiAppendLegendColor(resData);
      } finally {
        hideBusy();  // 改修: 処理中オーバーレイ解除
      }
      // 改修(第13回): 登録成功後に事務局アクションリストのステータス・状態を更新 W-5/W-7
      // state.actionItemIdはURLの?id=パラメータで起動した場合のみ設定される
      if (state.actionItemId) {
        (async () => {
          showBusy('登録処理中...');  // 改修: 処理中オーバーレイ表示
          try {
            // ① ステータスを「1.仮申請受領」に更新
            const r1 = await fetch(`/api/action-item/${state.actionItemId}/status`, {
              method:  'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ status: '1.仮申請受領' }),
            });
            // 改修: res.okを検査してエラーを画面に表示
            if (!r1.ok) {
              const e1 = await r1.json().catch(() => ({}));
              console.error('ステータス更新失敗:', e1);
              setStatus(`ステータス更新に失敗しました: ${e1.error || r1.status}`, '#ef4444');
            } else {
              setStatus('ステータスを更新しました', '#22c55e');
              // 改修: 1案件=1予約ガード用に現在ステータスを追従（以後の2件目登録を抑止）
              state.actionStatus = '1.仮申請受領';
            }
            // ② 状態列（通常/予備/故障/休日）を更新
            if (resData.status) {
              const r2 = await fetch(`/api/action-item/${state.actionItemId}/state`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ state: resData.status }),
              });
              // 改修: エラー時はコンソールに出力
              if (!r2.ok) {
                const e2 = await r2.json().catch(() => ({}));
                console.error('状態更新失敗:', e2);
              }
            }
          } catch (e) {
            console.error('登録後アクションリスト更新エラー:', e);
            setStatus('予約は登録されましたがアクションリスト更新に失敗しました', '#ef4444');
          } finally {
            hideBusy();  // 改修: 処理中オーバーレイ解除
          }
        })();
      }
      // 改修(メール文面): ①使用確定通知メールを申請者へ送信（?id=起動時のみ）
      if (state.actionItemId && state.actionTitleId) {
        (async () => {
          // 改修: 宛先を申請者メールアドレス（事務局アクションリストの申請者メールアドレス列）へ変更
          const applicantEmail = state.autoFill?.email;
          if (!applicantEmail) {
            setStatus('申請者メールアドレスが見つかりませんでした', 'red');
            return;
          }
          showBusy('登録処理中...');  // 改修: 処理中オーバーレイ表示
          try {
            // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
            // （resDataはこの時点でgroupId設定済み・兄弟は既にstate.reservationsへ登録済み）
            const _group = getGroupMailInfo(resData);
            await sendMail(
              applicantEmail,
              buildMailSubject('使用確定のお知らせ（承知・辞退のお願い）', resData.machine, resData.address, _group.count),
              `${state.autoFill?.applicant || ''} 様\n\n` +
              `ご申請いただいた統合HILSの使用日程が確定しましたのでお知らせします。\n\n` +
              `■予約情報\n` +
              ` 予約ID : ${state.actionTitleId}\n` +
              ` 筐体名 : ${resData.machine}\n` +
              _group.note +
              ` 使用期間: ${resData.start} 〜 ${resData.end}\n\n` +
              `下記ページより内容をご確認のうえ、「承知」または「辞退」の操作をお願いします。\n` +
              `使用期間の変更をご希望の場合も、下記ページより変更依頼が可能です。\n\n` +
              ` 承知・辞退ページ: ${location.origin}/?page=accept&id=${state.actionTitleId}\n\n` +
              // 改修: 利用終了時に利用終了報告ボタンでの報告が必要な旨を追記
              `なお、利用終了時には予約表の「利用終了報告」ボタンから事務局へご報告をお願いします。` +
              mailSignature(),
              mailConfig.userCc
            );
          } catch (e) {
            console.error('使用確定通知メール送信エラー:', e);
          } finally {
            hideBusy();  // 改修: 処理中オーバーレイ解除
          }
        })();
      }
    } else if (mode === 'edit' && resId !== null) {
      // 改修(SP連携マージ): 編集前のspIdを退避してから上書き
      const prevSpId = state.reservations[resId].spId;
      // 改修(状態分離): 編集前の状態・突合キーを退避（正規/非正規の切替時に旧ファイル側の行を削除するため）
      const prevStatus  = state.reservations[resId].status  || 'normal';
      const prevMachine = state.reservations[resId].machine;
      const prevStart   = state.reservations[resId].start;
      const prevEnd     = state.reservations[resId].end;
      state.reservations[resId] = { ...state.reservations[resId], ...resData };
      state.selectedResId = resId;
      saveReservations(state.reservations);
      renderCalendar();
      updateInfoPanel();
      // 改修: SP/CSV同期処理を関数化（syncReservationEdit）。連動予約（兄弟）にも同じ処理を使い回す
      await syncReservationEdit(resId, prevSpId, prevStatus, prevMachine, prevStart, prevEnd);
      // 改修(第13回): 更新後に事務局アクションリストのステータスを「1.仮申請受領」へ戻す W-12
      // （案件連携は主筐体のみに適用する既存方針のため、連動予約(兄弟)には適用しない）
      if (resData.status === 'normal' && state.actionItemId) {
        (async () => {
          try {
            const r = await fetch(`/api/action-item/${state.actionItemId}/status`, {
              method:  'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ status: '1.仮申請受領' }),
            });
            // 改修: res.okを検査してエラーを画面に表示
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              console.error('ステータス更新失敗:', err);
              setStatus(`ステータス更新に失敗しました: ${err.error || r.status}`, '#ef4444');
            } else {
              // 改修: 1案件=1予約ガード用に現在ステータスを追従
              state.actionStatus = '1.仮申請受領';
            }
          } catch (e) {
            console.error('更新後アクションリスト更新エラー:', e);
          }
        })();
      }

      // 改修: 複数筐体一括登録の連動予約（兄弟）へ、日程・分類・借用者・申請者・備考・状態を自動反映する。
      // 筐体名・アドレス・担当者・検証完了日★（marks）は筐体固有のため連動対象外
      const groupId = state.reservations[resId].groupId;
      if (groupId != null) {
        const siblingIds = state.reservations
          .map((_, i) => i)
          .filter(i => i !== resId && state.reservations[i].groupId === groupId);
        if (siblingIds.length > 0) {
          showBusy('連動予約を更新中...');
          try {
            for (const sId of siblingIds) {
              const sPrevSpId    = state.reservations[sId].spId;
              const sPrevStatus  = state.reservations[sId].status  || 'normal';
              const sPrevMachine = state.reservations[sId].machine;
              const sPrevStart   = state.reservations[sId].start;
              const sPrevEnd     = state.reservations[sId].end;
              state.reservations[sId] = {
                ...state.reservations[sId],
                start:     resData.start,
                end:       resData.end,
                legendId:  resData.legendId,
                color:     resData.color,
                user:      resData.user,
                applicant: resData.applicant,
                remark:    resData.remark,
                status:    resData.status,
              };
              saveReservations(state.reservations);
              await syncReservationEdit(sId, sPrevSpId, sPrevStatus, sPrevMachine, sPrevStart, sPrevEnd);
            }
            renderCalendar();
            updateInfoPanel();
            setStatus(`連動する${siblingIds.length}件の予約も更新しました`);
          } finally {
            hideBusy();
          }
        }
      }
    }
  };
  document.getElementById('dialog-cancel').onclick = () => {
    closeFormPane();
  };
  // 改修(マージ): 編集ダイアログ内削除ボタン（成功時のみダイアログを閉じる）
  delBtn.onclick = () => {
    if (mode === 'edit' && resId !== null && deleteReservation(resId)) {
      closeFormPane();
    }
  };
  // 改修(第15回): 利用終了ボタン（事務局モード・編集時のみ表示）W-18
  // ①アクションリストのステータスを「10.利用終了」に更新、②申請者へHILS復帰確認メール送信
  terminateBtn.onclick = async () => {
    if (!confirm('この予約を利用終了にしますか？')) return;
    // 対象予約（resId は showDialog 第4引数）
    const terminateRes = resId != null ? state.reservations[resId] : null;
    showBusy('利用終了処理中...');  // 改修: 処理中オーバーレイ表示
    try {
      // ① アクションリストのステータスを「10.利用終了」に更新（既存ルート再利用）
      if (state.actionItemId) {
        const r = await fetch(`/api/action-item/${state.actionItemId}/status`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status: '10.利用終了' }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error('利用終了ステータス更新失敗:', err);
          setStatus(`ステータス更新に失敗しました: ${err.error || r.status}`, 'red');
          return;
        }
        // 改修: 1案件=1予約ガード用に現在ステータスを追従
        state.actionStatus = '10.利用終了';
      }
      // ② 申請者へHILS復帰確認メールを送信（改修(メール文面): 提案資料⑧に合わせて件名・本文を更新）
      // 改修: 宛先を申請者メールアドレス（事務局アクションリストの申請者メールアドレス列）へ変更
      const applicantEmail = state.autoFill?.email;
      if (!applicantEmail) {
        setStatus('申請者メールアドレスが見つかりませんでした', 'red');
        return;
      }
      // 改修: 複数筐体一括登録の連動予約があれば件名・本文に付記する
      const _group = getGroupMailInfo(terminateRes);
      await sendMail(
        applicantEmail,
        buildMailSubject('HILS初期状態復帰のご確認', terminateRes?.machine || '', terminateRes?.address || resolveMailAddress(terminateRes?.machine), _group.count),
        `${state.autoFill?.applicant || ''} 様\n\n` +
        `下記予約の利用終了処理が完了しました。\n` +
        `HILSが初期状態へ復帰していることをご確認ください。\n\n` +
        `【確認項目】\n` +
        `・PODがバッテリーキャンセル状態になっていること\n` +
        `・ECUソフト／ハード構成が利用開始時の状態に戻っていること\n` +
        `・ECUリアル／ダミー設定が利用開始時の状態に戻っていること\n\n` +
        `相違があれば事務局までご連絡ください。\n\n` +
        `■対象予約\n` +
        ` 予約ID : ${state.actionTitleId}\n` +
        (terminateRes
          ? ` 筐体名 : ${terminateRes.machine}\n 使用期間: ${terminateRes.start} 〜 ${terminateRes.end}\n` + _group.note
          : '') +
        mailSignature(),
        mailConfig.userCc
      );
      setStatus('利用終了処理が完了しました。申請者へ復帰確認メールを送信しました。');
      closeFormPane();
    } catch (e) {
      console.error('利用終了処理エラー:', e);
      setStatus('利用終了処理に失敗しました', 'red');
    } finally {
      hideBusy();  // 改修: 処理中オーバーレイ解除
    }
  };
}

// ────────────────────────────────────────────
// 旧機種名→筐体名マッピング
// ────────────────────────────────────────────
const MACHINE_MAP = {
  'HELIOS-1号機':               '筐体A',
  'HELIOS-2号機':               '筐体B',
  'HELIOS-3号機':               '筐体C',
  'HELIOS-4号機':               '筐体D',
  'HELIOS-5号機':               '筐体E',
  'HELIOS-6号機（テン）':       '筐体F',
  'HELIOS-7号機（佐藤）':       '筐体G',
  'HELIOS-8号機（進藤）':       '筐体H',
  'HELIOS-9号機（柴山）':       '筐体I',
  'HELIOS-10号機（大堀）':      '筐体J',
  'HELIOS-11号機（森田）':      '筐体K',
  'HELIOS-12号機（パッタナー）':'筐体L',
  'HELIOS-13号機（樽井）':      '筐体M',
  'HELIOS-14号機（中台）':      '筐体N',
  'HELIOS-15号機（李開一）':    '筐体O',
  'HELIOS-16号機（ウー）':      '筐体P',
  'HELIOS-24号機（馬）':        '筐体Q',
  'HEV-BATT-3号機':            '筐体R',
  'HEV-BATT-5号機':            '筐体S',
  'BATTハーネスが1本しかない':  '筐体T',
};
function mapLegacyMachine(name) {
  return MACHINE_MAP[name] || name;
}

// ────────────────────────────────────────────
// 改修: 承知/辞退ページの予約内容欄にデータを反映する（機種名/借用者/開始日/終了日）
// ────────────────────────────────────────────
function renderAcceptInfo() {
	// state.reservations から actionHilsId で突合（主キー）
	let r = null;
	if (state.actionHilsId != null) {
		r = state.reservations.find(x => x.spId === state.actionHilsId);
	}
	// フォールバック: actionリストの機種呼称と使用履歴の機種名/ラベルで突合
	if (!r && state.autoFill && state.autoFill.label) {
		r = state.reservations.find(x =>
			x.machine === state.autoFill.label || x.label === state.autoFill.label);
	}
	// start/end はサーバ側 extractDate で既に YYYY-MM-DD 形式（整形不要）
	const machineName = r ? r.machine              : (state.autoFill ? state.autoFill.label : '');
	const borrower    = r ? (r.borrower || '')      : '';
	const start       = r ? r.start                : '';
	const end         = r ? r.end                  : '';
	document.getElementById('accept-info-label').textContent = machineName || '−';
	document.getElementById('accept-info-user').textContent  = borrower    || '−';
	document.getElementById('accept-info-start').textContent = start       || '−';
	document.getElementById('accept-info-end').textContent   = end         || '−';
	// 改修: 変更依頼フォームの日付入力に現在の予約日を初期セット（YYYY-MM-DD は date 入力にそのまま使用可）
	const si = document.getElementById('accept-new-start');
	const ei = document.getElementById('accept-new-end');
	if (si && start) si.value = start;
	if (ei && end)   ei.value = end;
}

// 初期化
// ────────────────────────────────────────────
async function init() {
  // 改修: 事務局宛先(To)・各CCのコンソール設定をサーバから取得（メール送信箇所で参照するため最初に実行）
  await loadMailConfig();

  document.getElementById('user-name').textContent = isAdmin ? '事務局' : 'ユーザー';
  if (!isAdmin) document.getElementById('register-btn').classList.add('hidden');

  // 改修(第12回): URLクエリパラメータから仮IDを受取り、SPからアクションリスト行を取得（W-2）
  const _actionId = _urlParams.get('id');  // 事務局アクションリストの仮ID
  // 改修(メール文面): 予約ID(仮ID)をメール本文で参照するため state に保持
  state.actionTitleId = _actionId || '';
  if (_actionId) {
    try {
      setStatus('案件情報を読み込み中...', 'orange');
      // 改修: URLのidはTitle列の値。encodeURIComponentで安全に渡す
      const actionItem = await fetch(`/api/action-item/${encodeURIComponent(_actionId)}`).then(r => r.json());
      // 改修(第12回): PATCH対象はアクションリストのSP内部ID。Title値ではなく取得行のIdを保持する（W-6）
      state.actionItemId = actionItem.id;
      // 改修: 1案件=1予約ガード用に現在ステータスを保持
      state.actionStatus = actionItem.status || '';
      // 改修(第14回): 辞退時の使用履歴削除用に、対応する使用履歴行のSP idを特定して保持
      // 改修(不具合修正): 突合キーを machine/label（machineType）に変更。
      // 旧条件は label(案件名)===machineType(機種呼称) かつ user(使用者名/人名)===email(メールアドレス) という
      // 別概念同士の比較で、通常はまず一致せず _hit が見つからなかった（承知/辞退ページのメールに
      // 筐体名が入らない・辞退時に使用履歴が削除されない不具合の原因）。renderAcceptInfo()の
      // フォールバック突合（実績あり）と同じ比較に揃える
      state.actionHilsId  = null;
      // 改修(起動連携): 辞退時のCSV行削除用に設備/開始日/終了日も保持する
      state.actionHilsRes = null;
      try {
        const _list = await fetch('/api/reservations').then(r => r.json());
        // 改修(承知/辞退表示不具合): まず事務局アクションリストID列で確実に突合する。
        // 機種呼称(machineType)は設備名/案件名と概念が異なり突合が失敗しやすいためフォールバックへ降格。
        const _hit =
          _list.find(x => x.actionListId != null && String(x.actionListId) === String(_actionId)) ||
          _list.find(x =>
            x.machine === (actionItem.machineType || '') || x.label === (actionItem.machineType || '')
          );
        if (_hit) {
          state.actionHilsId  = _hit.id;
          // 改修(起動連携): 設備/開始日/終了日をCSV削除キーとして保持
          state.actionHilsRes = { machine: _hit.machine, start: _hit.start, end: _hit.end };
          // 改修: 1案件=1予約ガード用に、起動時点で紐づく予約行のspIdを保持
          state.actionResSpId = _hit.id;
        }
      } catch (_) { /* 突合失敗は無視。辞退処理継続 */ }
      // 改修(第12回): 分類によるルーム自動切替 W-3（南HILSのみ有効化）
      if (actionItem.category === '統合HILS利用') {
        state.currentRoom = 'south';
        // 後日実装（西HILSルーム）:
        // } else if (actionItem.category === 'HILS申請' || actionItem.category === 'FI-XPX') {
        //   state.currentRoom = 'west';
      }
      // 改修(第12回): 自動記入用データをstateに保持（登録ダイアログで初期値セット）W-4
      state.autoFill = {
        label:     actionItem.machineType || '',  // 機種呼称をラベル初期値に
        applicant: actionItem.applicant   || '',  // 申請者名を申請者欄初期値に（改修: 借用者欄から変更）
        email:     actionItem.email       || '',
        category:  actionItem.category    || '',
      };
      setStatus('');
    } catch (e) {
      console.error('action-item 取得エラー:', e);
      setStatus('案件情報の取得に失敗しました', 'red');
    }
  }

  // 改修(筐体マスタ共通化): 筐体マスタCSV（west/south）をサーバーから取得する
  await loadRoomMaster();
  syncRoomViews();
  document.getElementById('room-select').value = state.currentRoom;

  // 改修(凡例共通化): 凡例マスタCSVをサーバーから取得する
  _legend = await fetchLegend();

  // 改修(起動連携): SPから予約取得後、凡例色リストCSVからリッチ項目を復元して反映
  setStatus('データを読み込み中...', 'orange');
  const raw = await fetchReservations();
  // 改修(起動連携): CSVを読み込み、突合キー(machine|start|end)でMapを構築
  const csvList = await fetchLegendColors();
  const csvMap  = {};
  csvList.forEach(c => {
    const key = `${c.machine}|${c.start}|${c.end}`;
    csvMap[key] = c;
  });

  if (raw !== null) {
    // SP取得成功: CSVを優先、次にlocalStorageのリッチ項目をspIdでマージ（フォールバック）
    const savedForMerge = loadReservations() || [];
    const richMap = {};
    savedForMerge.forEach(r => { if (r.spId != null) richMap[r.spId] = r; });
    state.reservations = raw.map((res, idx) => {
      // 改修(起動連携): 使用履歴リスト(南ルーム)はfield_1の生値をmachineとして使用
      // （mapLegacyMachineはHELIOS→筐体変換であり西ルーム/レガシー専用のため適用しない）
      const machine = res.machine;
      const csvKey  = `${machine}|${res.start}|${res.end}`;
      const csv     = csvMap[csvKey] || {};
      const ex      = richMap[res.id] || {};
      return {
        spId:      res.id,
        _id:       ex._id != null ? ex._id : idx + 1,
        machine,
        start:     res.start,
        end:       res.end,
        label:     res.label   || '',
        // 改修(起動連携): 申請者名はSP使用者名列（field_1→user）から取得
        applicant: res.user    || ex.applicant || '',
        // 改修(起動連携): SP列が無いリッチ項目はCSVから復元、無ければlocalStorage→既定値の順
        color:     csv.color    || ex.color    || '#fde68a',
        user:      csv.borrower || ex.user     || '',
        legendId:  csv.legendId || ex.legendId || (_legend.length > 0 ? _legend[0].id : ''),
        status:    csv.status   || ex.status   || 'normal',
        remark:    csv.remark   || ex.remark   || '',
        marks:     (csv.marks && csv.marks.length > 0) ? csv.marks : (ex.marks || []),
        // 改修: 借用者名列（使用履歴リスト新規追加）をSPから取得（承知/辞退ページで表示）
        borrower:  res.borrower || '',
        // 改修(起動連携): 使用履歴リストの予約は南ルームに固定（西ルームではない）
        room:      'south',
        // 改修(案件跨ぎ誤操作防止・不具合修正): APIレスポンスには含まれていたが、
        // ここでのフィールド組み立て時にactionListIdをコピーし忘れていたため、
        // state.reservationsに読み込まれた時点でactionListIdが常にundefinedになり、
        // isForeignCaseReservationによるガードが常に無効化されてしまっていた。
        actionListId: res.actionListId,
        // 改修: 複数筐体一括登録の連動グループID。SP側に対応列は無いため、
        // localStorageのリッチ項目（ex、spIdキーで復元）からのみ復元する
        groupId: ex.groupId != null ? ex.groupId : null,
      };
    });
    // 改修(起動連携): SP予約のdistinct設備名を南ルームの筐体一覧に反映（行を動的生成）
    // 改修(筐体マスタ共通化): 表記ゆれ（前後空白・大小文字）を無視して重複追加を防止する
    const spMachines   = [...new Set(state.reservations.map(r => r.machine).filter(Boolean))];
    const existing     = state.machinesByRoom.south || [];
    const existingNorm = new Set(existing.map(normalizeMachineName));
    spMachines.forEach(m => {
      const norm = normalizeMachineName(m);
      if (!existingNorm.has(norm)) { existing.push(m); existingNorm.add(norm); }
    });
    state.machinesByRoom.south = existing;
    // 改修(筐体マスタ共通化): 南ルームへの反映のためstate.currentRoomに関わらず'south'を明示保存する
    saveRoomMaster('south');
    syncRoomViews();
    _nextLocalId = state.reservations.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
    saveReservations(state.reservations);
    // 改修: 承知/辞退ページの場合は予約内容欄を反映する
    if (_acceptMode) renderAcceptInfo();
    setStatus('');
  } else {
    // SP取得失敗: localStorageへフォールバック（fetchReservations内でエラー表示済み）
    const saved = loadReservations();
    if (saved !== null) {
      state.reservations = saved;
      const maxId = saved.reduce((m, r) => Math.max(m, r._id || 0), 0);
      _nextLocalId = maxId + 1;
    }
  }

  // 改修(状態分離): 状態リストCSV（予備日/設備故障/休日）を取得し、疑似予約として起動時に反映する
  // これらはSharePoint未連携のためspIdを持たせず、案件IDに関わらず複数件が並存できる
  const statusList = await fetchStatusList();
  if (statusList.length > 0) {
    const statusReservations = statusList.map(s => ({
      spId:      null,
      _id:       _nextLocalId++,
      machine:   s.machine,
      start:     s.start,
      end:       s.end,
      label:     s.project   || '',
      applicant: s.applicant || '',
      color:     s.color     || '#fde68a',
      user:      s.borrower  || '',
      legendId:  s.legendId  || '',
      status:    s.status    || 'normal',
      remark:    s.remark    || '',
      marks:     s.marks     || [],
      borrower:  s.borrower  || '',
      room:      'south',
    }));
    state.reservations = state.reservations.concat(statusReservations);
    // 改修(状態分離): 疑似予約の設備名も南ルームの筐体一覧に反映する（行を動的生成）
    // 改修(筐体マスタ共通化): 表記ゆれ（前後空白・大小文字）を無視して重複追加を防止する
    const statusMachines   = [...new Set(statusReservations.map(r => r.machine).filter(Boolean))];
    const existingSouth    = state.machinesByRoom.south || [];
    const existingSouthNorm = new Set(existingSouth.map(normalizeMachineName));
    statusMachines.forEach(m => {
      const norm = normalizeMachineName(m);
      if (!existingSouthNorm.has(norm)) { existingSouth.push(m); existingSouthNorm.add(norm); }
    });
    state.machinesByRoom.south = existingSouth;
    // 改修(筐体マスタ共通化): 南ルームへの反映のためstate.currentRoomに関わらず'south'を明示保存する
    saveRoomMaster('south');
    syncRoomViews();
    saveReservations(state.reservations);
  }

  // 改修: アドレス列は南HILSルームのみ表示。初回renderCalendar前にクラスを確定させる
  applyAddressVisibility(state.currentRoom);
  // 改修: 担当者列チェックボックスの初期状態を保存済みユーザー設定へ復元してから、
  // 南HILSルームでは担当者列を常に非表示・操作不可にする（初回renderCalendar前にクラスを確定させる）
  document.getElementById('assignee-visible-chk').checked = loadAssigneeVisible();
  applyAssigneeVisibilityForRoom(state.currentRoom);
  // 改修: 使用者モードでは担当者列チェックボックス自体（トグルUI）も不要なため非表示にする
  if (!isAdmin) {
    const assigneeToggleEl = document.querySelector('.assignee-toggle');
    if (assigneeToggleEl) assigneeToggleEl.classList.add('hidden');
  }

  // 改修(第7回): 表示期間を初期化してからカレンダーを描画し、今日へ自動スクロール
  initViewRange();
  renderCalendar();
  scrollToDate(new Date());
  // 改修(第7回追補): ウィンドウリサイズ時に日付列幅を自動再計算（一度だけ登録）
  window.addEventListener('resize', applyDateColWidth);

  renderLegendPanel();
  updateInfoPanel();
}

init();

// 改修: スクショ機能（📷保存ボタン・saveCalendarImage）は削除
