
// 作息時間表：預設值與「某一天有哪些項目」的計算。不依賴瀏覽器，可以直接用 node 測試。

export const TYPES = {
  seat: '就位計時',
  nap: '就位計時（午休）',
  remind: '僅提醒',
  lunch: '午餐模式',
};

const TEXT_CLASS = '請回到座位，準備上課';
const TEXT_CLEAN = '打掃時間，請拿好工具到打掃區域';

export const DEFAULT_SCHEDULE = [
  { id: 'morning', name: '早自習', start: '07:45', end: '08:10', type: 'seat', text: '請回到座位，準備早自習' },
  { id: 'clean-am', name: '早上打掃', start: '08:10', end: '08:20', type: 'remind', text: TEXT_CLEAN },
  { id: 'p1', name: '第一節', start: '08:20', end: '09:05', type: 'seat', text: TEXT_CLASS },
  { id: 'p2', name: '第二節', start: '09:15', end: '10:00', type: 'seat', text: TEXT_CLASS },
  { id: 'p3', name: '第三節', start: '10:10', end: '10:55', type: 'seat', text: TEXT_CLASS },
  { id: 'p4', name: '第四節', start: '11:05', end: '11:50', type: 'seat', text: TEXT_CLASS },
  { id: 'lunch', name: '午餐', start: '12:00', end: '12:10', type: 'lunch', text: '請準備餐具，依序打菜', keepUntil: '12:20' },
  { id: 'clean-noon', name: '中午打掃', start: '12:20', end: '12:35', type: 'remind', text: TEXT_CLEAN },
  { id: 'nap', name: '午休', start: '12:35', end: '13:00', type: 'nap', text: '請回到座位，準備午休' },
  { id: 'p5', name: '第五節', start: '13:05', end: '13:50', type: 'seat', text: TEXT_CLASS },
  { id: 'p6', name: '第六節', start: '14:00', end: '14:45', type: 'seat', text: TEXT_CLASS },
  { id: 'p7', name: '第七節', start: '14:55', end: '15:40', type: 'seat', text: TEXT_CLASS },
  { id: 'p8', name: '第八節', start: '15:50', end: '16:35', type: 'seat', text: TEXT_CLASS },
].map((item) => ({ enabled: true, ...item }));

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** '08:20' 或 '12:19:40' → 當天第幾秒 */
export function parseTime(str) {
  const [h, m, s = 0] = str.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Date → 'YYYY-MM-DD'（本地時間） */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isSchoolDay(date, settings) {
  const key = dayKey(date);
  if ((settings.makeupDays || []).includes(key)) return true;
  if ((settings.holidays || []).includes(key)) return false;
  const wd = date.getDay();
  return wd >= 1 && wd <= 5;
}

/** 這一天所有啟用的項目，換算成實際時間（毫秒），依開始時間排序 */
export function eventsForDay(date, settings) {
  if (!isSchoolDay(date, settings)) return [];
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const key = dayKey(date);
  return (settings.schedule || [])
    .filter((item) => item.enabled)
    .map((item) => ({
      key: `${key}#${item.id}`,
      id: item.id,
      name: item.name,
      type: item.type,
      text: item.text || '',
      startMs: midnight + parseTime(item.start) * 1000,
      endMs: midnight + parseTime(item.end) * 1000,
      keepUntilMs: item.type === 'lunch' && item.keepUntil ? midnight + parseTime(item.keepUntil) * 1000 : null,
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

/** 檢查使用者在設定頁送來的時間表；回傳錯誤訊息，沒問題則回傳 null */
export function validateSchedule(schedule) {
  const ids = new Set();
  for (const item of schedule) {
    const label = item.name || '(未命名)';
    if (!item.name || !item.name.trim()) return '有項目沒有填名稱';
    if (!TIME_RE.test(item.start)) return `「${label}」的開始時間格式不對（例如 08:20）`;
    if (!TIME_RE.test(item.end)) return `「${label}」的結束時間格式不對（例如 09:05）`;
    if (parseTime(item.end) <= parseTime(item.start)) return `「${label}」的結束時間要晚於開始時間`;
    if (!TYPES[item.type]) return `「${label}」的類型不正確`;
    if (item.type === 'lunch' && item.keepUntil) {
      if (!TIME_RE.test(item.keepUntil)) return `「${label}」的小視窗顯示到…時間格式不對`;
      if (parseTime(item.keepUntil) <= parseTime(item.start)) return `「${label}」的小視窗顯示時間要晚於開始時間`;
    }
    if (ids.has(item.id)) return `項目代號重複：${item.id}`;
    ids.add(item.id);
  }
  return null;
}

/** 倒數畫面的標題：「第三節 即將上課」「午休 即將開始」 */
export function countdownTitle(name) {
  return /節$/.test(name) ? `${name} 即將上課` : `${name} 即將開始`;
}

