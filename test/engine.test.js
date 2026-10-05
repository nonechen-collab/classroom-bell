import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../web/js/engine.js';
import { DEFAULTS } from '../web/js/store.js';
import { eventsForDay, validateSchedule, DEFAULT_SCHEDULE } from '../web/js/schedule.js';

const MON = (h, m, s = 0) => new Date(2026, 9, 5, h, m, s).getTime(); // 2026-10-05 是星期一

function setup(startAt, overrides = {}) {
  let t = startAt;
  const settings = { ...structuredClone(DEFAULTS), ...overrides };
  const records = [];
  const engine = new Engine({ clock: () => t, getSettings: () => settings, onRecord: (r) => records.push(r) });
  engine.tick();
  /** 每 100 毫秒走一次，直到指定時間 */
  const runTo = (target) => {
    let state;
    while (t < target) {
      t = Math.min(target, t + 100);
      state = engine.tick();
    }
    return state;
  };
  return { engine, records, settings, runTo, now: () => t };
}

test('預設時間表格式正確', () => {
  assert.equal(validateSchedule(DEFAULT_SCHEDULE), null);
  assert.equal(eventsForDay(new Date(MON(0, 0)), DEFAULTS).length, 13);
});

test('週末不啟動，補上課日會啟動，放假日不啟動', () => {
  const sat = new Date(2026, 9, 10);
  assert.equal(eventsForDay(sat, DEFAULTS).length, 0);
  assert.equal(eventsForDay(sat, { ...DEFAULTS, makeupDays: ['2026-10-10'] }).length, 13);
  assert.equal(eventsForDay(new Date(MON(0, 0)), { ...DEFAULTS, holidays: ['2026-10-05'] }).length, 0);
});

test('鐘響前 20 秒出現倒數，鐘響後開始就位計時', () => {
  const { runTo } = setup(MON(10, 9, 0));
  assert.equal(runTo(MON(10, 9, 39)).view, 'hidden');
  const cd = runTo(MON(10, 9, 41));
  assert.equal(cd.view, 'overlay');
  assert.equal(cd.phase, 'countdown');
  assert.equal(cd.event.name, '第三節');
  const seat = runTo(MON(10, 10, 12));
  assert.equal(seat.phase, 'seat');
  assert.equal(seat.view, 'overlay');
  assert.equal(seat.elapsedMs, 12000);
});

test('30 秒內全班就位：計時停止，30 秒時關閉並寫入紀錄', () => {
  const { engine, runTo, records } = setup(MON(10, 9, 30));
  runTo(MON(10, 10, 8));
  engine.markDone();
  const s = runTo(MON(10, 10, 20));
  assert.equal(s.done, true);
  assert.equal(s.elapsedMs, 8000);
  assert.equal(runTo(MON(10, 10, 31)).view, 'hidden');
  assert.deepEqual(
    records.map((r) => [r.name, r.result, r.seconds]),
    [['第三節', 'done', 8]],
  );
});

test('30 秒還沒就位：縮成小視窗繼續計時，就位後 3 秒消失', () => {
  const { engine, runTo, records } = setup(MON(10, 9, 30));
  assert.equal(runTo(MON(10, 10, 31)).view, 'mini');
  runTo(MON(10, 10, 45));
  engine.markDone();
  assert.equal(runTo(MON(10, 10, 47)).view, 'mini');
  assert.equal(runTo(MON(10, 10, 49)).view, 'hidden');
  assert.equal(records[0].seconds, 45);
});

test('小視窗超過 5 分鐘自動結束並記錄逾時', () => {
  const { runTo, records } = setup(MON(10, 9, 30));
  assert.equal(runTo(MON(10, 15, 1)).view, 'hidden');
  assert.equal(records[0].result, 'timeout');
});

test('打掃只提醒，30 秒後關閉，不寫紀錄', () => {
  const { runTo, records } = setup(MON(8, 9, 30));
  const s = runTo(MON(8, 10, 5));
  assert.equal(s.event.name, '早上打掃');
  assert.equal(s.view, 'overlay');
  assert.equal(runTo(MON(8, 10, 31)).view, 'hidden');
  assert.equal(records.length, 0);
});

test('午餐：30 秒後縮成小視窗，持續到中午打掃倒數出現', () => {
  const { runTo } = setup(MON(11, 59, 30));
  assert.equal(runTo(MON(12, 0, 10)).view, 'overlay');
  const m = runTo(MON(12, 5, 0));
  assert.equal(m.view, 'mini');
  assert.equal(m.remainingMs, 15 * 60 * 1000);
  const next = runTo(MON(12, 19, 41));
  assert.equal(next.event.name, '中午打掃');
  assert.equal(next.phase, 'countdown');
});

test('手動關閉：本次不再跳出，就位計時記為手動關閉', () => {
  const { engine, runTo, records } = setup(MON(10, 9, 30));
  runTo(MON(10, 10, 5));
  engine.closeCurrent();
  assert.equal(runTo(MON(10, 10, 40)).view, 'hidden');
  assert.equal(records[0].result, 'closed');
});

test('倒數中手動關閉不寫紀錄', () => {
  const { engine, runTo, records } = setup(MON(10, 9, 30));
  runTo(MON(10, 9, 50));
  engine.closeCurrent();
  assert.equal(runTo(MON(10, 10, 40)).view, 'hidden');
  assert.equal(records.length, 0);
});

test('程式在上課中途才開啟：不補跳已經響過的鐘', () => {
  const { runTo } = setup(MON(10, 10, 5));
  assert.equal(runTo(MON(10, 10, 30)).view, 'hidden');
});

test('開機時正好在倒數區間：照常倒數', () => {
  const { engine } = setup(MON(10, 9, 50));
  assert.equal(engine.state().phase, 'countdown');
});

test('跳過下一個項目、暫停 1 小時、暫停到今天結束、恢復', () => {
  const a = setup(MON(10, 0, 0));
  a.engine.skipNext();
  assert.equal(a.runTo(MON(10, 9, 50)).view, 'hidden'); // 第三節被跳過
  assert.equal(a.runTo(MON(11, 4, 50)).view, 'overlay'); // 第四節照常

  const b = setup(MON(10, 0, 0));
  b.engine.pauseFor(60 * 60 * 1000);
  assert.equal(b.runTo(MON(10, 9, 50)).view, 'hidden');
  assert.equal(b.runTo(MON(11, 4, 50)).view, 'overlay'); // 11:00 恢復

  const c = setup(MON(10, 0, 0));
  c.engine.pauseToday();
  assert.equal(c.runTo(MON(15, 49, 50)).view, 'hidden');
  c.engine.resume();
  assert.equal(c.engine.isPaused(), false);
});

test('時間微調：電腦慢 3 秒時，提早 3 秒倒數', () => {
  const { runTo } = setup(MON(10, 9, 30), { offsetSec: 3 });
  assert.equal(runTo(MON(10, 9, 36)).view, 'hidden');
  assert.equal(runTo(MON(10, 9, 38)).view, 'overlay');
});

test('模擬：20 秒後鐘響，不寫紀錄，假日也能模擬', () => {
  const { engine, runTo, records } = setup(new Date(2026, 9, 10, 9, 0, 0).getTime()); // 星期六
  engine.simulate('p3');
  assert.equal(engine.state().phase, 'countdown');
  runTo(new Date(2026, 9, 10, 9, 0, 25).getTime());
  engine.markDone();
  assert.equal(engine.state().done, true);
  assert.equal(records.length, 0);
});

test('模擬午餐：小視窗時間跟著平移', () => {
  const { engine } = setup(MON(9, 0, 0));
  engine.simulate('lunch');
  const s = engine.state();
  assert.equal(s.event.type, 'lunch');
  assert.equal(engine.active.ev.keepUntilMs - engine.active.ev.startMs, 20 * 60 * 1000);
});
