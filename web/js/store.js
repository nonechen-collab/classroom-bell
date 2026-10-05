// 設定與紀錄：存在這台電腦的瀏覽器裡（localStorage）。之後接上 Firebase 再同步到雲端。

import { DEFAULT_SCHEDULE, DATE_RE, validateSchedule } from './schedule.js';

export const DEFAULTS = {
  version: 1,
  schedule: DEFAULT_SCHEDULE,
  holidays: [], // 'YYYY-MM-DD'，平日放假
  makeupDays: [], // 'YYYY-MM-DD'，週末補上課
  offsetSec: 0, // 時間微調：電腦比學校鐘聲慢 3 秒就填 3
  countdownSec: 20,
  overlaySec: 30,
  maxMiniMinutes: 5,
  pipOnTap: true, // 開網頁後點一下畫面就開浮動視窗
  pauseUntil: 0,
};

const KEY = 'classroom-bell.settings';
const RECORD_KEY = 'classroom-bell.records';
const MAX_RECORDS = 5000;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 無痕視窗或儲存空間被封鎖：照常運作，只是不會記住
  }
}

export class Store {
  constructor() {
    this.data = { ...structuredClone(DEFAULTS), ...readJson(KEY, {}) };
  }

  get() {
    return this.data;
  }

  /** 部分更新並存檔（程式內部用，例如暫停狀態） */
  patch(partial) {
    this.data = { ...this.data, ...partial };
    writeJson(KEY, this.data);
  }

  /** 設定頁送來的完整設定：檢查後存檔。回傳錯誤訊息或 null */
  saveFromUser(input) {
    const schedule = (input.schedule || []).map((item) => ({
      id: String(item.id || '').trim() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: String(item.name || '').trim(),
      start: String(item.start || '').trim(),
      end: String(item.end || '').trim(),
      type: item.type,
      text: String(item.text || '').trim(),
      enabled: Boolean(item.enabled),
      ...(item.type === 'lunch' && item.keepUntil ? { keepUntil: String(item.keepUntil).trim() } : {}),
    }));
    const err = validateSchedule(schedule);
    if (err) return err;

    const dates = (list, label) => {
      const out = [...new Set((list || []).map((s) => String(s).trim()).filter(Boolean))].sort();
      const bad = out.find((d) => !DATE_RE.test(d) || Number.isNaN(new Date(d).getTime()));
      if (bad) throw new Error(`${label}的日期格式不對：${bad}（例如 2026-10-10）`);
      return out;
    };
    const num = (v, min, max, label) => {
      const n = Number(v);
      if (v === '' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label}要介於 ${min} 到 ${max}`);
      return n;
    };
    try {
      this.data = {
        ...this.data,
        schedule: schedule.sort((a, b) => a.start.localeCompare(b.start)),
        holidays: dates(input.holidays, '放假日'),
        makeupDays: dates(input.makeupDays, '補上課日'),
        offsetSec: num(input.offsetSec, -300, 300, '時間微調'),
        countdownSec: Math.round(num(input.countdownSec, 5, 120, '倒數秒數')),
        overlaySec: Math.round(num(input.overlaySec, 5, 300, '全螢幕顯示秒數')),
        maxMiniMinutes: num(input.maxMiniMinutes, 1, 45, '就位計時最長分鐘數'),
        pipOnTap: Boolean(input.pipOnTap),
      };
    } catch (e) {
      return e.message;
    }
    writeJson(KEY, this.data);
    return null;
  }

  addRecord(record) {
    const list = readJson(RECORD_KEY, []);
    list.push(record);
    writeJson(RECORD_KEY, list.slice(-MAX_RECORDS));
  }

  /** 紀錄，新的在前 */
  records() {
    return readJson(RECORD_KEY, []).slice().reverse();
  }
}
