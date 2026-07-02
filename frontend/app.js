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

// ────────────────────────────────────────────
// 改修(第6回): クエリパラメータによる権限判定（見た目のみ・認証ではない）
//   ?user=admin → 事務局モード（削除・編集・XPX受領ボタンを表示）
//   それ以外    → 使用者モード（延長申請ボタンを表示、ダブルクリック編集を無効化）
// ────────────────────────────────────────────
const _urlParams = new URLSearchParams(location.search);
const isAdmin    = _urlParams.get('user') === 'admin';

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

const LEGEND_STORAGE_KEY  = 'hils_legend_v1';
const RES_STORAGE_KEY     = 'hils_reservations_v1';
const MACHINE_STORAGE_KEY  = 'hils_machines_v1';     // メイン筐体リストのlocalStorageキー
const SPARE_STORAGE_KEY    = 'hils_spares_v1';       // 改修: 予備リストのlocalStorageキー
const ASSIGNEE_STORAGE_KEY  = 'hils_assignees_v1';         // 改修: 担当者マップのlocalStorageキー
const ASSIGNEE_VISIBLE_KEY  = 'hils_assignee_visible_v1';  // 改修: 担当者列の表示/非表示フラグ（全ルーム共通）

// ────────────────────────────────────────────
// 凡例ストア（localStorage）
// ────────────────────────────────────────────
function loadLegend() {
  try {
    const raw = localStorage.getItem(LEGEND_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return LEGEND_SEED.map(l => ({ ...l }));
}
function saveLegend(legend) {
  localStorage.setItem(LEGEND_STORAGE_KEY, JSON.stringify(legend));
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

let _legend = loadLegend();

// ────────────────────────────────────────────
// 環境名ストア（localStorage）
// ────────────────────────────────────────────
function loadMachines() {
  // 改修(第4回): ルーム別マップ { west, south } を読み込む
  // 旧形式（配列）は west ルームへマイグレーション
  try {
    const raw = localStorage.getItem(MACHINE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // 旧形式：配列は west へマイグレーション（予備行は除外）
        return { west: parsed.filter(name => !name.startsWith('予備')), south: [] };
      }
      // 新形式：{west, south} オブジェクト
      return {
        west:  Array.isArray(parsed.west)  ? parsed.west  : HILS_MACHINES.slice(),
        south: Array.isArray(parsed.south) ? parsed.south : [],
      };
    }
  } catch (_) {}
  return { west: HILS_MACHINES.slice(), south: [] };
}
function saveMachines() {
  // 改修(第4回): ルーム別マップ全体を保存する（引数なし・state.machinesByRoom を参照）
  localStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify(state.machinesByRoom));
}
// 改修: 予備リストをlocalStorageから読み込む（無ければデフォルト値を返す）
// 改修(第4回): ルーム別マップ { west, south } を読み込む
// 後方互換: 旧データのメインリストに予備が含まれていた場合はそこから抽出する
function loadSpares() {
  try {
    const raw = localStorage.getItem(SPARE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // 旧形式：配列は west ルームへマイグレーション
        return { west: parsed, south: [] };
      }
      // 新形式：{west, south} オブジェクト
      return {
        west:  Array.isArray(parsed.west)  ? parsed.west  : HILS_SPARES.slice(),
        south: Array.isArray(parsed.south) ? parsed.south : [],
      };
    }
    // SPARE_STORAGE_KEY がない場合：MACHINE_STORAGE_KEY の旧形式から予備を抽出
    const mainRaw = localStorage.getItem(MACHINE_STORAGE_KEY);
    if (mainRaw) {
      const mainParsed = JSON.parse(mainRaw);
      if (Array.isArray(mainParsed)) {
        const spares = mainParsed.filter(name => name.startsWith('予備'));
        if (spares.length > 0) return { west: spares, south: [] };
      }
    }
  } catch (_) {}
  return { west: HILS_SPARES.slice(), south: [] };
}
// 改修(第4回): ルーム別マップ全体を保存する（引数なし・state.sparesByRoom を参照）
function saveSpares() {
  localStorage.setItem(SPARE_STORAGE_KEY, JSON.stringify(state.sparesByRoom));
}
// 改修: 担当者マップをlocalStorageから読み込む（無ければ空オブジェクトを返す）
// 改修(第4回): ルーム別マップ { west, south } を読み込む
function loadAssignees() {
  try {
    const raw = localStorage.getItem(ASSIGNEE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 旧形式判定：{west} キーを持たない場合は旧形式（単純オブジェクト）
      if (!Object.prototype.hasOwnProperty.call(parsed, 'west')) {
        return { west: parsed, south: {} };
      }
      // 新形式：{west, south} オブジェクト
      return {
        west:  (parsed.west  && typeof parsed.west  === 'object') ? parsed.west  : {},
        south: (parsed.south && typeof parsed.south === 'object') ? parsed.south : {},
      };
    }
  } catch (_) {}
  return { west: {}, south: {} };
}
// 改修(第4回): ルーム別マップ全体を保存する（引数なし・state.assigneesByRoom を参照）
function saveAssignees() {
  localStorage.setItem(ASSIGNEE_STORAGE_KEY, JSON.stringify(state.assigneesByRoom));
}
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
  // visible=false のとき assignee-hidden クラスを付与して列を非表示にする
  tbl.classList.toggle('assignee-hidden', !visible);
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
  machines:      [],               // メイン筐体リスト（currentRoomへのビュー。syncRoomViewsで更新）
  spares:        [],               // 改修: 予備リスト（currentRoomへのビュー。syncRoomViewsで更新）
  assignees:     {},               // 改修: 担当者マップ（currentRoomへのビュー。syncRoomViewsで更新）
  selectedCells: new Set(),
  selectedResId: null,
  anchorCell:    null,
};

// 改修: メイン筐体と予備を結合した全環境名リストを返す（行インデックス計算に使用）
function getAllMachines() {
  return [...state.machines, ...state.spares];
}

// 改修(第4回): 現在ルームのデータを state.machines/spares/assignees へバインドする
function syncRoomViews() {
  state.machines  = state.machinesByRoom[state.currentRoom];
  state.spares    = state.sparesByRoom[state.currentRoom];
  state.assignees = state.assigneesByRoom[state.currentRoom];
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
// バックエンド API（シードのみ使用）
// ────────────────────────────────────────────
async function fetchReservations() {
  try {
    const res = await fetch('/api/reservations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('予約取得失敗:', e);
    setStatus('データ取得に失敗しました', '#ef4444');
    return [];
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

        function commitEdit() {
          const newName = editInput.value.trim();
          if (newName && newName !== oldName) {
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
            mkSpan.textContent = starTextForType(mk.type);
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
        if (isAdmin) {
          td.addEventListener('dblclick', () => {
            openEditDialog(resInfo.resId);
          });
        }
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
      if (getAllMachines().includes(trimmed)) {
        alert(`「${trimmed}」はすでに存在します。`);
        return;
      }
      state.machines.push(trimmed);
      saveMachines();
      renderCalendar();
    });
    addTdHeader.appendChild(addBtn);
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
let _dragRow           = null;
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
  _dragRow    = row;

  state.selectedResId = null;
  state.selectedCells = new Set([`${row}-${col}`]);
  state.anchorCell    = { row, col };

  updateInfoPanel();
  renderCalendar();
}

// 改修(第7回): 曜日判定を viewDates[c] から取得
function onCellMouseOver(e) {
  if (!_isDragging || !state.anchorCell) return;
  const td  = e.currentTarget;
  const row = parseInt(td.dataset.row);
  const col = parseInt(td.dataset.col);
  if (row !== _dragRow) return;

  if (col !== state.anchorCell.col) _dragMoved = true;

  const anchor = state.anchorCell;
  const minCol = Math.min(anchor.col, col);
  const maxCol = Math.max(anchor.col, col);

  state.selectedCells = new Set();
  for (let c = minCol; c <= maxCol; c++) {
    // 改修(第7回): 曜日判定を viewDates[c].getDay() で直接取得
    const wday = state.viewDates[c].getDay();
    if (wday !== 0 && wday !== 6) state.selectedCells.add(`${row}-${c}`);
  }
  renderCalendar();
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
  const delBtn     = document.getElementById('info-delete-btn');
  const extendBtn  = document.getElementById('info-extend-btn');
  const xpxBtn     = document.getElementById('info-xpx-btn');

  if (selectedResId === null || !reservations[selectedResId]) {
    hint.classList.remove('hidden');
    [machine, period, label, applicant, delBtn, extendBtn, xpxBtn].forEach(el => el.classList.add('hidden'));
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
  if (isAdmin) {
    delBtn.classList.remove('hidden');
  } else {
    delBtn.classList.add('hidden');
  }
  if (!isAdmin) {
    extendBtn.classList.remove('hidden');
  } else {
    extendBtn.classList.add('hidden');
  }
  const resLegForXpx = _legend.find(l => l.id === res.legendId);
  if (isAdmin && resLegForXpx && isXpxLinkLegend(resLegForXpx.name)) {
    xpxBtn.classList.remove('hidden');
  } else {
    xpxBtn.classList.add('hidden');
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
  const ac = wrapper.querySelector('th.assignee-col');
  return (mc ? mc.offsetWidth : 170) + (ac ? ac.offsetWidth : 80);
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
  const assigneeW = table.classList.contains('assignee-hidden') ? 0 : 80;
  const machineW  = 170;
  const avail     = wrapper.clientWidth - machineW - assigneeW;
  const w         = Math.max(DATE_COL_MIN, Math.floor(avail / 31));
  // CSS変数に設定（th.date-col / td.gantt-cell が参照）
  table.style.setProperty('--date-col-w', w + 'px');
  // colgroup の col.col-date 幅も同期更新
  table.querySelectorAll('col.col-date').forEach(col => { col.style.width = w + 'px'; });
  // 改修(第7回追補4): table-layout:fixed は確定幅がないと自動レイアウトにフォールバックする
  // テーブル全体の px 幅を設定して fixed レイアウトを発火させる
  // これにより colgroup 幅が厳密に反映され、日付ヘッダと予約バーの列ズレが解消する
  const totalDateCols = state.viewDates ? state.viewDates.length : 0;
  table.style.width = (machineW + assigneeW + totalDateCols * w) + 'px';
  // 改修(第7回追補2): 担当者列 sticky left を筐体列の実描画幅に追従させる
  // ハードコードの left:169px がずれた場合でも隙間なく密着させるための恒久対策
  const machineTh = table.querySelector('thead th.machine-col');
  if (machineTh) table.style.setProperty('--assignee-left', machineTh.offsetWidth + 'px');
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
  const inDialog  = e.target.closest('#dialog-overlay');
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
  clearSelection();
  renderCalendar();
});

// 改修: 担当者列チェックボックスの change ハンドラ
document.getElementById('assignee-visible-chk').addEventListener('change', e => {
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

document.getElementById('info-delete-btn').addEventListener('click', () => {
  if (state.selectedResId !== null) deleteReservation(state.selectedResId);
});

document.getElementById('info-extend-btn').addEventListener('click', () => {
  const overlay = document.getElementById('extend-overlay');
  const res = state.reservations[state.selectedResId];
  if (res) document.getElementById('ext-end').value = res.end.split('T')[0];
  document.getElementById('ext-reason').value = '';
  overlay.classList.remove('hidden');
});

document.getElementById('ext-ok').addEventListener('click', () => {
  if (!document.getElementById('ext-reason').value.trim()) {
    alert('延長理由を入力してください');
    return;
  }
  alert('申請処理は未実装です');
  document.getElementById('extend-overlay').classList.add('hidden');
});
document.getElementById('ext-cancel').addEventListener('click', () => {
  document.getElementById('extend-overlay').classList.add('hidden');
});

document.getElementById('info-xpx-btn').addEventListener('click', () => {
  alert('XPX リスト登録処理は未実装です');
});

function deleteReservation(resId) {
  if (!confirm('この予約を削除しますか？')) return;
  state.reservations.splice(resId, 1);
  saveReservations(state.reservations);
  clearSelection();
  renderCalendar();
}

function openRegisterDialog() {
  if (!isAdmin) return;
  const sel = state.selectedCells;
  if (!sel.size) {
    alert('筐体と期間をカレンダー上で選択してから「＋ 登録」を押してください');
    return;
  }
  const rows = [...sel].map(k => parseInt(k.split('-')[0]));
  if (new Set(rows).size !== 1) return;

  const row    = rows[0];
  const cols   = [...sel].map(k => parseInt(k.split('-')[1]));
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  // 改修(第7回): viewDates から開始・終了日を取得
  const startDate = state.viewDates[minCol];
  const endDate   = state.viewDates[maxCol];
  const defLeg    = _legend.length > 0 ? _legend[0].id : '';

  showDialog('予約登録', {
    machine:   getAllMachines()[row],
    startIso:  dateToIso(startDate),
    endIso:    dateToIso(endDate),
    label:     '',
    legendId:  defLeg,
    applicant: '',
    remark:    '',
    status:    'normal',
    room:      state.currentRoom,
    marks:     [],              // 改修(第8回): 検証完了日★初期値（空）
  }, 'register');
}

function openEditDialog(resId) {
  const res = state.reservations[resId];
  if (!res) return;
  showDialog('予約を編集', {
    machine:   res.machine,
    startIso:  res.start.split('T')[0],
    endIso:    res.end.split('T')[0],
    label:     res.label     || '',
    legendId:  res.legendId  || (_legend.length > 0 ? _legend[0].id : ''),
    applicant: res.applicant || '',
    remark:    res.remark    || '',
    status:    res.status    || 'normal',
    room:      res.room      || 'west',
    marks:     res.marks     || [],     // 改修(第8回): 検証完了日★を復元
  }, 'edit', resId);
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

function showDialog(title, data, mode, resId = null) {
  const overlay = document.getElementById('dialog-overlay');
  const titleEl = document.getElementById('dialog-title');
  const bodyEl  = document.getElementById('dialog-body');
  const okBtn   = document.getElementById('dialog-ok');

  titleEl.textContent = title;
  okBtn.textContent   = mode === 'register' ? '登録' : '保存';

  bodyEl.innerHTML = `
    <div class="form-row">
      <label>ルーム:</label>
      <select id="f-room" disabled>
        <option value="west"${(data.room || 'west') === 'west' ? ' selected' : ''}>西HILSルーム</option>
        <option value="south"${data.room === 'south' ? ' selected' : ''}>南HILSルーム</option>
      </select>
    </div>
    <div class="form-row">
      <label>筐体:</label>
      <select id="f-machine">
        ${getAllMachines().map(m =>
          `<option value="${m}"${m === data.machine ? ' selected' : ''}>${m}</option>`
        ).join('')}
      </select>
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
    <div id="form-row-applicant" class="form-row">
      <label>申請者:</label>
      <input type="text" id="f-applicant" value="${data.applicant || ''}" placeholder="氏名など">
    </div>
    <div id="form-row-remark" class="form-row">
      <label>備考:</label>
      <input type="text" id="f-remark" list="remark-options"
             value="${data.remark || ''}" placeholder="自由記入">
      <datalist id="remark-options">
        <option value="★">
      </datalist>
    </div>
    <div id="form-row-marks" class="form-marks-group">
      <div class="form-marks-title">検証完了日（★）</div>
      ${VERIFY_MARKS.map(v => {
        const existing = (data.marks || []).find(mk => mk.type === v.key);
        const checked  = existing ? ' checked' : '';
        const dateVal  = existing ? existing.date : (data.endIso || '');
        const disAttr  = existing ? '' : ' disabled';
        return '<div class="form-row form-mark-row" id="form-mark-row-' + v.key + '">' +
               '<label class="mark-chk-label">' +
               '<input type="checkbox" id="f-mark-' + v.key + '" class="f-mark-chk" data-key="' + v.key + '"' + checked + '> ' +
               v.label + '</label>' +
               '<input type="date" id="f-mark-date-' + v.key + '" class="f-mark-date"' + disAttr + ' value="' + dateVal + '">' +
               '<span class="mark-star-badge">' + v.star + '</span>' +
               '</div>';
      }).join('')}
    </div>
    <div id="f-biz"  class="biz-label"></div>
    <div id="f-warn" class="warn-label hidden"></div>
  `;

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
    ['form-row-label', 'form-row-legend', 'form-row-applicant', 'form-row-remark', 'form-row-marks'].forEach(id => {
      const row = document.getElementById(id);
      if (row) row.style.opacity = isNormal ? '1' : '0.4';
    });
    ['f-label', 'f-legend', 'f-applicant', 'f-remark'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isNormal;
    });
    // 改修(第8回): 通常状態以外では★マーカー入力を無効化
    VERIFY_MARKS.forEach(v => {
      const chk = document.getElementById('f-mark-' + v.key);
      const dt  = document.getElementById('f-mark-date-' + v.key);
      if (chk) chk.disabled = !isNormal;
      // 完了日はチェックONかつ通常状態のときのみ有効
      if (dt)  dt.disabled  = !isNormal || !(chk && chk.checked);
    });
  }
  document.getElementById('f-status').addEventListener('change', updateStatusFields);
  updateStatusFields();

  // 改修(第8回): チェックボックスON/OFFで完了日入力欄を有効/無効切替
  VERIFY_MARKS.forEach(v => {
    const chk = document.getElementById('f-mark-' + v.key);
    const dt  = document.getElementById('f-mark-date-' + v.key);
    if (chk && dt) {
      chk.addEventListener('change', () => {
        dt.disabled = !chk.checked;
      });
    }
  });

  overlay.classList.remove('hidden');

  okBtn.onclick = () => {
    const status   = document.getElementById('f-status').value;
    const legendId = document.getElementById('f-legend').value;
    const lm       = getLegendMap(_legend);
    const color    = lm[legendId] ? lm[legendId].color : '#fde68a';
    // 改修(第8回): チェック済み種別の検証完了日を marks 配列に格納
    const marks = [];
    VERIFY_MARKS.forEach(v => {
      const chk = document.getElementById('f-mark-' + v.key);
      const dt  = document.getElementById('f-mark-date-' + v.key);
      if (chk && chk.checked && !chk.disabled && dt && dt.value) {
        marks.push({ type: v.key, date: dt.value });
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
      applicant: document.getElementById('f-applicant').value.trim(),
      remark:    document.getElementById('f-remark').value.trim(),
      status,
      marks,     // 改修(第8回): 検証完了日★配列
    };
    overlay.classList.add('hidden');
    if (mode === 'register') {
      resData._id = genLocalId();
      state.reservations.push(resData);
    } else if (mode === 'edit' && resId !== null) {
      state.reservations[resId] = { ...state.reservations[resId], ...resData };
      state.selectedResId = resId;
    }
    saveReservations(state.reservations);
    renderCalendar();
    updateInfoPanel();
  };
  document.getElementById('dialog-cancel').onclick = () => {
    overlay.classList.add('hidden');
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
// 初期化
// ────────────────────────────────────────────
async function init() {
  document.getElementById('user-name').textContent = isAdmin ? '事務局' : 'ユーザー';
  if (!isAdmin) document.getElementById('register-btn').classList.add('hidden');

  state.machinesByRoom  = loadMachines();
  state.sparesByRoom    = loadSpares();
  state.assigneesByRoom = loadAssignees();
  syncRoomViews();
  document.getElementById('room-select').value = state.currentRoom;

  const saved = loadReservations();
  if (saved !== null) {
    state.reservations = saved;
    const maxId = saved.reduce((m, r) => Math.max(m, r._id || 0), 0);
    _nextLocalId = maxId + 1;
    setStatus('');
  } else {
    setStatus('データを読み込み中...', 'orange');
    const raw = await fetchReservations();
    state.reservations = raw.map((res, idx) => ({
      ...res,
      _id:     idx + 1,
      machine: mapLegacyMachine(res.machine),
    }));
    _nextLocalId = state.reservations.length + 1;
    saveReservations(state.reservations);
    setStatus('');
  }

  // 改修(第7回): 表示期間を初期化してからカレンダーを描画し、今日へ自動スクロール
  initViewRange();
  renderCalendar();
  scrollToDate(new Date());
  // 改修(第7回追補): ウィンドウリサイズ時に日付列幅を自動再計算（一度だけ登録）
  window.addEventListener('resize', applyDateColWidth);

  const assigneeVis = loadAssigneeVisible();
  document.getElementById('assignee-visible-chk').checked = assigneeVis;
  applyAssigneeVisibility(assigneeVis);
  renderLegendPanel();
  updateInfoPanel();
}

init();

// ────────────────────────────────────────────
// 画像保存機能（📷保存ボタン）
// ────────────────────────────────────────────
document.getElementById('capture-btn').addEventListener('click', saveCalendarImage);

async function saveCalendarImage() {
  const captureBtn  = document.getElementById('capture-btn');
  const ganttTable  = document.getElementById('gantt-table');
  const legendPanel = document.getElementById('legend-panel');
  if (!ganttTable) return;

  captureBtn.disabled = true;
  setStatus('画像を生成中...', 'orange');

  const prevLegendOverflowY  = legendPanel ? legendPanel.style.overflowY  : '';
  const prevLegendHeight     = legendPanel ? legendPanel.style.height     : '';
  const prevLegendMaxHeight  = legendPanel ? legendPanel.style.maxHeight  : '';
  if (legendPanel) {
    legendPanel.style.overflowY = 'visible';
    legendPanel.style.height    = 'auto';
    legendPanel.style.maxHeight = 'none';
  }

  try {
    const OPT = { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false };

    const tableCanvas = await html2canvas(ganttTable, OPT);
    const legendCanvas = legendPanel
      ? await html2canvas(legendPanel, OPT)
      : null;

    const totalW = tableCanvas.width + (legendCanvas ? legendCanvas.width : 0);
    const totalH = Math.max(tableCanvas.height, legendCanvas ? legendCanvas.height : 0);
    const merged = document.createElement('canvas');
    merged.width  = totalW;
    merged.height = totalH;
    const ctx = merged.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);
    ctx.drawImage(tableCanvas, 0, 0);
    if (legendCanvas) ctx.drawImage(legendCanvas, tableCanvas.width, 0);

    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const roomLabel = state.currentRoom === 'west' ? '西HILS' : '南HILS';
    const filename = `予約表_${roomLabel}_${ymd}.png`;

    merged.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`保存しました: ${filename}`, '#15803d');
      setTimeout(() => setStatus(''), 3000);
    }, 'image/png');

  } catch (err) {
    console.error('画像保存エラー:', err);
    setStatus('画像の保存に失敗しました', '#e05252');
  } finally {
    if (legendPanel) {
      legendPanel.style.overflowY = prevLegendOverflowY;
      legendPanel.style.height    = prevLegendHeight;
      legendPanel.style.maxHeight = prevLegendMaxHeight;
    }
    captureBtn.disabled = false;
  }
}
