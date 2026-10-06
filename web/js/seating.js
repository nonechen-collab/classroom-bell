// 座位表：版面（幾排幾欄、哪些格子沒有座位）＋學生名單＋多個座位分配版本。
// 這個檔案只處理資料，不碰畫面，可以直接用 node 測試。
//
// 座標：r = 第幾排（1 = 最靠近講台的第一排），c = 第幾欄（1 = 從學生面向講台看的最左邊）。
// 格子代號寫成 "r,c"，例如 "1,1"。

export const DEFAULT_SEATING = {
  version: 1,
  rows: 5,
  cols: 6,
  blocked: [], // 沒有座位的格子（走道、櫃子）
  students: [], // [{ no: '01', name: '王冠霖' }]
  versions: [], // [{ id, name, from: 'YYYY-MM-DD' | '', assign: { 'r,c': '01' } }]
  view: 'student', // 'student' = 講台在下（學生視角）；'teacher' = 講台在上（老師視角）
};

export const cellKey = (r, c) => `${r},${c}`;

export function parseKey(key) {
  const [r, c] = key.split(',').map(Number);
  return { r, c };
}

/** 座號排序用：'3' 和 '03' 視為相同，數字小的在前 */
export function normalizeNo(no) {
  const s = String(no).trim();
  return /^\d+$/.test(s) ? s.padStart(2, '0') : s;
}

function byNo(a, b) {
  return a.localeCompare(b, 'zh-Hant', { numeric: true });
}

export function newId() {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 所有可以坐人的格子（排除沒有座位的格子） */
export function seatKeys(seating) {
  const blocked = new Set(seating.blocked);
  const keys = [];
  for (let r = 1; r <= seating.rows; r++) {
    for (let c = 1; c <= seating.cols; c++) {
      const k = cellKey(r, c);
      if (!blocked.has(k)) keys.push(k);
    }
  }
  return keys;
}

/** 今天正在使用的版本：生效日期 ≤ 今天之中最新的那一版；都沒有日期就用第一版 */
export function currentVersion(seating, today) {
  const dated = seating.versions
    .filter((v) => v.from && v.from <= today)
    .sort((a, b) => b.from.localeCompare(a.from) || (b.setAt || 0) - (a.setAt || 0)); // 同一天以最後設定的為準
  return dated[0] || seating.versions.find((v) => !v.from) || seating.versions[0] || null;
}

/** 還沒有座位的學生 */
export function unassigned(seating, version) {
  const seated = new Set(Object.values(version.assign));
  return seating.students.filter((s) => !seated.has(s.no));
}

/** 把座位分配整理乾淨：去掉超出版面、沒有座位的格子，以及已經不在名單上的學生 */
export function cleanAssign(seating, assign) {
  const valid = new Set(seatKeys(seating));
  const nos = new Set(seating.students.map((s) => s.no));
  const out = {};
  for (const [k, no] of Object.entries(assign)) if (valid.has(k) && nos.has(no)) out[k] = no;
  return out;
}

// ---------- 調整座位（都回傳新的 assign，不改原本的） ----------

/** 把學生放到某個座位；那裡有人就互換 */
export function placeStudent(assign, no, key) {
  const out = { ...assign };
  const from = Object.keys(out).find((k) => out[k] === no);
  const other = out[key];
  if (from) delete out[from];
  out[key] = no;
  if (other && other !== no && from) out[from] = other;
  return out;
}

/** 兩個座位互換（任一邊可以是空位） */
export function swapSeats(assign, a, b) {
  const out = { ...assign };
  const x = out[a];
  const y = out[b];
  delete out[a];
  delete out[b];
  if (x) out[b] = x;
  if (y) out[a] = y;
  return out;
}

export function removeStudent(assign, no) {
  const out = { ...assign };
  for (const k of Object.keys(out)) if (out[k] === no) delete out[k];
  return out;
}

/** 隨機排座位：名單上所有人隨機坐進可用的座位 */
export function shuffleAll(seating, random = Math.random) {
  const keys = seatKeys(seating);
  const nos = seating.students.map((s) => s.no);
  for (let i = nos.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [nos[i], nos[j]] = [nos[j], nos[i]];
  }
  // 座位比人多時，空位也隨機分散
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const out = {};
  nos.slice(0, keys.length).forEach((no, i) => (out[keys[i]] = no));
  return out;
}

/** 在一條直線上（同一欄或同一排）循環移動一格，跳過沒有座位的格子 */
function rotateLines(seating, assign, lines, step) {
  const out = { ...assign };
  for (const line of lines) {
    const values = line.map((k) => assign[k]);
    const n = line.length;
    line.forEach((k, i) => {
      const v = values[(((i - step) % n) + n) % n];
      if (v) out[k] = v;
      else delete out[k];
    });
  }
  return out;
}

/** 整排往前（dir = -1，第一排換到最後一排）或往後（dir = 1） */
export function shiftRows(seating, assign, dir) {
  const blocked = new Set(seating.blocked);
  const lines = [];
  for (let c = 1; c <= seating.cols; c++) {
    const line = [];
    for (let r = 1; r <= seating.rows; r++) if (!blocked.has(cellKey(r, c))) line.push(cellKey(r, c));
    if (line.length > 1) lines.push(line);
  }
  return rotateLines(seating, assign, lines, dir);
}

/** 整欄往右（dir = 1）或往左（dir = -1），以學生面向講台的方向為準 */
export function shiftCols(seating, assign, dir) {
  const blocked = new Set(seating.blocked);
  const lines = [];
  for (let r = 1; r <= seating.rows; r++) {
    const line = [];
    for (let c = 1; c <= seating.cols; c++) if (!blocked.has(cellKey(r, c))) line.push(cellKey(r, c));
    if (line.length > 1) lines.push(line);
  }
  return rotateLines(seating, assign, lines, dir);
}

/** 左右對調；對面剛好沒有座位的人會被放回「未安排」 */
export function mirror(seating, assign) {
  const blocked = new Set(seating.blocked);
  const out = {};
  for (const [k, no] of Object.entries(assign)) {
    const { r, c } = parseKey(k);
    const target = cellKey(r, seating.cols + 1 - c);
    if (!blocked.has(target)) out[target] = no;
  }
  return out;
}

// ---------- 名單與 CSV ----------

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * 讀 CSV：座號,姓名[,排,欄]。第一列是標題就跳過。
 * @returns {{ students: {no,name}[], positions: Record<string,string>, errors: string[] }}
 */
export function parseRosterCsv(text) {
  const students = [];
  const positions = {};
  const errors = [];
  const seen = new Set();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const [noRaw, nameRaw, rRaw, cRaw] = splitCsvLine(raw);
    if (i === 0 && /座號|號碼|no/i.test(noRaw)) return; // 標題列
    const no = normalizeNo(noRaw || '');
    const name = (nameRaw || '').replace(/\s+/g, '');
    if (!no || !name) {
      errors.push(`第 ${i + 1} 行少了座號或姓名`);
      return;
    }
    if (seen.has(no)) {
      errors.push(`第 ${i + 1} 行座號重複：${no}`);
      return;
    }
    seen.add(no);
    students.push({ no, name });
    if (rRaw && cRaw) {
      const r = Number(rRaw);
      const c = Number(cRaw);
      if (Number.isInteger(r) && Number.isInteger(c) && r > 0 && c > 0) positions[cellKey(r, c)] = no;
      else errors.push(`第 ${i + 1} 行的排、欄不是正整數`);
    }
  });
  students.sort((a, b) => byNo(a.no, b.no));
  return { students, positions, errors };
}

/** 匯出 CSV（含目前版本的排、欄） */
export function rosterCsv(seating, version) {
  const where = {};
  for (const [k, no] of Object.entries(version ? version.assign : {})) where[no] = parseKey(k);
  const rows = [['座號', '姓名', '排', '欄']];
  for (const s of seating.students) rows.push([s.no, s.name, where[s.no]?.r ?? '', where[s.no]?.c ?? '']);
  return rows.map((row) => row.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
}

/** 名單加人（座號重複就更新姓名） */
export function upsertStudent(students, no, name) {
  const n = normalizeNo(no);
  const list = students.filter((s) => s.no !== n).concat({ no: n, name: name.replace(/\s+/g, '') });
  return list.sort((a, b) => byNo(a.no, b.no));
}

/** 改變版面大小：超出範圍的格子不再是座位 */
export function resize(seating, rows, cols) {
  const inside = (k) => {
    const { r, c } = parseKey(k);
    return r <= rows && c <= cols;
  };
  const next = { ...seating, rows, cols, blocked: seating.blocked.filter(inside) };
  next.versions = seating.versions.map((v) => ({ ...v, assign: cleanAssign(next, v.assign) }));
  return next;
}

/** 某格設成「沒有座位」或恢復；設成沒有座位時，坐在那裡的人回到「未安排」 */
export function toggleBlocked(seating, key) {
  const blocked = seating.blocked.includes(key) ? seating.blocked.filter((k) => k !== key) : [...seating.blocked, key];
  const next = { ...seating, blocked };
  next.versions = seating.versions.map((v) => ({ ...v, assign: cleanAssign(next, v.assign) }));
  return next;
}
