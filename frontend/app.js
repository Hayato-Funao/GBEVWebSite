'use strict';

// ────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────
const HILS_MACHINES = [
  ...'ABCDEFGHIJKLMNOPQRST'.split('').map(c => '筐体' + c),
  '予備1',
  '予備2',
];

const WEEKDAY_JP   = ['月', '火', '水', '木', '金', '土', '日'];
const CAL_MIN      = { year: 2025, month: 12 };
const MAX_BIZ_DAYS = 20;
const EDGE_PX      = 10; // リサイズ端の判定幅（px）

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

const LEGEND_STORAGE_KEY = 'hils_legend_v1';
const RES_STORAGE_KEY    = 'hils_reservations_v1';

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

let _legend = loadLegend();

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
  reservations:  [],
  selectedCells: new Set(),
  selectedResId: null,
  anchorCell:    null,
};

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
function maxCalYM() {
  const now = new Date();
  let m = now.getMonth() + 1 + 2;
  let y = now.getFullYear();
  if (m > 12) { m -= 12; y++; }
  return { year: y, month: m };
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
// 予約→セルマップ構築（凡例参照方式）
// ────────────────────────────────────────────
function buildResCellMap(year, month, reservations) {
  const legendMap  = getLegendMap(_legend);
  const map        = {};
  HILS_MACHINES.forEach(m => { map[m] = {}; });

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month - 1, daysInMonth(year, month));

  reservations.forEach((res, resId) => {
    if (!map[res.machine]) return;

    const resStart = isoToDate(res.start);
    const resEnd   = isoToDate(res.end);
    if (resEnd < monthStart || resStart > monthEnd) return;

    const dispStart   = resStart < monthStart ? new Date(monthStart) : new Date(resStart);
    const dispEnd     = resEnd   > monthEnd   ? new Date(monthEnd)   : new Date(resEnd);
    const isRealStart = resStart >= monthStart;
    const isRealEnd   = resEnd   <= monthEnd;

    // 凡例参照で色を解決
    const color = (res.legendId && legendMap[res.legendId])
      ? legendMap[res.legendId].color
      : (res.color || '#fde68a');

    let firstCol = null;
    let lastCol  = null;

    for (let d = new Date(dispStart); d <= dispEnd; d.setDate(d.getDate() + 1)) {
      const col  = d.getDate() - 1;
      const wday = d.getDay();
      if (wday === 0 || wday === 6) continue;
      if (firstCol === null) firstCol = col;
      lastCol = col;
      map[res.machine][col] = {
        resId,
        color,
        label:   res.label || '',
        isStart: false,
        isEnd:   false,
      };
    }
    if (firstCol !== null) map[res.machine][firstCol].isStart = isRealStart;
    if (lastCol  !== null) map[res.machine][lastCol].isEnd   = isRealEnd;
  });

  return map;
}

// ────────────────────────────────────────────
// カレンダー描画
// ────────────────────────────────────────────
function renderCalendar() {
  const { year, month, reservations, selectedCells, selectedResId } = state;
  const days     = daysInMonth(year, month);
  const firstDay = new Date(year, month - 1, 1).getDay();

  const today  = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  document.getElementById('month-label').textContent = `${year}年${month}月`;

  const max = maxCalYM();
  document.getElementById('prev-btn').disabled =
    year === CAL_MIN.year && month === CAL_MIN.month;
  document.getElementById('next-btn').disabled =
    year === max.year && month === max.month;

  // thead
  const thead     = document.getElementById('gantt-head');
  thead.innerHTML = '';
  const headerRow = document.createElement('tr');
  const thMachine = document.createElement('th');
  thMachine.className   = 'machine-col';
  thMachine.textContent = '筐体';
  headerRow.appendChild(thMachine);

  for (let d = 1; d <= days; d++) {
    const wday   = (firstDay + d - 1) % 7;
    const wdayJp = wday === 0 ? 6 : wday - 1;
    const isWkd  = (wday === 0 || wday === 6);
    const isTod  = (year === todayY && month === todayM && d === todayD);
    const th     = document.createElement('th');
    th.className = 'date-col' + (isWkd ? ' weekend' : '') + (isTod ? ' today-hd' : '');
    th.innerHTML = `${d}<br><span style="font-size:10px;font-weight:normal">${WEEKDAY_JP[wdayJp]}</span>`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  // tbody
  const tbody     = document.getElementById('gantt-body');
  tbody.innerHTML = '';
  const resCells  = buildResCellMap(year, month, reservations);

  // ドラッグ中プレビュー: previewMap[key]={color} / ghostKeys=Set
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

  HILS_MACHINES.forEach((machine, rowIdx) => {
    const tr = document.createElement('tr');

    const tdMachine = document.createElement('td');
    tdMachine.className   = 'machine-col';
    tdMachine.textContent = machine;
    tdMachine.title       = machine;
    tr.appendChild(tdMachine);

    for (let col = 0; col < days; col++) {
      const d       = col + 1;
      const wday    = (firstDay + col) % 7;
      const isWkd   = (wday === 0 || wday === 6);
      const isTod   = (year === todayY && month === todayM && d === todayD);
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

        if (resInfo.isStart) {
          const labelEl = document.createElement('span');
          labelEl.className   = 'res-label';
          labelEl.textContent = resInfo.label;
          td.appendChild(labelEl);
        }

        td.addEventListener('mousemove', e => {
          if (_drag.active) return;
          const rect = td.getBoundingClientRect();
          const xIn  = e.clientX - rect.left;
          const isL  = resInfo.isStart && xIn < EDGE_PX;
          const isR  = resInfo.isEnd   && xIn > rect.width - EDGE_PX;
          td.style.cursor = (isL || isR) ? 'ew-resize' : 'grab';
        });
        td.addEventListener('mousedown', onResMouseDown);
        td.addEventListener('click', () => {
          if (!_drag.didMove) onResClick(resInfo.resId);
        });
        td.addEventListener('dblclick', () => openEditDialog(resInfo.resId));
      } else if (!isWkd) {
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
    tbody.appendChild(tr);
  });
}

// ────────────────────────────────────────────
// 予約ドラッグ（移動 / リサイズ）
// ────────────────────────────────────────────
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
  if (e.button !== 0) return;
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

function onDragResMove(e) {
  if (!_drag.active) return;

  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) return;

  const { year, month } = state;
  const days      = daysInMonth(year, month);
  const { mode, resId, origRow, origStart, origEnd, origBiz, clickCol } = _drag;
  const res       = state.reservations[resId];
  if (!res) return;

  const curRow = cell.row;
  const curCol = Math.max(0, Math.min(cell.col, days - 1));
  const curDate = new Date(year, month - 1, curCol + 1);

  let newStart = new Date(origStart);
  let newEnd   = new Date(origEnd);
  let newRow   = origRow;

  if (mode === 'move') {
    // 表示月内での元開始列（月前→0, 月後→days）
    const origDispCol = origStart.getFullYear() === year && origStart.getMonth() === month - 1
      ? origStart.getDate() - 1 : (origStart < new Date(year, month - 1, 1) ? 0 : days);
    const offset = clickCol - origDispCol;
    const nsCol  = Math.max(0, Math.min(curCol - offset, days - 1));
    let ns = nearestWeekday(new Date(year, month - 1, nsCol + 1), true);
    // 20営業日クランプ: origBizがMAX超なら既存を尊重
    const biz  = Math.min(origBiz, MAX_BIZ_DAYS);
    let ne     = addBizDays(ns, biz);
    newStart   = ns;
    newEnd     = ne;
    newRow     = curRow;
  } else if (mode === 're') {
    // 右端ドラッグ: 終了日を変更
    let ne = nearestWeekday(curDate, false);
    if (ne < origStart) ne = nearestWeekday(new Date(origStart), true);
    if (bizDaysBetween(origStart, ne) > MAX_BIZ_DAYS) {
      ne = addBizDays(origStart, MAX_BIZ_DAYS);
    }
    newStart = new Date(origStart);
    newEnd   = ne;
    newRow   = origRow;
  } else if (mode === 'rs') {
    // 左端ドラッグ: 開始日を変更
    let ns = nearestWeekday(curDate, true);
    if (ns > origEnd) ns = nearestWeekday(new Date(origEnd), false);
    if (bizDaysBetween(ns, origEnd) > MAX_BIZ_DAYS) {
      ns = startForBizDays(origEnd, MAX_BIZ_DAYS);
    }
    newStart = ns;
    newEnd   = new Date(origEnd);
    newRow   = origRow;
  }

  _drag.didMove  = true;
  _drag.newStart = newStart;
  _drag.newEnd   = newEnd;
  _drag.newRow   = newRow;

  // プレビュー / ゴーストセルを算出
  const previewCells = new Set();
  const ghostCells   = new Set();
  const newMachine   = HILS_MACHINES[newRow];

  for (let d = new Date(newStart); d <= newEnd; d.setDate(d.getDate() + 1)) {
    if (d.getFullYear() === year && d.getMonth() === month - 1) {
      const c = d.getDate() - 1;
      if (d.getDay() !== 0 && d.getDay() !== 6) previewCells.add(`${newRow}-${c}`);
    }
  }
  for (let d = new Date(origStart); d <= origEnd; d.setDate(d.getDate() + 1)) {
    if (d.getFullYear() === year && d.getMonth() === month - 1) {
      const c = d.getDate() - 1;
      if (d.getDay() !== 0 && d.getDay() !== 6) ghostCells.add(`${origRow}-${c}`);
    }
  }

  _drag.previewCells = previewCells;
  _drag.ghostCells   = ghostCells;

  renderCalendar();
}

function onDragResUp() {
  if (!_drag.active) return;
  _drag.active = false;
  document.body.style.cursor = '';

  if (_drag.didMove && _drag.newStart && _drag.newEnd) {
    const { resId, newStart, newEnd, newRow } = _drag;
    const res        = state.reservations[resId];
    const newMachine = HILS_MACHINES[newRow];
    if (res && !checkOverlap(resId, newMachine, newStart, newEnd)) {
      state.reservations[resId] = {
        ...res,
        machine: newMachine,
        start:   dateToIso(newStart),
        end:     dateToIso(newEnd),
      };
      saveReservations(state.reservations);
      updateInfoPanel();
    }
  }

  _drag.previewCells = null;
  _drag.ghostCells   = null;
  _drag.newStart     = null;
  _drag.newEnd       = null;
  _drag.didMove      = false;

  renderCalendar();
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
let _isDragging = false;
let _dragRow    = null;

function onCellMouseDown(e) {
  if (_drag.active) return;
  const td  = e.currentTarget;
  const row = parseInt(td.dataset.row);
  const col = parseInt(td.dataset.col);

  _isDragging = true;
  _dragRow    = row;

  state.selectedResId = null;
  state.selectedCells = new Set([`${row}-${col}`]);
  state.anchorCell    = { row, col };

  updateInfoPanel();
  renderCalendar();
}

function onCellMouseOver(e) {
  if (!_isDragging || !state.anchorCell) return;
  const td  = e.currentTarget;
  const row = parseInt(td.dataset.row);
  const col = parseInt(td.dataset.col);
  if (row !== _dragRow) return;

  const anchor   = state.anchorCell;
  const minCol   = Math.min(anchor.col, col);
  const maxCol   = Math.max(anchor.col, col);
  const firstDay = new Date(state.year, state.month - 1, 1).getDay();

  state.selectedCells = new Set();
  for (let c = minCol; c <= maxCol; c++) {
    const wday = (firstDay + c) % 7;
    if (wday !== 0 && wday !== 6) state.selectedCells.add(`${row}-${c}`);
  }
  renderCalendar();
}

document.addEventListener('mouseup', () => { _isDragging = false; });

function onResClick(resId) {
  state.selectedResId = resId;
  state.selectedCells = new Set();
  state.anchorCell    = null;
  updateInfoPanel();
  renderCalendar();
}

// ────────────────────────────────────────────
// 選択情報パネル
// ────────────────────────────────────────────
function updateInfoPanel() {
  const { selectedResId, reservations } = state;
  const hint    = document.getElementById('info-hint');
  const machine = document.getElementById('info-machine');
  const period  = document.getElementById('info-period');
  const label   = document.getElementById('info-label');
  const editBtn = document.getElementById('edit-btn');

  if (selectedResId === null || !reservations[selectedResId]) {
    hint.classList.remove('hidden');
    [machine, period, label, editBtn].forEach(el => el.classList.add('hidden'));
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
  [machine, period, label, editBtn].forEach(el => el.classList.remove('hidden'));
  machine.textContent = `筐体:  ${res.machine}`;
  period.textContent  = `期間:  ${periodStr}  （${biz}営業日）`;
  label.textContent   = `ラベル:  ${res.label || ''}`;
}

// ────────────────────────────────────────────
// 月ナビ
// ────────────────────────────────────────────
document.getElementById('prev-btn').addEventListener('click', () => {
  if (state.month === 1) { state.year--; state.month = 12; }
  else state.month--;
  clearSelection();
  renderCalendar();
});
document.getElementById('next-btn').addEventListener('click', () => {
  if (state.month === 12) { state.year++; state.month = 1; }
  else state.month++;
  clearSelection();
  renderCalendar();
});
document.getElementById('today-btn').addEventListener('click', () => {
  const now = new Date();
  state.year  = now.getFullYear();
  state.month = now.getMonth() + 1;
  clearSelection();
  renderCalendar();
});
function clearSelection() {
  state.selectedCells = new Set();
  state.selectedResId = null;
  state.anchorCell    = null;
  updateInfoPanel();
}

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
    swatch.title = '色を変更';
    swatch.addEventListener('click', e => {
      e.stopPropagation();
      openColorPicker(swatch, idx);
    });

    const nameInput = document.createElement('input');
    nameInput.type      = 'text';
    nameInput.className = 'legend-name-input';
    nameInput.value     = leg.name;
    nameInput.addEventListener('change', () => {
      _legend[idx].name = nameInput.value.trim() || _legend[idx].name;
      saveLegend(_legend);
    });

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

    row.appendChild(swatch);
    row.appendChild(nameInput);
    row.appendChild(delBtn);
    panel.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.className   = 'legend-add-btn';
  addBtn.textContent = '＋ 凡例追加';
  addBtn.addEventListener('click', () => {
    _legend.push({ id: genLegendId(), name: '新しい凡例', color: LEGEND_PALETTE[0] });
    saveLegend(_legend);
    renderLegendPanel();
  });
  panel.appendChild(addBtn);
}

// カラーパレットポップオーバー
let _activePopover = null;

function openColorPicker(anchorEl, legendIdx) {
  closeColorPicker();
  const pop = document.createElement('div');
  pop.className = 'color-popover';

  LEGEND_PALETTE.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'palette-swatch';
    sw.style.background = hex;
    sw.title = hex;
    if (_legend[legendIdx] && _legend[legendIdx].color.toLowerCase() === hex.toLowerCase()) {
      sw.classList.add('palette-selected');
    }
    sw.addEventListener('click', e => {
      e.stopPropagation();
      _legend[legendIdx].color = hex;
      saveLegend(_legend);
      closeColorPicker();
      renderLegendPanel();
      renderCalendar();
    });
    pop.appendChild(sw);
  });

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
document.getElementById('edit-btn').addEventListener('click', () => {
  if (state.selectedResId !== null) openEditDialog(state.selectedResId);
});

function openRegisterDialog() {
  const sel = state.selectedCells;
  if (!sel.size) {
    alert('筐体と期間をカレンダー上で選択してから「＋ 登録」を押してください');
    return;
  }
  const rows = [...sel].map(k => parseInt(k.split('-')[0]));
  if (new Set(rows).size !== 1) return;

  const row      = rows[0];
  const cols     = [...sel].map(k => parseInt(k.split('-')[1]));
  const { year, month } = state;
  const startDay = Math.min(...cols) + 1;
  const endDay   = Math.max(...cols) + 1;
  const defLeg   = _legend.length > 0 ? _legend[0].id : '';

  showDialog('予約登録', {
    machine:  HILS_MACHINES[row],
    startIso: `${year}-${String(month).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
    endIso:   `${year}-${String(month).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`,
    label:    '',
    legendId: defLeg,
  }, 'register');
}

function openEditDialog(resId) {
  const res = state.reservations[resId];
  if (!res) return;
  showDialog('予約を編集', {
    machine:  res.machine,
    startIso: res.start.split('T')[0],
    endIso:   res.end.split('T')[0],
    label:    res.label || '',
    legendId: res.legendId || (_legend.length > 0 ? _legend[0].id : ''),
  }, 'edit', resId);
}

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
      <label>筐体:</label>
      <select id="f-machine">
        ${HILS_MACHINES.map(m =>
          `<option value="${m}"${m === data.machine ? ' selected' : ''}>${m}</option>`
        ).join('')}
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
    <div class="form-row">
      <label>ラベル:</label>
      <input type="text" id="f-label" value="${data.label}" placeholder="プロジェクト名など">
    </div>
    <div class="form-row">
      <label>分類:</label>
      <div class="legend-select-wrap">
        <div id="f-swatch" class="legend-select-swatch"></div>
        <select id="f-legend">${buildLegendSelect(data.legendId)}</select>
      </div>
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
    if (biz > MAX_BIZ_DAYS) {
      wEl.textContent = `⚠ 最大 ${MAX_BIZ_DAYS} 営業日を超えています`;
      wEl.classList.remove('hidden');
      okBtn.disabled = true;
    } else {
      wEl.classList.add('hidden');
      okBtn.disabled = false;
    }
  }
  document.getElementById('f-start').addEventListener('change', updateBiz);
  document.getElementById('f-end').addEventListener('change', updateBiz);
  updateBiz();
  overlay.classList.remove('hidden');

  okBtn.onclick = () => {
    const legendId = document.getElementById('f-legend').value;
    const lm       = getLegendMap(_legend);
    const color    = lm[legendId] ? lm[legendId].color : '#fde68a';
    const resData  = {
      machine:  document.getElementById('f-machine').value,
      start:    document.getElementById('f-start').value,
      end:      document.getElementById('f-end').value,
      label:    document.getElementById('f-label').value.trim(),
      legendId,
      color,
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

  renderCalendar();
  renderLegendPanel();
  updateInfoPanel();
}

init();
