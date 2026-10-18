const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const state = {
  name: "",
  className: "",
  title: "",
  deviceCode: "",
  startedAt: 0,
  keyEvents: 0,
  pasteAttempts: 0,
  focusLeaves: 0,
  suspiciousInsertions: 0,
  lastLength: 0,
  isComposing: false,
  listeners: [],
  watermarkTimer: null
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function readTestFromUrl() {
  const params = new URLSearchParams(location.search);
  return {
    title: (params.get("title") || "").trim().slice(0, 80),
    className: (params.get("class") || "").trim().slice(0, 60)
  };
}

function getDeviceCode() {
  let deviceId = localStorage.getItem("tingxie_static_device");
  if (!deviceId) {
    deviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem("tingxie_static_device", deviceId);
  }
  let hash = 2166136261;
  for (const character of deviceId) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash).toString(16).slice(0, 6).toUpperCase().padStart(6, "0");
}

function addListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  state.listeners.push({ target, type, handler });
}

function cleanup() {
  clearInterval(state.watermarkTimer);
  state.watermarkTimer = null;
  state.listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
  state.listeners = [];
  document.body.classList.remove("screenshot-mode");
}

function preventPaste(element) {
  ["paste", "drop"].forEach((type) => addListener(element, type, (event) => {
    event.preventDefault();
    state.pasteAttempts += 1;
    showToast("此聽寫只能親手輸入，不能貼上文字。");
  }));
  addListener(element, "beforeinput", (event) => {
    if (["insertFromPaste", "insertFromDrop"].includes(event.inputType)) {
      event.preventDefault();
      state.pasteAttempts += 1;
      showToast("已阻止貼上文字。");
    }
  });
}

function renderHome() {
  cleanup();
  const test = readTestFromUrl();
  state.deviceCode = getDeviceCode();
  const fixedTest = Boolean(test.title);
  app.innerHTML = `
    <main class="shell"><div class="frame">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">聽</span> 聽寫室</div>
        <div class="device-pill">本機代碼 ${state.deviceCode}</div>
      </header>
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Live classroom dictation</p>
          <h1>聽寫室<span>專心聽，親手寫。</span></h1>
          <p class="lead">老師現場播放或朗讀，學生只能親手輸入。完成後產生包含姓名、裝置代碼與時間的交卷畫面，再截圖傳給老師。</p>
          <ul class="feature-list"><li>禁止貼上</li><li>姓名浮水印</li><li>裝置代碼</li><li>截圖交卷</li></ul>
        </div>
        <form id="start-form" class="card start-card">
          <p class="eyebrow">Student entry</p>
          <h2>開始聽寫</h2>
          ${fixedTest ? `<div class="test-summary"><strong>${escapeHtml(test.title)}</strong><span>${escapeHtml(test.className || "現場聽寫")}</span></div>` : `
            <div class="field"><label for="test-title">聽寫名稱</label><input id="test-title" name="title" maxlength="80" required placeholder="例如：第六課生詞聽寫" /></div>
            <div class="field"><label for="class-name">班級</label><input id="class-name" name="className" maxlength="60" placeholder="例如：三年二班" /></div>`}
          <div class="field"><label for="student-name">真實姓名</label><input id="student-name" name="name" maxlength="40" autocomplete="off" autocorrect="off" spellcheck="false" required placeholder="例如：陳小明" /></div>
          <div class="notice">開始後請勿切換畫面或貼上文字。你的姓名與裝置代碼會顯示在浮水印中。</div>
          <button class="button full" type="submit">確認姓名並開始</button>
        </form>
      </section>
    </div></main>
  `;

  preventPaste(document.querySelector("#student-name"));
  document.querySelector("#start-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.name = String(formData.get("name") || "").trim().slice(0, 40);
    state.title = fixedTest ? test.title : String(formData.get("title") || "").trim().slice(0, 80);
    state.className = fixedTest ? test.className : String(formData.get("className") || "").trim().slice(0, 60);
    if (state.name.length < 2) return showToast("請輸入完整姓名。");
    if (!state.title) return showToast("請輸入聽寫名稱。");
    renderWriting();
  });

}

function renderWatermarks() {
  const layer = document.querySelector("#watermark-layer");
  if (!layer) return;
  const time = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  const positions = [[4,12], [46,9], [73,27], [16,43], [55,52], [3,70], [67,76], [28,91]];
  layer.innerHTML = positions.map(([left, top], index) => `
    <span class="watermark" style="left:${left + Math.sin(Date.now() / 8500 + index) * 2.5}%;top:${top}%">${escapeHtml(state.name)} · ${state.deviceCode} · ${time}</span>
  `).join("");
}

function renderWriting() {
  cleanup();
  state.startedAt = Date.now();
  state.keyEvents = 0;
  state.pasteAttempts = 0;
  state.focusLeaves = 0;
  state.suspiciousInsertions = 0;
  state.lastLength = 0;
  state.isComposing = false;
  app.innerHTML = `
    <main class="write-shell">
      <div id="watermark-layer" class="watermark-layer" aria-hidden="true"></div>
      <div class="write-frame">
        <header class="write-head">
          <div><p class="eyebrow">${escapeHtml(state.className || "現場聽寫")}</p><h2>${escapeHtml(state.title)}</h2><p class="meta">聽老師播放或朗讀後，依序輸入內容。</p></div>
          <div class="student-chip"><strong>${escapeHtml(state.name)}</strong> · 裝置 ${state.deviceCode}</div>
        </header>
        <form id="writing-form" class="card writing-card">
          <textarea id="writing-area" class="writing-area" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="聽寫作答區" placeholder="在這裡開始輸入⋯" required></textarea>
          <div class="writing-footer"><p>禁止貼上 · 離開畫面會留下紀錄 · 完成後產生截圖畫面</p><button class="button" type="submit">完成聽寫</button></div>
        </form>
      </div>
      <div id="privacy-shield" class="privacy-shield hidden"><div><strong>作答畫面已隱藏</strong>回到這個分頁後才能繼續。</div></div>
    </main>`;

  renderWatermarks();
  state.watermarkTimer = setInterval(renderWatermarks, 1000);
  const area = document.querySelector("#writing-area");
  area.focus();
  preventPaste(area);
  protectWriting(area);
  document.querySelector("#writing-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const answer = area.value.trim();
    if (!answer) return showToast("請先輸入聽寫內容。");
    if (!confirm("完成後會鎖定作答內容。確定嗎？")) return;
    renderResult(answer);
  });
}

function protectWriting(area) {
  const shield = document.querySelector("#privacy-shield");
  const conceal = () => {
    shield.classList.remove("hidden");
    state.focusLeaves += 1;
  };
  addListener(document, "visibilitychange", () => document.hidden ? conceal() : shield.classList.add("hidden"));
  addListener(window, "blur", conceal);
  addListener(window, "focus", () => shield.classList.add("hidden"));
  addListener(document, "copy", (event) => event.preventDefault());
  addListener(document, "cut", (event) => event.preventDefault());
  addListener(document, "contextmenu", (event) => event.preventDefault());
  addListener(document, "keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ["c", "v", "x", "p", "s", "u"].includes(key)) {
      event.preventDefault();
      if (key === "v") state.pasteAttempts += 1;
      showToast("這個快捷鍵在聽寫中已停用。");
    }
    state.keyEvents += 1;
  });
  addListener(area, "compositionstart", () => { state.isComposing = true; });
  addListener(area, "compositionend", () => { state.isComposing = false; state.lastLength = area.value.length; });
  addListener(area, "input", () => {
    const growth = area.value.length - state.lastLength;
    if (!state.isComposing && growth > 12) state.suspiciousInsertions += 1;
    state.lastLength = area.value.length;
  });
}

function renderResult(answer) {
  cleanup();
  const completedAt = new Date();
  const durationMinutes = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
  const completedText = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(completedAt);
  const hasWarning = state.pasteAttempts || state.focusLeaves || state.suspiciousInsertions;
  app.innerHTML = `
    <main class="result-shell">
      <div id="watermark-layer" class="watermark-layer" aria-hidden="true"></div>
      <div class="result-frame">
        <div class="result-instruction"><p class="eyebrow">Screenshot submission</p><h2>交卷畫面</h2><p class="meta">請截圖完整畫面，傳給老師。內容較長時可分成多張截圖。</p></div>
        <article class="card result-card">
          <div class="result-band"><strong>聽寫完成</strong><span>${completedText}</span></div>
          <div class="result-content">
            <div class="result-title"><h1>${escapeHtml(state.title)}</h1><span class="meta">${escapeHtml(state.className || "現場聽寫")}</span></div>
            <div class="identity-grid">
              <div class="identity-item"><span>學生姓名</span><strong>${escapeHtml(state.name)}</strong></div>
              <div class="identity-item"><span>裝置代碼</span><strong>${state.deviceCode}</strong></div>
              <div class="identity-item"><span>作答時間</span><strong>${durationMinutes} 分鐘</strong></div>
            </div>
            <div class="answer-label">DICTATION ANSWER</div>
            <p class="final-answer">${escapeHtml(answer)}</p>
            <div class="integrity-line">
              <span>鍵盤事件 ${state.keyEvents}</span>
              <span>離開畫面 ${state.focusLeaves} 次</span>
              <span>貼上嘗試 ${state.pasteAttempts} 次</span>
              <span class="${hasWarning ? "warn" : "good"}">${hasWarning ? "偵測到需留意的操作" : "未偵測到明顯異常"}</span>
            </div>
          </div>
        </article>
        <div class="result-actions"><button id="screenshot-ready" class="button">準備截圖</button><button id="restart" class="button secondary">重新作答</button></div>
      </div>
    </main>`;
  renderWatermarks();
  state.watermarkTimer = setInterval(renderWatermarks, 1000);
  document.querySelector("#screenshot-ready").addEventListener("click", () => {
    document.body.classList.add("screenshot-mode");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.querySelector("#restart").addEventListener("click", () => {
    if (confirm("確定要清除這份內容並重新開始嗎？")) renderHome();
  });
}

renderHome();
