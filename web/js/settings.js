// 設定頁：作息時間表、放假與補課、一般設定、就位紀錄

import { TYPES, DEFAULT_SCHEDULE } from './schedule.js';
import { setupSeatEditor } from './seat-editor.js';

const RESULT_LABEL = {
  done: '全班就位',
  timeout: '逾時',
  closed: '手動關閉',
  interrupted: '被下一個項目中斷',
};

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * @param {{ store: import('./store.js').Store, engine: import('./engine.js').Engine, onClose: () => void }} deps
 */
export function setupSettings({ store, engine, onClose }) {
  const panel = $('#settings');
  const seatEditor = setupSeatEditor({ store });
  let data; // 編輯中的設定
  let savedIds = new Set(); // 已儲存的項目才能模擬
  let dirty = false;

  // ---------- 分頁 ----------

  for (const btn of panel.querySelectorAll('.tabs button')) {
    btn.addEventListener('click', () => {
      for (const b of panel.querySelectorAll('.tabs button')) b.classList.toggle('active', b === btn);
      for (const p of panel.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== btn.dataset.tab;
      $('#settingsFooter').hidden = ['seats', 'records', 'help'].includes(btn.dataset.tab); // 座位表改了就自動存
      if (btn.dataset.tab === 'records') renderRecords();
    });
  }

  // ---------- 時間表 ----------

  function renderRows() {
    $('#rows').replaceChildren(
      ...data.schedule.map((item, i) => {
        const set = (field, value) => {
          item[field] = value;
          markDirty();
        };
        const tr = el('tr', { className: item.enabled ? '' : 'disabled' });

        const enabled = el('input', { type: 'checkbox', checked: item.enabled });
        enabled.addEventListener('change', () => {
          set('enabled', enabled.checked);
          tr.className = enabled.checked ? '' : 'disabled';
        });

        const text = (field) => {
          const input = el('input', { type: 'text', value: item[field] || '' });
          input.addEventListener('input', () => set(field, input.value));
          return input;
        };
        const time = (field, placeholder) => {
          const input = el('input', { type: 'text', inputMode: 'numeric', placeholder, value: item[field] || '' });
          input.addEventListener('input', () => set(field, input.value));
          return input;
        };

        const type = el(
          'select',
          {},
          Object.entries(TYPES).map(([value, label]) => el('option', { value, textContent: label, selected: item.type === value })),
        );
        const keepUntil = time('keepUntil', '12:20');
        const lunchOnly = (isLunch) => {
          keepUntil.disabled = !isLunch;
          keepUntil.placeholder = isLunch ? '12:20' : '';
        };
        lunchOnly(item.type === 'lunch');
        type.addEventListener('change', () => {
          set('type', type.value);
          lunchOnly(type.value === 'lunch');
        });

        const simulate = el('button', { textContent: '模擬', title: '20 秒後鐘響（使用已儲存的設定）' });
        simulate.disabled = !savedIds.has(item.id);
        simulate.addEventListener('click', () => {
          engine.simulate(item.id);
          close();
        });

        const remove = el('button', { textContent: '刪除', className: 'danger' });
        remove.addEventListener('click', () => {
          if (!confirm(`確定刪除「${item.name || '未命名'}」？（按「儲存設定」後才會生效）`)) return;
          data.schedule.splice(i, 1);
          markDirty();
          renderRows();
        });

        tr.append(
          el('td', {}, [enabled]),
          el('td', {}, [text('name')]),
          el('td', {}, [time('start', '08:20')]),
          el('td', {}, [time('end', '09:05')]),
          el('td', {}, [type]),
          el('td', {}, [keepUntil]),
          el('td', {}, [text('text')]),
          el('td', { className: 'actions' }, [simulate, ' ', remove]),
        );
        return tr;
      }),
    );
  }

  $('#addRow').addEventListener('click', () => {
    data.schedule.push({ id: '', name: '', start: '', end: '', type: 'remind', text: '', enabled: true });
    markDirty();
    renderRows();
    $('#rows').lastElementChild.querySelector('input[type=text]').focus();
  });

  $('#resetSchedule').addEventListener('click', () => {
    if (!confirm('把作息時間表還原成預設值？（按「儲存設定」後才會生效）')) return;
    data.schedule = structuredClone(DEFAULT_SCHEDULE);
    markDirty();
    renderRows();
  });

  // ---------- 其他欄位 ----------

  const FIELDS = ['offsetSec', 'countdownSec', 'overlaySec', 'maxMiniMinutes'];

  function fillForm() {
    $('#holidays').value = data.holidays.join('\n');
    $('#makeupDays').value = data.makeupDays.join('\n');
    for (const id of FIELDS) $(`#${id}`).value = data[id];
    $('#pipOnTap').checked = data.pipOnTap;
  }

  for (const id of ['holidays', 'makeupDays', 'pipOnTap', ...FIELDS]) {
    $(`#${id}`).addEventListener('input', markDirty);
    $(`#${id}`).addEventListener('change', markDirty);
  }

  function collect() {
    const lines = (id) => $(`#${id}`).value.split(/\s+/).filter(Boolean);
    const out = { ...data, holidays: lines('holidays'), makeupDays: lines('makeupDays'), pipOnTap: $('#pipOnTap').checked };
    for (const id of FIELDS) out[id] = $(`#${id}`).value;
    return out;
  }

  // ---------- 儲存 ----------

  function setStatus(text, cls) {
    $('#status').textContent = text;
    $('#status').className = cls;
  }

  function markDirty() {
    dirty = true;
    setStatus('有尚未儲存的變更', '');
  }

  $('#save').addEventListener('click', () => {
    const err = store.saveFromUser(collect());
    if (err) {
      setStatus(err, 'error');
      return;
    }
    load();
    setStatus('已儲存 ✓', 'ok');
  });

  // ---------- 紀錄 ----------

  let records = [];

  function fmtTime(iso) {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function renderRecords() {
    records = store.records();
    $('#noRecords').hidden = records.length > 0;
    $('#recordRows').replaceChildren(
      ...records.map((r) =>
        el('tr', {}, [
          el('td', { textContent: r.date }),
          el('td', { textContent: r.name }),
          el('td', { textContent: RESULT_LABEL[r.result] || r.result }),
          el('td', { textContent: r.seconds.toFixed(1) }),
          el('td', { textContent: fmtTime(r.at) }),
        ]),
      ),
    );
  }

  $('#exportCsv').addEventListener('click', () => {
    const rows = [['日期', '項目', '結果', '秒數', '記錄時間']].concat(
      records.map((r) => [r.date, r.name, RESULT_LABEL[r.result] || r.result, r.seconds, r.at]),
    );
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv' })); // BOM：Excel 才不會亂碼
    el('a', { href: url, download: `就位紀錄-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ---------- 開關 ----------

  function load() {
    data = structuredClone(store.get());
    savedIds = new Set(data.schedule.map((x) => x.id));
    renderRows();
    fillForm();
    dirty = false;
    setStatus('', '');
  }

  function open() {
    load();
    seatEditor.refresh();
    panel.hidden = false;
  }

  function close() {
    if (dirty && !confirm('有尚未儲存的變更，確定要關閉嗎？')) return;
    dirty = false;
    panel.hidden = true;
    onClose();
  }

  $('#settingsClose').addEventListener('click', close);

  return { open, close };
}
