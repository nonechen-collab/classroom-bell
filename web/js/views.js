// 畫面元件：同一套元件用在大螢幕全螢幕、角落小卡片、浮動視窗（子母畫面）。
// 字級都用容器單位（cqh），所以放在多大的框裡就自動縮放。

const HOLD_MS = 100; // 「全班就位」按住 0.1 秒就算數，幾乎等於點一下
const WEEKDAYS = '日一二三四五六';

export const pad = (n) => String(n).padStart(2, '0');

export function hm(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 計時顯示：未滿 1 分鐘「12.3」，超過「1:05.2」 */
export function fmtElapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 100)) / 10;
  if (t < 60) return t.toFixed(1);
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** 剩餘時間：「14:32」 */
export function fmtRemain(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

function countdownTitle(name) {
  return /節$/.test(name) ? `${name} 即將上課` : `${name} 即將開始`;
}

/** 讓按鈕變成「按住 HOLD_MS 才觸發」，按的時候會有進度條 */
export function holdButton(el, onDone) {
  const win = el.ownerDocument.defaultView;
  const fill = el.querySelector('.fill');
  let timer = 0;
  const reset = () => {
    win.clearInterval(timer);
    timer = 0;
    fill.style.width = '0%';
  };
  el.addEventListener('pointerdown', (e) => {
    try {
      el.setPointerCapture(e.pointerId); // 手指滑出按鈕也繼續算
    } catch {
      // 少數環境不支援，照樣能按住
    }
    win.clearInterval(timer);
    const start = Date.now();
    // 用計時器而不是 requestAnimationFrame：畫面沒在重繪時（例如被遮住）也照樣能完成
    timer = win.setInterval(() => {
      const p = (Date.now() - start) / HOLD_MS;
      fill.style.width = `${Math.min(100, p * 100)}%`;
      if (p >= 1) {
        reset();
        onDone();
      }
    }, 30);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, reset);
  el.addEventListener('contextmenu', (e) => e.preventDefault()); // 觸控長按不要跳出選單
}

function holdHtml(cls, key, label) {
  return `<button class="hold ${cls}" data-k="${key}"><span class="fill"></span><span class="label">${label}</span></button>`;
}

/** 把 HTML 放進容器，回傳用 data-k 找元素的函式 */
function mount(root, html) {
  root.innerHTML = html;
  const cache = {};
  return (k) => (cache[k] ||= root.querySelector(`[data-k="${k}"]`));
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * 倒數／提醒／就位計時／午餐畫面
 * @param {HTMLElement} root
 * @param {{ close: () => void, done: () => void }} actions
 */
export function createEventView(root, actions) {
  const $ = mount(
    root,
    `
    <div class="sim" data-k="sim" hidden>模擬測試（不列入紀錄）</div>
    <button class="hold close" data-k="close"><span class="label">✕ 關閉</span></button>
    <section class="stack" data-k="countdown" hidden>
      <h1 class="title" data-k="cdTitle"></h1>
      <p class="big num" data-k="cdNum"></p>
      <p class="text" data-k="cdText"></p>
    </section>
    <section class="stack" data-k="remind" hidden>
      <div class="emoji" data-k="rmEmoji"></div>
      <h1 class="title" data-k="rmTitle"></h1>
      <p class="text" data-k="rmText"></p>
      <p class="small" data-k="rmClose"></p>
    </section>
    <section class="stack" data-k="seat" hidden>
      <h1 class="title" data-k="stTitle"></h1>
      <p class="timer num" data-k="stTimer"><span data-k="stValue"></span><span class="unit">秒</span></p>
      <p class="text" data-k="stText"></p>
      <p class="result" data-k="stResult" hidden></p>
      ${holdHtml('done-btn', 'doneBtn', '✓ 全班就位')}
    </section>
    <section class="stack" data-k="lunch" hidden>
      <div class="emoji">🍱</div>
      <h1 class="title" data-k="luTitle"></h1>
      <p class="timer num" data-k="luRemain" hidden></p>
      <p class="text" data-k="luText"></p>
      <p class="small" data-k="luNote"></p>
    </section>`,
  );
  $('close').addEventListener('click', actions.close); // 關閉按一下就好；「全班就位」才需要按住
  holdButton($('doneBtn'), actions.done);

  const show = (name) => {
    for (const k of ['countdown', 'remind', 'seat', 'lunch']) $(k).hidden = k !== name;
  };

  return {
    update(s) {
      const ev = s.event;
      $('sim').hidden = !s.sim;

      if (s.phase === 'countdown') {
        show('countdown');
        const sec = Math.max(0, Math.ceil(s.remainingMs / 1000));
        setText($('cdTitle'), countdownTitle(ev.name));
        setText($('cdNum'), String(sec));
        $('cdNum').classList.toggle('urgent', sec <= 5);
        setText($('cdText'), ev.text);
      } else if (ev.type === 'remind') {
        show('remind');
        setText($('rmEmoji'), /打掃/.test(ev.name) ? '🧹' : '🔔');
        setText($('rmTitle'), ev.name);
        setText($('rmText'), ev.text);
        setText($('rmClose'), `${Math.max(0, Math.ceil(s.closeInMs / 1000))} 秒後關閉`);
      } else if (ev.type === 'lunch') {
        show('lunch');
        setText($('luTitle'), `${ev.name}時間`);
        setText($('luText'), ev.text);
        const mini = s.view === 'mini';
        $('luRemain').hidden = !mini || s.remainingMs == null;
        if (s.remainingMs != null) setText($('luRemain'), `剩餘 ${fmtRemain(s.remainingMs)}`);
        setText($('luNote'), !mini && s.keepUntilMs ? `用餐期間會持續顯示剩餘時間，到 ${hm(s.keepUntilMs)}` : '');
      } else {
        show('seat');
        setText($('stTitle'), `${ev.name}　就位計時`);
        setText($('stValue'), fmtElapsed(s.elapsedMs));
        $('stTimer').classList.toggle('done', s.done);
        $('stText').hidden = s.done;
        setText($('stText'), ev.type === 'nap' ? '請回到座位，安靜午休' : ev.text);
        $('stResult').hidden = !s.done;
        setText($('stResult'), `全班就位！用時 ${fmtElapsed(s.elapsedMs)} 秒`);
        $('doneBtn').hidden = s.done;
      }
    },
  };
}

/** 待機畫面：時鐘、日期、下一個項目、暫停狀態 */
export function createIdleView(root) {
  const $ = mount(
    root,
    `
    <section class="stack">
      <p class="clock num" data-k="clock"></p>
      <p class="date" data-k="date"></p>
      <p class="next" data-k="next"></p>
      <p class="paused" data-k="paused" hidden></p>
    </section>`,
  );
  return {
    /** @param {{ now: number, next: object|null, pausedText: string }} info */
    update(info) {
      const d = new Date(info.now);
      setText($('clock'), `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
      setText($('date'), `${d.getMonth() + 1} 月 ${d.getDate()} 日　星期${WEEKDAYS[d.getDay()]}`);
      if (info.next) {
        const mins = Math.ceil((info.next.startMs - info.now) / 60000);
        setText($('next'), `下一個：${info.next.name} ${hm(info.next.startMs)}（${mins} 分鐘後）`);
      } else {
        setText($('next'), '今天沒有其他項目');
      }
      $('paused').hidden = !info.pausedText;
      setText($('paused'), info.pausedText);
    },
  };
}
