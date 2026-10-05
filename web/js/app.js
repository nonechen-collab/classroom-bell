// 主頁：大螢幕畫面＋浮動視窗（子母畫面）的接線

import { Engine } from './engine.js';
import { Store } from './store.js';
import { createEventView, createIdleView, hm } from './views.js';
import { setupSettings } from './settings.js';

const TICK_MS = 100;
const $ = (sel) => document.querySelector(sel);

const store = new Store();
const engine = new Engine({
  clock: Date.now,
  getSettings: () => store.get(),
  onRecord: (rec) => store.addRecord(rec),
  onPauseChange: () => store.patch({ pauseUntil: engine.pauseUntil }),
});
engine.pauseUntil = Number(store.get().pauseUntil) || 0;

const actions = {
  close: () => {
    engine.closeCurrent();
    tick();
  },
  done: () => {
    engine.markDone();
    tick();
  },
};

const main = {
  idle: createIdleView($('#idle')),
  event: createEventView($('#event'), actions),
  card: createEventView($('#card'), actions),
};
let pip = null; // { win, idleEl, eventEl, idle, event }

// ---------- 畫面更新 ----------

function idleInfo() {
  const now = engine.now();
  let pausedText = '';
  if (engine.isPaused(now)) {
    const end = new Date(engine.pauseUntil);
    pausedText = end.getHours() === 0 && end.getMinutes() === 0 ? '⏸ 暫停中（到今天結束）' : `⏸ 暫停中（到 ${hm(engine.pauseUntil)}）`;
  } else {
    const skipped = engine.skippedEvent();
    if (skipped) pausedText = `⏭ 已跳過：${skipped.name} ${hm(skipped.startMs)}`;
  }
  return { now, next: engine.nextEvent(), pausedText };
}

function render(state) {
  const { view } = state;
  const info = view === 'overlay' ? null : idleInfo();

  // 大螢幕頁面：鐘響後 30 秒內全螢幕，之後回到時鐘＋角落小卡片
  $('#event').hidden = view !== 'overlay';
  $('#idle').hidden = view === 'overlay';
  $('#cardBox').hidden = view !== 'mini';
  $('#toolbar').hidden = view === 'overlay';
  $('#pipHint').hidden = view === 'overlay' || Boolean(pip) || !pipSupported || !store.get().pipOnTap;
  if (view === 'overlay') main.event.update(state);
  else main.idle.update(info);
  if (view === 'mini') main.card.update(state);

  // 浮動視窗：平常是小時鐘，有項目時顯示倒數／計時
  if (pip) {
    pip.eventEl.hidden = view === 'hidden';
    pip.idleEl.hidden = view !== 'hidden';
    if (view === 'hidden') pip.idle.update(info);
    else pip.event.update(state);
  }
}

function tick() {
  render(engine.tick());
}

// 計時器放在 Worker 裡：網頁被切到背景（例如老師在看電子書）時，
// 一般的 setInterval 會被瀏覽器降到每分鐘一次，Worker 不會。
function startTicker() {
  try {
    const src = `setInterval(() => postMessage(0), ${TICK_MS});`;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = tick;
  } catch {
    setInterval(tick, TICK_MS);
  }
}

// ---------- 浮動視窗（Document Picture-in-Picture） ----------

const pipSupported = 'documentPictureInPicture' in window;

function copyStyles(target) {
  for (const sheet of document.styleSheets) {
    try {
      const style = target.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      target.document.head.append(style);
    } catch {
      const link = target.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      target.document.head.append(link);
    }
  }
}

async function openPip({ quiet = false } = {}) {
  if (!pipSupported) {
    if (!quiet) alert('這個瀏覽器不支援浮動視窗，請使用最新版的 Chrome 或 Edge。');
    return;
  }
  if (pip) return;
  let win;
  try {
    win = await window.documentPictureInPicture.requestWindow({ width: 460, height: 260 });
  } catch (e) {
    if (!quiet) alert(`浮動視窗開不起來：${e.message}`);
    return;
  }
  copyStyles(win);
  win.document.title = '教室作息系統';
  win.document.body.className = 'pip';
  win.document.body.innerHTML = '<div class="view compact" id="pIdle"></div><div class="view compact" id="pEvent" hidden></div>';
  const idleEl = win.document.getElementById('pIdle');
  const eventEl = win.document.getElementById('pEvent');
  pip = { win, idleEl, eventEl, idle: createIdleView(idleEl), event: createEventView(eventEl, actions) };
  win.document.addEventListener('keydown', onKey);
  win.addEventListener('pagehide', () => {
    pip = null;
    updatePipButton();
  });
  updatePipButton();
  tick();
}

function updatePipButton() {
  $('#pipBtn').classList.toggle('on', Boolean(pip));
  $('#pipBtn').textContent = pip ? '🗗 浮動視窗開啟中' : '🗗 浮動視窗';
}

$('#pipBtn').addEventListener('click', () => (pip ? pip.win.close() : openPip()));

// 瀏覽器規定浮動視窗要由使用者點一下才能開：開機後第一次點畫面時自動開
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!pip && pipSupported && store.get().pipOnTap && !e.target.closest('button, .settings, dialog')) openPip({ quiet: true });
  },
  true,
);

// ---------- 暫停選單 ----------

const pauseMenu = $('#pauseMenu');
$('#pauseBtn').addEventListener('click', () => {
  const paused = engine.isPaused() || Boolean(engine.skippedEvent());
  pauseMenu.querySelector('[data-pause=resume]').disabled = !paused;
  const next = engine.nextEvent();
  pauseMenu.querySelector('[data-pause=skip]').textContent = next ? `跳過下一個項目（${next.name} ${hm(next.startMs)}）` : '跳過下一個項目';
  pauseMenu.querySelector('[data-pause=skip]').disabled = !next;
  pauseMenu.showModal();
});
pauseMenu.addEventListener('click', (e) => {
  const kind = e.target.dataset && e.target.dataset.pause;
  if (!kind) return;
  if (kind === 'skip') engine.skipNext();
  else if (kind === 'hour') engine.pauseFor(60 * 60 * 1000);
  else if (kind === 'today') engine.pauseToday();
  else if (kind === 'resume') engine.resume();
  pauseMenu.close();
  tick();
});

// ---------- 其他 ----------

function onKey(e) {
  if (e.key === 'Escape' && engine.state().view !== 'hidden') actions.close();
}
document.addEventListener('keydown', onKey);

$('#fullBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

// 大螢幕顯示這個網頁時，不要讓螢幕自己關掉
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    // 省電模式等情況會被拒絕，不影響其他功能
  }
}
document.addEventListener('visibilitychange', keepAwake);
keepAwake();

const settings = setupSettings({
  store,
  engine,
  onClose: () => {
    updatePipButton();
    tick();
  },
});
$('#settingsBtn').addEventListener('click', settings.open);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

updatePipButton();
startTicker();
tick();
