'use strict';

// ────────────────────────────────────────────
// 定数（Pythonアプリの HILS_MACHINES と一致）
// ────────────────────────────────────────────
const HILS_MACHINES = [
  'HELIOS-1号機',
  'HELIOS-2号機',
  'HELIOS-3号機',
  'HELIOS-4号機',
  'HELIOS-5号機',
  'HELIOS-6号機（テン）',
  'HELIOS-7号機（佐藤）',
  'HELIOS-8号機（進藤）',
  'HELIOS-9号機（柴山）',
  'HELIOS-10号機（大堀）',
  'HELIOS-11号機（森田）',
  'HELIOS-12号機（パッタナー）',
  'HELIOS-13号機（樽井）',
  'HELIOS-14号機（中台）',
  'HELIOS-15号機（李開一）',
  'HELIOS-16号機（ウー）',
  'HELIOS-24号機（馬）',
  'HEV-BATT-3号機',
  'HEV-BATT-5号機',
  'BATTハーネスが1本しかない',
];

const WEEKDAY_JP = ['月', '火', '水', '木', '金', '土', '日'];
const CAL_MIN    = { year: 2025, month: 12 };
const MAX_BIZ_DAYS = 20;

// ────────────────────────────────────────────
// アプリ状態
// ────────────────────────────────────────────
const state = {
  year:         new Date().getFullYear(),
  month:        new Date().getMonth() + 1,
  reservations: [],
  selectedCells: new Set(),  // "row-col" 形式のキー
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
// バックエンド API
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

async function saveReservation(data) {
  const res = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function updateReservation(id, data) {
  const res = await fetch(`/api/reservations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ────────────────────────────────────────────
// 予約→セルマップ構築
// ────────────────────────────────────────────
function buildResCellMap(year, month, reservations) {
  // map[machineName][col] = { resId, color, label, isStart }
  const map = {};
  HILS_MACHINES.forEach(m => { map[m] = {}; });

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month - 1, daysInMonth(year, month));

  reservations.forEach((res, resId) => {
    if (!map[res.machine]) return;

    const resStart = isoToDate(res.start);
    const resEnd   = isoToDate(res.end);

    if (resEnd < monthStart || resStart > monthEnd) return;

    const dispStart = resStart < monthStart ? new Date(monthStart) : new Date(resStart);
    const dispEnd   = resEnd   > monthEnd   ? new Date(monthEnd)   : new Date(resEnd);

    let firstWeekdayCol = null;

    for (let d = new Date(dispStart); d <= dispEnd; d.setDate(d.getDate() + 1)) {
      const col  = d.getDate() - 1;
      const wday = d.getDay();
      if (wday === 0 || wday === 6) continue;  // 土日はスキップ

      if (firstWeekdayCol === null) firstWeekdayCol = col;

      map[res.machine][col] = {
        resId,
        color:   res.color || '#fde68a',
        label:   res.label || '',
        isStart: col === firstWeekdayCol,
      };
    }
  });

  return map;
}

// ────────────────────────────────────────────
// カレンダー描画
// ────────────────────────────────────────────
function renderCalendar() {
  const { year, month, reservations, selectedCells, selectedResId } = state;
  const days     = daysInMonth(year, month);
  const firstDay = new Date(year, month - 1, 1).getDay();  // 0=Sun

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  document.getElementById('month-label').textContent = `${year}年${month}月`;

  const max = maxCalYM();
  document.getElementById('prev-btn').disabled =
    year === CAL_MIN.year && month === CAL_MIN.month;
  document.getElementById('next-btn').disabled =
    year === max.year && month === max.month;

  // ── thead ──
  const thead = document.getElementById('gantt-head');
  thead.innerHTML = '';
  const headerRow = document.createElement('tr');

  const thMachine = document.createElement('th');
  thMachine.className = 'machine-col';
  thMachine.textContent = '環境名';
  headerRow.appendChild(thMachine);

  for (let d = 1; d <= days; d++) {
    const wday = (firstDay + d - 1) % 7;  // 0=Sun..6=Sat
    const wdayJp = wday === 0 ? 6 : wday - 1;  // 0=月..6=日
    const isWkd  = (wday === 0 || wday === 6);
    const isTod  = (year === todayY && month === todayM && d === todayD);

    const th = document.createElement('th');
    th.className = 'date-col' + (isWkd ? ' weekend' : '') + (isTod ? ' today-hd' : '');
    th.innerHTML = `${d}<br><span style="font-size:10px;font-weight:normal">${WEEKDAY_JP[wdayJp]}</span>`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  // ── tbody ──
  const tbody = document.getElementById('gantt-body');
  tbody.innerHTML = '';
  const resCells = buildResCellMap(year, month, reservations);

  HILS_MACHINES.forEach((machine, rowIdx) => {
    const tr = document.createElement('tr');

    const tdMachine = document.createElement('td');
    tdMachine.className = 'machine-col';
    tdMachine.textContent = machine;
    tdMachine.title = machine;
    tr.appendChild(tdMachine);

    for (let col = 0; col < days; col++) {
      const d    = col + 1;
      const wday = (firstDay + col) % 7;
      const isWkd = (wday === 0 || wday === 6);
      const isTod  = (year === todayY && month === todayM && d === todayD);
      const cellKey = `${rowIdx}-${col}`;
      const resInfo = resCells[machine]?.[col];

      const td = document.createElement('td');
      td.className = 'gantt-cell' +
        (isWkd ? ' weekend' : '') +
        (isTod ? ' today-cell' : '') +
        (selectedCells.has(cellKey) ? ' selected' : '') +
        (resInfo && selectedResId === resInfo.resId ? ' res-selected' : '');
      td.dataset.row = rowIdx;
      td.dataset.col = col;

      if (resInfo) {
        td.style.backgroundColor = resInfo.color;
        td.dataset.resId = resInfo.resId;

        if (resInfo.isStart) {
          const labelEl = document.createElement('span');
          labelEl.className = 'res-label';
          labelEl.textContent = resInfo.label;
          td.appendChild(labelEl);
        }

        td.addEventListener('click', () => onResClick(resInfo.resId));
        td.addEventListener('dblclick', () => openEditDialog(resInfo.resId));
      } else if (!isWkd) {
        td.addEventListener('mousedown', onCellMouseDown);
        td.addEventListener('mouseover', onCellMouseOver);
      }

      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
}

// ────────────────────────────────────────────
// セル選択（範囲ドラッグ）
// ────────────────────────────────────────────
let _isDragging = false;
let _dragRow    = null;

function onCellMouseDown(e) {
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

  const anchor  = state.anchorCell;
  const minCol  = Math.min(anchor.col, col);
  const maxCol  = Math.max(anchor.col, col);
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
    machine.classList.add('hidden');
    period.classList.add('hidden');
    label.classList.add('hidden');
    editBtn.classList.add('hidden');
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
  machine.classList.remove('hidden');
  period.classList.remove('hidden');
  label.classList.remove('hidden');
  editBtn.classList.remove('hidden');

  machine.textContent = `機種:  ${res.machine}`;
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
// 登録・編集ダイアログ
// ────────────────────────────────────────────
document.getElementById('register-btn').addEventListener('click', openRegisterDialog);
document.getElementById('edit-btn').addEventListener('click', () => {
  if (state.selectedResId !== null) openEditDialog(state.selectedResId);
});

function openRegisterDialog() {
  const sel = state.selectedCells;
  if (!sel.size) {
    alert('環境と期間をカレンダー上で選択してから「＋ 登録」を押してください');
    return;
  }

  const rows = [...sel].map(k => parseInt(k.split('-')[0]));
  if (new Set(rows).size !== 1) return;

  const row  = rows[0];
  const cols = [...sel].map(k => parseInt(k.split('-')[1]));
  const { year, month } = state;
  const startDay = Math.min(...cols) + 1;
  const endDay   = Math.max(...cols) + 1;

  showDialog('予約登録', {
    machine: HILS_MACHINES[row],
    startIso: `${year}-${String(month).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
    endIso:   `${year}-${String(month).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`,
    label: '',
    color: '#fde68a',
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
    color:    res.color || '#fde68a',
  }, 'edit', resId);
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
      <label>機種:</label>
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
      <label>色:</label>
      <input type="color" id="f-color" value="${data.color}">
    </div>
    <div id="f-biz"  class="biz-label"></div>
    <div id="f-warn" class="warn-label hidden"></div>
  `;

  function updateBiz() {
    const s = document.getElementById('f-start').value;
    const e = document.getElementById('f-end').value;
    const bizEl  = document.getElementById('f-biz');
    const warnEl = document.getElementById('f-warn');
    if (!s || !e) return;

    const ds = isoToDate(s), de = isoToDate(e);
    if (ds > de) {
      bizEl.textContent = '営業日数: —';
      warnEl.textContent = '終了日が開始日より前です';
      warnEl.classList.remove('hidden');
      okBtn.disabled = true;
      return;
    }
    const biz = bizDaysBetween(ds, de);
    bizEl.textContent = `営業日数:  ${biz} 日`;
    if (biz > MAX_BIZ_DAYS) {
      warnEl.textContent = `⚠ 最大 ${MAX_BIZ_DAYS} 営業日を超えています`;
      warnEl.classList.remove('hidden');
      okBtn.disabled = true;
    } else {
      warnEl.classList.add('hidden');
      okBtn.disabled = false;
    }
  }

  document.getElementById('f-start').addEventListener('change', updateBiz);
  document.getElementById('f-end').addEventListener('change', updateBiz);
  updateBiz();

  overlay.classList.remove('hidden');

  okBtn.onclick = async () => {
    const resData = {
      machine: document.getElementById('f-machine').value,
      start:   document.getElementById('f-start').value,
      end:     document.getElementById('f-end').value,
      label:   document.getElementById('f-label').value.trim(),
      color:   document.getElementById('f-color').value,
    };

    overlay.classList.add('hidden');

    if (mode === 'register') {
      state.reservations.push(resData);
      saveReservation(resData).catch(console.error);
    } else if (mode === 'edit' && resId !== null) {
      state.reservations[resId] = { ...state.reservations[resId], ...resData };
      state.selectedResId = resId;
      updateReservation(state.reservations[resId].id, resData).catch(console.error);
    }

    renderCalendar();
    updateInfoPanel();
  };

  document.getElementById('dialog-cancel').onclick = () => {
    overlay.classList.add('hidden');
  };
}

// ────────────────────────────────────────────
// 初期化
// ────────────────────────────────────────────
async function init() {
  setStatus('データを読み込み中...', 'orange');
  state.reservations = await fetchReservations();
  setStatus('');
  renderCalendar();
  updateInfoPanel();
}

init();
