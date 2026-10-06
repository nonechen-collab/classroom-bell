import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SEATING,
  seatKeys,
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
} from '../web/js/seating.js';

const students = [
  { no: '01', name: '甲' },
  { no: '02', name: '乙' },
  { no: '03', name: '丙' },
];
const base = { ...DEFAULT_SEATING, rows: 2, cols: 3, students };

test('可用座位排除沒有座位的格子', () => {
  assert.deepEqual(seatKeys({ ...base, blocked: ['1,2'] }), ['1,1', '1,3', '2,1', '2,2', '2,3']);
});

test('今天使用的版本：生效日期 ≤ 今天之中最新的', () => {
  const s = {
    ...base,
    versions: [
      { id: 'a', name: '開學', from: '2026-09-01', assign: {} },
      { id: 'b', name: '第二次', from: '2026-10-05', assign: {} },
      { id: 'c', name: '下週', from: '2026-10-12', assign: {} },
      { id: 'd', name: '草稿', from: '', assign: {} },
    ],
  };
  assert.equal(currentVersion(s, '2026-10-06').id, 'b');
  assert.equal(currentVersion(s, '2026-09-15').id, 'a');
  assert.equal(currentVersion(s, '2026-10-12').id, 'c');
  assert.equal(currentVersion({ ...s, versions: [s.versions[3]] }, '2026-10-06').id, 'd');
});

test('放到有人的座位會互換；從名單放進去則把原本的人擠回未安排', () => {
  let a = { '1,1': '01', '1,2': '02' };
  assert.deepEqual(placeStudent(a, '01', '1,2'), { '1,2': '01', '1,1': '02' });
  a = placeStudent(a, '03', '1,1');
  assert.deepEqual(a, { '1,1': '03', '1,2': '02' });
  assert.deepEqual(unassigned({ ...base }, { assign: a }).map((s) => s.no), ['01']);
});

test('座位互換、移除', () => {
  const a = { '1,1': '01' };
  assert.deepEqual(swapSeats(a, '1,1', '2,3'), { '2,3': '01' });
  assert.deepEqual(removeStudent({ '1,1': '01', '1,2': '02' }, '01'), { '1,2': '02' });
});

test('隨機排座位：每個人都有位子、不重複', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const a = shuffleAll(base, rand);
  assert.deepEqual(Object.values(a).sort(), ['01', '02', '03']);
  assert.equal(new Set(Object.keys(a)).size, 3);
});

test('整排往前：第一排換到最後一排；遇到沒有座位的格子會跳過', () => {
  const s = { ...base, rows: 3, cols: 1 };
  assert.deepEqual(shiftRows(s, { '1,1': '01', '2,1': '02', '3,1': '03' }, -1), { '1,1': '02', '2,1': '03', '3,1': '01' });
  assert.deepEqual(shiftRows(s, { '1,1': '01', '2,1': '02', '3,1': '03' }, 1), { '1,1': '03', '2,1': '01', '3,1': '02' });
  const holed = { ...s, blocked: ['2,1'] };
  assert.deepEqual(shiftRows(holed, { '1,1': '01', '3,1': '03' }, 1), { '1,1': '03', '3,1': '01' });
});

test('整欄往右', () => {
  const s = { ...base, rows: 1, cols: 3 };
  assert.deepEqual(shiftCols(s, { '1,1': '01', '1,2': '02' }, 1), { '1,2': '01', '1,3': '02' });
});

test('左右對調', () => {
  assert.deepEqual(mirror(base, { '1,1': '01', '2,2': '02' }), { '1,3': '01', '2,2': '02' });
  assert.deepEqual(mirror({ ...base, blocked: ['1,3'] }, { '1,1': '01' }), {});
});

test('CSV 匯入：標題列、補零、去空白、位置、錯誤', () => {
  const { students: list, positions, errors } = parseRosterCsv('﻿座號,姓名,排,欄\n3,李  億,1,6\n26,高 慧,4,1\n,沒座號\n3,重複\n');
  assert.deepEqual(list, [
    { no: '03', name: '李億' },
    { no: '26', name: '高慧' },
  ]);
  assert.deepEqual(positions, { '1,6': '03', '4,1': '26' });
  assert.equal(errors.length, 2);
});

test('CSV 匯出後再匯入，內容一樣', () => {
  const v = { assign: { '1,1': '01', '2,3': '03' } };
  const back = parseRosterCsv(rosterCsv(base, v));
  assert.deepEqual(back.students, students);
  assert.deepEqual(back.positions, v.assign);
});

test('新增學生：座號重複就更新姓名，依座號排序', () => {
  const list = upsertStudent(upsertStudent(students, '10', '丁'), '2', '乙乙');
  assert.deepEqual(list.map((s) => `${s.no}${s.name}`), ['01甲', '02乙乙', '03丙', '10丁']);
});

test('縮小版面、設成沒有座位：坐在那裡的人回到未安排', () => {
  const s = { ...base, versions: [{ id: 'a', name: 'x', from: '', assign: { '1,1': '01', '2,3': '03' } }] };
  assert.deepEqual(resize(s, 2, 2).versions[0].assign, { '1,1': '01' });
  const t = toggleBlocked(s, '1,1');
  assert.deepEqual(t.blocked, ['1,1']);
  assert.deepEqual(t.versions[0].assign, { '2,3': '03' });
  assert.deepEqual(toggleBlocked(t, '1,1').blocked, []);
});
