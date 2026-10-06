// 設定頁的「座位表」分頁：版本、拖曳換座位、名單、CSV 匯入匯出。
// 每次調整都立刻存檔（觸控螢幕上不必再找「儲存」），並提供「復原」。

import {
  cellKey,
  currentVersion,
  unassigned,
  placeStudent,
  swapSeats,
  removeStudent,
  shuffleAll,
  shiftRows,
  shiftCols,
  mirror,
  parseRosterCsv,
  rosterCsv,
  upsertStudent,
  resize,
  toggleBlocked,
  cleanAssign,
  seatKeys,
  newId,
  parseKey,
} from './seating.js';
import { dayKey } from './schedule.js';

const $ = (sel) => document.querySelector(sel);
const DRAG_START_PX = 8;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

/** @param {{ store: import('./store.js').Store }} deps */
export function setupSeatEditor({ store }) {
  let seating = store.seating();
  let editingId = null; // 正在編輯哪一版
  let layoutMode = false;
  let selected = null; // 點選模式：{ type: 'seat', key } | { type: 'pool', no }
  const undoStack = [];

  const today = () => dayKey(new Date());
  const editing = () => seating.versions.find((v) => v.id === editingId) || null;
  const nameOf = (no) => seating.students.find((s) => s.no === no)?.name || '';

  /** 改資料：先存一份可以復原，再存檔、重畫 */
  function commit(next) {
    undoStack.push(JSON.stringify(seating));
    if (undoStack.length > 50) undoStack.shift();
    seating = next;
    store.saveSeating(seating);
    render();
  }

  function setAssign(assign) {
    const v = editing();
    if (!v) return;
    commit({ ...seating, versions: seating.versions.map((x) => (x.id === v.id ? { ...x, assign } : x)) });
  }

  /** 沒有任何版本時，自動建立第一版 */
  function ensureVersion(next) {
    if (next.versions.length) return next;
    const v = { id: newId(), name: '座位表', from: today(), setAt: Date.now(), assign: {} };
    editingId = v.id;
    return { ...next, versions: [v] };
  }

  // ---------- 畫面 ----------

  function render() {
    if (!editing()) editingId = currentVersion(seating, today())?.id || null;
    renderVersionBar();
    renderGrid();
    renderPool();
    renderRoster();
    $('#seatUndo').disabled = undoStack.length === 0;
    $('#seatViewToggle').textContent = seating.view === 'teacher' ? '目前：講台在上（老師視角）' : '目前：講台在下（學生視角）';
    $('#seatLayoutToggle').textContent = layoutMode ? '✓ 完成版面' : '編輯版面';
    $('#seatLayoutBar').hidden = !layoutMode;
    $('#seatRows').value = seating.rows;
    $('#seatCols').value = seating.cols;
  }

  function renderVersionBar() {
    const cur = currentVersion(seating, today());
    const v = editing();
    $('#seatVersion').replaceChildren(
      ...seating.versions.map((x) =>
        el('option', {
          value: x.id,
          selected: x.id === editingId,
          textContent: `${x.name}${x.from ? `（${shortDate(x.from)} 起）` : '（未設定日期）'}${x.id === cur?.id ? '・使用中' : ''}`,
        }),
      ),
    );
    for (const id of ['#seatVersion', '#seatVersionName', '#seatVersionFrom', '#seatUseToday', '#seatDeleteVersion']) $(id).disabled = !v;
    $('#seatVersionName').value = v ? v.name : '';
    $('#seatVersionFrom').value = v ? v.from : '';
    for (const b of document.querySelectorAll('[data-shift], #seatShuffle, #seatMirror, #seatClear')) b.disabled = !v || layoutMode;
  }

  /** 依視角排出格子順序：學生視角講台在下、老師視角講台在上且左右相反 */
  function orderedCells() {
    const rows = [];
    const teacher = seating.view === 'teacher';
    for (let i = 0; i < seating.rows; i++) {
      const r = teacher ? i + 1 : seating.rows - i;
      const cols = [];
      for (let j = 0; j < seating.cols; j++) cols.push(teacher ? seating.cols - j : j + 1);
      rows.push(cols.map((c) => ({ r, c })));
    }
    return rows;
  }

  function renderGrid() {
    const v = editing();
    const assign = v ? v.assign : {};
    const blocked = new Set(seating.blocked);
    const grid = $('#seatGrid');
    grid.style.setProperty('--cols', seating.cols);
    const podium = el('div', { className: 'podium', textContent: '講　台' });
    const cells = [];
    for (const row of orderedCells()) {
      for (const { r, c } of row) {
        const key = cellKey(r, c);
        const cell = el('div', { className: 'seat' });
        cell.dataset.key = key;
        cell.title = `第 ${r} 排・第 ${c} 欄`;
        if (blocked.has(key)) {
          cell.classList.add('blocked');
          cell.textContent = '沒有座位';
        } else if (assign[key]) {
          const tag = nameTag(assign[key], { type: 'seat', key });
          cell.append(tag);
        } else {
          cell.classList.add('empty');
        }
        if (selected && selected.type === 'seat' && selected.key === key) cell.classList.add('selected');
        cells.push(cell);
      }
    }
    if (seating.view === 'teacher') grid.replaceChildren(podium, ...cells);
    else grid.replaceChildren(...cells, podium);

    const seats = seatKeys(seating).length;
    const seated = Object.keys(assign).length;
    const left = v ? unassigned(seating, v).length : seating.students.length;
    $('#seatSummary').textContent = `${seating.students.length} 位學生・${seats} 個座位・已安排 ${seated} 人${left ? `・未安排 ${left} 人` : ''}`;
  }

  function nameTag(no, source) {
    const tag = el('div', { className: 'tag' }, [el('span', { className: 'no', textContent: no }), el('span', { className: 'name', textContent: nameOf(no) })]);
    tag.dataset.source = JSON.stringify(source);
    if (selected && selected.type === 'pool' && source.type === 'pool' && selected.no === no) tag.classList.add('selected');
    return tag;
  }

  function renderPool() {
    const v = editing();
    const list = v ? unassigned(seating, v) : seating.students;
    const pool = $('#seatPool');
    pool.replaceChildren(...list.map((s) => nameTag(s.no, { type: 'pool', no: s.no })));
    if (!list.length) pool.append(el('span', { className: 'hint', textContent: seating.students.length ? '全部都有座位了' : '還沒有學生，請在下方新增或匯入 CSV' }));
  }

  function renderRoster() {
    $('#rosterList').replaceChildren(
      ...seating.students.map((s) => {
        const del = el('button', { textContent: '刪除', className: 'danger' });
        del.addEventListener('click', () => {
          if (!confirm(`從名單刪除 ${s.no} ${s.name}？（所有版本裡的座位也會一起移除）`)) return;
          const students = seating.students.filter((x) => x.no !== s.no);
          const next = { ...seating, students };
          next.versions = seating.versions.map((v) => ({ ...v, assign: cleanAssign(next, v.assign) }));
          commit(next);
        });
        return el('div', { className: 'roster-row' }, [el('span', { textContent: `${s.no}　${s.name}` }), del]);
      }),
    );
  }

  // ---------- 拖曳與點選 ----------

  function drop(source, target) {
    const v = editing();
    if (!v || !target) return;
    if (target.type === 'seat') {
      if (source.type === 'seat') setAssign(swapSeats(v.assign, source.key, target.key));
      else setAssign(placeStudent(v.assign, source.no, target.key));
    } else if (target.type === 'pool' && source.type === 'seat') {
      setAssign(removeStudent(v.assign, v.assign[source.key]));
    }
  }

  function targetAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    const seat = hit.closest('.seat');
    if (seat && !seat.classList.contains('blocked')) return { type: 'seat', key: seat.dataset.key };
    if (hit.closest('#seatPool')) return { type: 'pool' };
    return null;
  }

  function onPointerDown(e) {
    if (layoutMode) return;
    const tag = e.target.closest('.tag');
    if (!tag) return;
    e.preventDefault();
    const source = JSON.parse(tag.dataset.source);
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost = null;
    tag.setPointerCapture(e.pointerId);

    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > DRAG_START_PX) {
        ghost = tag.cloneNode(true);
        ghost.classList.add('ghost');
        document.body.append(ghost);
        tag.classList.add('dragging');
      }
      if (ghost) ghost.style.transform = `translate(${ev.clientX - 40}px, ${ev.clientY - 24}px)`;
    };
    const up = (ev) => {
      tag.removeEventListener('pointermove', move);
      tag.removeEventListener('pointerup', up);
      tag.removeEventListener('pointercancel', up);
      if (ghost) {
        ghost.remove();
        tag.classList.remove('dragging');
        selected = null;
        if (ev.type === 'pointerup') drop(source, targetAt(ev.clientX, ev.clientY));
        else render();
      } else {
        tapOn(source);
      }
    };
    tag.addEventListener('pointermove', move);
    tag.addEventListener('pointerup', up);
    tag.addEventListener('pointercancel', up);
  }

  /** 點選模式：先點名牌，再點目的地 */
  function tapOn(target) {
    if (!selected) {
      selected = target;
      render();
      return;
    }
    const src = selected;
    selected = null;
    const same = src.type === target.type && (src.key === target.key || (src.no && src.no === target.no));
    if (same) render();
    else drop(src, target);
  }

  $('#seatGrid').addEventListener('pointerdown', onPointerDown);
  $('#seatPool').addEventListener('pointerdown', onPointerDown);

  // 點空位或「未安排」區（不是名牌）：放下已選的名牌；版面模式時切換有沒有座位
  $('#seatGrid').addEventListener('click', (e) => {
    const seat = e.target.closest('.seat');
    if (!seat) return;
    if (layoutMode) {
      commit(toggleBlocked(seating, seat.dataset.key));
      return;
    }
    if (selected && !e.target.closest('.tag') && !seat.classList.contains('blocked')) tapOn({ type: 'seat', key: seat.dataset.key });
  });
  $('#seatPool').addEventListener('click', (e) => {
    if (selected && selected.type === 'seat' && !e.target.closest('.tag')) tapOn({ type: 'pool' });
  });

  // ---------- 工具列 ----------

  $('#seatShuffle').addEventListener('click', () => {
    if (Object.keys(editing().assign).length && !confirm('隨機重排這一版的所有座位？（可以按「復原」）')) return;
    setAssign(shuffleAll(seating));
  });
  for (const b of document.querySelectorAll('[data-shift]')) {
    b.addEventListener('click', () => {
      const [axis, dir] = b.dataset.shift.split(',');
      const fn = axis === 'row' ? shiftRows : shiftCols;
      setAssign(fn(seating, editing().assign, Number(dir)));
    });
  }
  $('#seatMirror').addEventListener('click', () => setAssign(mirror(seating, editing().assign)));
  $('#seatClear').addEventListener('click', () => {
    if (!confirm('清空這一版的所有座位？（可以按「復原」）')) return;
    setAssign({});
  });
  $('#seatUndo').addEventListener('click', () => {
    if (!undoStack.length) return;
    seating = JSON.parse(undoStack.pop());
    store.saveSeating(seating);
    selected = null;
    render();
  });
  $('#seatViewToggle').addEventListener('click', () => commit({ ...seating, view: seating.view === 'teacher' ? 'student' : 'teacher' }));
  $('#seatLayoutToggle').addEventListener('click', () => {
    layoutMode = !layoutMode;
    selected = null;
    render();
  });
  const onResize = () => {
    const rows = Math.min(12, Math.max(1, Number($('#seatRows').value) || 1));
    const cols = Math.min(12, Math.max(1, Number($('#seatCols').value) || 1));
    if (rows === seating.rows && cols === seating.cols) return;
    commit(resize(seating, rows, cols));
  };
  $('#seatRows').addEventListener('change', onResize);
  $('#seatCols').addEventListener('change', onResize);

  // ---------- 版本 ----------

  $('#seatVersion').addEventListener('change', (e) => {
    editingId = e.target.value;
    selected = null;
    render();
  });
  $('#seatVersionName').addEventListener('change', (e) => {
    const name = e.target.value.trim() || '未命名';
    commit({ ...seating, versions: seating.versions.map((x) => (x.id === editingId ? { ...x, name } : x)) });
  });
  $('#seatVersionFrom').addEventListener('change', (e) => {
    const from = e.target.value;
    commit({ ...seating, versions: seating.versions.map((x) => (x.id === editingId ? { ...x, from, setAt: Date.now() } : x)) });
  });
  $('#seatUseToday').addEventListener('click', () => {
    commit({ ...seating, versions: seating.versions.map((x) => (x.id === editingId ? { ...x, from: today(), setAt: Date.now() } : x)) });
  });
  $('#seatNewVersion').addEventListener('click', () => {
    const base = editing();
    const v = { id: newId(), name: `第 ${seating.versions.length + 1} 次換座位`, from: '', setAt: Date.now(), assign: base ? { ...base.assign } : {} };
    editingId = v.id;
    commit({ ...seating, versions: [...seating.versions, v] });
  });
  $('#seatDeleteVersion').addEventListener('click', () => {
    const v = editing();
    if (!v || !confirm(`刪除版本「${v.name}」？（可以按「復原」）`)) return;
    editingId = null;
    commit({ ...seating, versions: seating.versions.filter((x) => x.id !== v.id) });
  });

  // ---------- 名單 ----------

  $('#rosterAdd').addEventListener('click', () => {
    const no = $('#rosterNo').value.trim();
    const name = $('#rosterName').value.trim();
    if (!no || !name) {
      alert('請填座號和姓名');
      return;
    }
    commit(ensureVersion({ ...seating, students: upsertStudent(seating.students, no, name) }));
    $('#rosterNo').value = '';
    $('#rosterName').value = '';
    $('#rosterNo').focus();
  });

  $('#rosterImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const { students, positions, errors } = parseRosterCsv(await file.text());
    if (!students.length) {
      alert(`檔案裡沒有讀到學生。${errors.length ? `\n${errors.join('\n')}` : ''}`);
      return;
    }
    const hasPos = Object.keys(positions).length > 0;
    const msg = [
      `讀到 ${students.length} 位學生${hasPos ? `，其中 ${Object.keys(positions).length} 位有座位` : ''}。`,
      seating.students.length ? `會取代目前的名單（${seating.students.length} 人）。` : '',
      hasPos ? '座位會存成一個新版本，今天起使用。' : '',
      errors.length ? `\n略過：\n${errors.join('\n')}` : '',
      '\n確定匯入？',
    ].join('');
    if (!confirm(msg)) return;

    let next = { ...seating, students };
    if (hasPos) {
      // 版面不夠大就自動放大
      const maxR = Math.max(...Object.keys(positions).map((k) => parseKey(k).r));
      const maxC = Math.max(...Object.keys(positions).map((k) => parseKey(k).c));
      if (maxR > next.rows || maxC > next.cols) next = resize(next, Math.max(maxR, next.rows), Math.max(maxC, next.cols));
      next = { ...next, blocked: next.blocked.filter((k) => !positions[k]) };
    }
    next.versions = next.versions.map((v) => ({ ...v, assign: cleanAssign(next, v.assign) }));
    if (hasPos) {
      const v = { id: newId(), name: `匯入 ${shortDate(today())}`, from: today(), setAt: Date.now(), assign: cleanAssign(next, positions) };
      next.versions = [...next.versions, v];
      editingId = v.id;
    }
    commit(ensureVersion(next));
  });

  $('#rosterExport').addEventListener('click', () => {
    const csv = rosterCsv(seating, editing());
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv' }));
    el('a', { href: url, download: `座位表-${editing()?.name || '名單'}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return {
    /** 打開設定頁時重新讀取（另一個分頁可能改過） */
    refresh() {
      seating = store.seating();
      selected = null;
      render();
    },
  };
}
