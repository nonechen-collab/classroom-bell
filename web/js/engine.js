
// 狀態機：決定現在要顯示什麼（待機／全螢幕／小視窗），不碰畫面。
// 網頁每 100 毫秒呼叫一次 tick()，再依回傳的狀態切換畫面。

import { eventsForDay, dayKey } from './schedule.js';

const MINUTE = 60 * 1000;
const DONE_SHOW_MS = 3000; // 全班就位後，結果至少顯示 3 秒
const CLOCK_JUMP_MS = 5000; // 時間跳動超過 5 秒視為開機、休眠醒來或手動改時間

export const isSeatType = (type) => type === 'seat' || type === 'nap';

export class Engine {
  /**
   * @param {object} opts
   * @param {() => number} opts.clock 目前時間（毫秒），測試時可以換成假時鐘
   * @param {() => object} opts.getSettings
   * @param {(record: object) => void} [opts.onRecord] 就位計時結束時呼叫
   * @param {() => void} [opts.onPauseChange] 暫停狀態改變時呼叫（用來存檔）
   */
  constructor({ clock, getSettings, onRecord, onPauseChange }) {
    this.clock = clock;
    this.getSettings = getSettings;
    this.onRecord = onRecord || (() => {});
    this.onPauseChange = onPauseChange || (() => {});
    this.handled = new Map(); // 事件 key → 'shown' | 'missed' | 'paused' | 'skipped'
    this.active = null; // { ev, phase, doneAt, sim }
    this.lastNow = null;
    this.today = null;
    this.pauseUntil = 0;
  }

  /** 校正後的時間（電腦時鐘 + 時間微調秒數） */
  now() {
    return this.clock() + (Number(this.getSettings().offsetSec) || 0) * 1000;
  }

  countdownMs() {
    return (Number(this.getSettings().countdownSec) || 20) * 1000;
  }

  overlayMs() {
    return (Number(this.getSettings().overlaySec) || 30) * 1000;
  }

  events(now) {
    return eventsForDay(new Date(now), this.getSettings());
  }

  tick() {
    const now = this.now();
    const today = dayKey(new Date(now));
    if (today !== this.today) {
      // 換日：清掉前一天的紀錄
      this.today = today;
      for (const key of this.handled.keys()) if (!key.startsWith(today)) this.handled.delete(key);
    }

    const events = this.events(now);
    if (this.lastNow === null || now - this.lastNow > CLOCK_JUMP_MS || now < this.lastNow - 1000) {
      // 剛開機或時間跳動：已經響過鐘的項目不再補跳；還在倒數區間內的照常跳出
      for (const ev of events) if (ev.startMs <= now && !this.handled.has(ev.key)) this.handled.set(ev.key, 'missed');
    }
    this.lastNow = now;

    const cd = this.countdownMs();
    const due = events.find((ev) => !this.handled.has(ev.key) && now >= ev.startMs - cd && now < ev.startMs);
    if (due) {
      if (this.isPaused(now)) {
        this.handled.set(due.key, 'paused');
      } else {
        this.handled.set(due.key, 'shown');
        if (this.active) this.finish('interrupted', now); // 例如午餐小視窗遇到中午打掃倒數
        this.active = { ev: due, phase: 'countdown', doneAt: null, sim: false };
      }
    }

    if (this.active) this.advance(now);
    return this.state(now);
  }

  advance(now) {
    const a = this.active;
    const { ev } = a;
    if (a.phase === 'countdown') {
      if (now < ev.startMs) return;
      a.phase = ev.type; // 鐘響
    }
    const since = now - ev.startMs;
    const hold = this.overlayMs();

    if (ev.type === 'remind') {
      if (since >= hold) this.finish(null, now);
    } else if (ev.type === 'lunch') {
      const end = Math.max(ev.keepUntilMs || 0, ev.startMs + hold);
      if (now >= end) this.finish(null, now);
    } else if (a.doneAt) {
      if (now >= Math.max(ev.startMs + hold, a.doneAt + DONE_SHOW_MS)) this.finish(null, now);
    } else if (since >= (Number(this.getSettings().maxMiniMinutes) || 5) * MINUTE) {
      this.finish('timeout', now);
    }
  }

  /** 結束目前的項目。result：'timeout' | 'closed' | 'interrupted' | null（正常結束） */
  finish(result, now) {
    const a = this.active;
    this.active = null;
    if (!a || a.sim || !isSeatType(a.ev.type) || a.doneAt || a.phase === 'countdown' || !result) return;
    this.onRecord({
      date: dayKey(new Date(a.ev.startMs)),
      id: a.ev.id,
      name: a.ev.name,
      result,
      seconds: Math.round((now - a.ev.startMs) / 100) / 10,
      at: new Date(now).toISOString(),
    });
  }

  /** 全班就位（第 1 階段由老師按住按鈕；第 3 階段由鏡頭判斷） */
  markDone() {
    const a = this.active;
    if (!a || !isSeatType(a.ev.type) || a.phase === 'countdown' || a.doneAt) return;
    const now = this.now();
    a.doneAt = now;
    if (!a.sim) {
      this.onRecord({
        date: dayKey(new Date(a.ev.startMs)),
        id: a.ev.id,
        name: a.ev.name,
        result: 'done',
        seconds: Math.round((now - a.ev.startMs) / 100) / 10,
        at: new Date(now).toISOString(),
      });
    }
  }

  /** 手動關閉目前畫面（這一次不再跳出） */
  closeCurrent() {
    if (this.active) this.finish('closed', this.now());
  }

  /** 用指定項目的設定模擬一次（20 秒後鐘響），不寫入紀錄、不受暫停影響 */
  simulate(itemId) {
    const now = this.now();
    const item = (this.getSettings().schedule || []).find((x) => x.id === itemId);
    if (!item) return;
    // 假日也能模擬：把今天當成上課日來算
    const asSchoolDay = { ...this.getSettings(), schedule: [{ ...item, enabled: true }], makeupDays: [dayKey(new Date(now))] };
    const real = eventsForDay(new Date(now), asSchoolDay)[0] || null;
    const startMs = now + this.countdownMs();
    const shift = real ? startMs - real.startMs : 0;
    const ev = {
      key: `sim#${now}`,
      id: item.id,
      name: item.name,
      type: item.type,
      text: item.text || '',
      startMs,
      endMs: real ? real.endMs + shift : startMs + 45 * MINUTE,
      keepUntilMs: real && real.keepUntilMs ? real.keepUntilMs + shift : null,
    };
    if (this.active) this.finish('interrupted', now);
    this.active = { ev, phase: 'countdown', doneAt: null, sim: true };
  }

  // ---- 暫停 ----

  isPaused(now = this.now()) {
    return this.pauseUntil > now;
  }

  /** 暫停本節或下一個項目：有畫面就關掉，沒有就跳過下一個 */
  skipNext() {
    if (this.active) return this.closeCurrent();
    const next = this.nextEvent();
    if (next) this.handled.set(next.key, 'skipped');
  }

  pauseFor(ms) {
    this.pauseUntil = this.now() + ms;
    this.closeCurrent();
    this.onPauseChange();
  }

  pauseToday() {
    const d = new Date(this.now());
    this.pauseUntil = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    this.closeCurrent();
    this.onPauseChange();
  }

  resume() {
    this.pauseUntil = 0;
    for (const [key, why] of this.handled) if (why === 'skipped') this.handled.delete(key);
    this.onPauseChange();
  }

  /** 今天下一個還沒處理的項目（給系統匣顯示用） */
  nextEvent() {
    const now = this.now();
    return this.events(now).find((ev) => !this.handled.has(ev.key) && ev.startMs > now) || null;
  }

  skippedEvent() {
    const now = this.now();
    return this.events(now).find((ev) => this.handled.get(ev.key) === 'skipped' && ev.startMs > now) || null;
  }

  // ---- 給畫面用的狀態 ----

  state(now = this.now()) {
    const a = this.active;
    if (!a) return { view: 'hidden' };
    const { ev } = a;
    const since = now - ev.startMs;
    const hold = this.overlayMs();
    const base = {
      phase: a.phase,
      sim: a.sim,
      event: { id: ev.id, name: ev.name, type: ev.type, text: ev.text },
      now,
    };
    if (a.phase === 'countdown') {
      return { ...base, view: 'overlay', remainingMs: ev.startMs - now };
    }
    if (ev.type === 'remind') {
      return { ...base, view: 'overlay', closeInMs: hold - since };
    }
    if (ev.type === 'lunch') {
      return {
        ...base,
        view: since < hold ? 'overlay' : 'mini',
        keepUntilMs: ev.keepUntilMs,
        remainingMs: ev.keepUntilMs ? ev.keepUntilMs - now : null,
      };
    }
    return {
      ...base,
      view: since < hold ? 'overlay' : 'mini',
      elapsedMs: (a.doneAt || now) - ev.startMs,
      done: Boolean(a.doneAt),
    };
  }
}

