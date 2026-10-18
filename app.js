import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { firebaseConfig, teacherEmails } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
setPersistence(auth, browserLocalPersistence).catch(() => {});

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const state = {
  user: null,
  isAdmin: false,
  activeTest: null,
  studentName: "",
  unsubscribers: [],
  listeners: [],
  timers: [],
  startedAt: 0,
  keyEvents: 0,
  pasteAttempts: 0,
  focusLeaves: 0,
  suspiciousInsertions: 0,
  lastLength: 0,
  isComposing: false
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
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function formatTime(value) {
  if (!value) return "處理中";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function minimumClosingTime() {
  const date = new Date(Date.now() + 60000);
  return formatDateTimeInput(date);
}

function formatDateTimeInput(value) {
  if (!value) return "";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function closingTimeMillis(test) {
  if (!test.closesAt) return null;
  return typeof test.closesAt.toMillis === "function"
    ? test.closesAt.toMillis()
    : new Date(test.closesAt).getTime();
}

function isTestOpen(test) {
  const closesAt = closingTimeMillis(test);
  return test.status === "open" && (!closesAt || closesAt > Date.now());
}

function getDeviceCode() {
  let deviceId = localStorage.getItem("tingxie_firebase_device");
  if (!deviceId) {
    deviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem("tingxie_firebase_device", deviceId);
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

function cleanupView() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
  state.listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
  state.listeners = [];
  state.timers.forEach((timer) => clearTimeout(timer));
  state.timers = [];
  document.body.classList.remove("exam-mode");
}

function renderLoading(message = "正在連接聽寫室⋯") {
  app.innerHTML = `<main class="loading-screen"><div class="loading-mark">聽</div><p>${escapeHtml(message)}</p></main>`;
}

function roleShell(content, activeView) {
  const teacherNavigation = `
    <button class="nav-tab ${activeView === "tests" ? "active" : ""}" data-nav="tests">測驗管理</button>
    <button class="nav-tab ${activeView === "grading" ? "active" : ""}" data-nav="grading">批改中心</button>`;
  const studentNavigation = `
    <button class="nav-tab ${activeView === "take" ? "active" : ""}" data-nav="take">開始測驗</button>
    <button class="nav-tab ${activeView === "results" ? "active" : ""}" data-nav="results">我的成績</button>`;
  return `
    <main class="app-shell">
      <header class="app-header">
        <div class="brand"><span class="brand-mark">聽</span> 聽寫室</div>
        <div class="account-block">
          ${state.user.photoURL ? `<img class="avatar" src="${escapeHtml(state.user.photoURL)}" alt="" referrerpolicy="no-referrer" />` : ""}
          <div><strong>${escapeHtml(state.user.displayName || state.user.email)}</strong><span>${state.isAdmin ? "老師帳號" : "學生帳號"}</span></div>
          <button id="sign-out" class="button secondary small">登出</button>
        </div>
      </header>
      <div class="app-body">
        <nav class="app-nav">${state.isAdmin ? teacherNavigation : studentNavigation}</nav>
        <section class="app-content">${content}</section>
      </div>
    </main>`;
}

function bindShellNavigation() {
  document.querySelector("#sign-out").addEventListener("click", () => signOut(auth));
  document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.nav;
    if (view === "tests") renderTeacherTests();
    if (view === "grading") renderTeacherAllSubmissions();
    if (view === "take") renderStudentHome();
    if (view === "results") renderStudentResults();
  }));
}

function renderLogin() {
  cleanupView();
  app.innerHTML = `
    <main class="shell"><div class="frame">
      <header class="topbar"><div class="brand"><span class="brand-mark">聽</span> 聽寫室</div><div class="device-pill">Firebase 安全登入</div></header>
      <section class="hero login-hero">
        <div class="hero-copy">
          <p class="eyebrow">Classroom dictation</p>
          <h1>聽寫室<span>登入、作答、批改。</span></h1>
          <p class="lead">學生使用 Google 帳號登入後作答。老師在管理介面建立測驗、查看答案、輸入成績與訂正，學生可在自己的帳號中查看結果。</p>
          <ul class="feature-list"><li>Google 登入</li><li>雲端交卷</li><li>老師批改</li><li>個人成績</li></ul>
        </div>
        <section class="card login-card">
          <p class="eyebrow">Secure sign in</p>
          <h2>登入聽寫室</h2>
          <p>請使用你的 Google 帳號。學生只能查看自己的答案和成績。</p>
          <button id="google-login" class="button google-button full"><span class="google-mark">G</span>使用 Google 登入</button>
          <div class="notice">第一次登入時，Google 會要求你確認帳號。網站不會取得你的 Google 密碼。</div>
        </section>
      </section>
    </div></main>`;
  document.querySelector("#google-login").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      if ([
        "auth/network-request-failed",
        "auth/popup-blocked",
        "auth/operation-not-supported-in-this-environment"
      ].includes(error.code)) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          showToast(`登入失敗：${redirectError.message}`);
          button.disabled = false;
          return;
        }
      }
      const messages = {
        "auth/unauthorized-domain": "請先把 fangdongyzu.github.io 加入 Firebase Authentication 的 Authorized domains。",
        "auth/popup-closed-by-user": "登入視窗已關閉，請重新登入。"
      };
      showToast(messages[error.code] || `登入失敗：${error.message}`);
      button.disabled = false;
    }
  });
}

async function syncUserProfile(user) {
  const profileRef = doc(db, "users", user.uid);
  const profile = await getDoc(profileRef);
  const data = {
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    lastLoginAt: serverTimestamp()
  };
  if (profile.exists()) await updateDoc(profileRef, data);
  else await setDoc(profileRef, { ...data, createdAt: serverTimestamp() });
}

async function loadAccount(user) {
  state.user = user;
  const adminRef = doc(db, "admins", user.email);
  const adminSnapshot = await getDoc(adminRef);
  state.isAdmin = adminSnapshot.exists();
  if (!state.isAdmin && teacherEmails.includes(user.email)) {
    await setDoc(adminRef, {
      name: user.displayName || user.email,
      email: user.email,
      createdAt: serverTimestamp()
    });
    state.isAdmin = true;
  }
  await syncUserProfile(user);
  if (state.isAdmin) renderTeacherTests();
  else renderStudentHome();
}

function renderFirebaseError(error) {
  cleanupView();
  const email = state.user?.email || "尚未取得";
  app.innerHTML = `
    <main class="shell"><div class="frame"><section class="card setup-card">
      <p class="eyebrow">Firebase setup needed</p>
      <h2>Firebase 尚未完成設定</h2>
      <p class="lead">請確認已啟用 Google 登入、建立 Firestore Database，並部署專案內的 <code>firestore.rules</code>。</p>
      <div class="notice error-notice"><strong>${escapeHtml(error.code || "firebase/error")}</strong><br />${escapeHtml(error.message)}</div>
      <div class="uid-box"><span>目前 Google 帳號</span><code>${escapeHtml(email)}</code></div>
      <button id="retry-account" class="button">重新檢查</button>
      <button id="setup-sign-out" class="button secondary">登出</button>
    </section></div></main>`;
  document.querySelector("#retry-account").addEventListener("click", () => loadAccount(state.user).catch(renderFirebaseError));
  document.querySelector("#setup-sign-out").addEventListener("click", () => signOut(auth));
}

function randomTestCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

async function createUniqueTestCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomTestCode();
    if (!(await getDoc(doc(db, "tests", code))).exists()) return code;
  }
  throw new Error("無法產生測驗代碼，請再試一次。");
}

async function deleteTestAndSubmissions(testId) {
  const submissionsSnapshot = await getDocs(query(collection(db, "submissions"), where("testId", "==", testId)));
  const references = submissionsSnapshot.docs.map((submission) => submission.ref);
  references.push(doc(db, "tests", testId));
  for (let start = 0; start < references.length; start += 450) {
    const batch = writeBatch(db);
    references.slice(start, start + 450).forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}

function renderTeacherTests() {
  cleanupView();
  app.innerHTML = roleShell(`
    <div class="page-heading-row"><div><p class="eyebrow">Teacher dashboard</p><h2>測驗管理</h2><p>建立現場聽寫，將六位代碼提供給學生。</p></div></div>
    <div class="dashboard-grid">
      <form id="create-test" class="card panel-card">
        <h3>建立新測驗</h3>
        <div class="field"><label for="test-title">聽寫名稱</label><input id="test-title" name="title" maxlength="80" required placeholder="例如：第六課生詞聽寫" /></div>
        <div class="field"><label for="class-name">班級（選填）</label><input id="class-name" name="className" maxlength="60" placeholder="例如：三年二班" /></div>
        <div class="field"><label for="closes-at">自動關閉時間（選填）</label><input id="closes-at" name="closesAt" type="datetime-local" min="${minimumClosingTime()}" /><small>時間到後，學生將無法再加入這份測驗。</small></div>
        <div class="field"><label for="instructions">作答說明（選填）</label><textarea id="instructions" name="instructions" maxlength="300" placeholder="例如：老師每題播放兩次。"></textarea></div>
        <button class="button full" type="submit">建立測驗代碼</button>
      </form>
      <section class="card panel-card"><div class="panel-heading"><h3>我的測驗</h3><span id="test-count" class="meta"></span></div><div id="test-list" class="record-list"><div class="empty-state">正在載入測驗⋯</div></div></section>
    </div>`, "tests");
  bindShellNavigation();
  const titleInput = document.querySelector("#test-title");
  titleInput.addEventListener("input", () => titleInput.setCustomValidity(""));
  document.querySelector("#create-test").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim().slice(0, 80);
    const closesAtValue = String(data.get("closesAt") || "");
    const closesAtDate = closesAtValue ? new Date(closesAtValue) : null;
    if (!title) {
      titleInput.setCustomValidity("請輸入聽寫名稱。");
      titleInput.reportValidity();
      return;
    }
    if (closesAtDate && (!Number.isFinite(closesAtDate.getTime()) || closesAtDate.getTime() <= Date.now())) {
      showToast("自動關閉時間必須晚於現在。");
      return;
    }
    button.disabled = true;
    try {
      const code = await createUniqueTestCode();
      await setDoc(doc(db, "tests", code), {
        code,
        title,
        className: String(data.get("className") || "").trim().slice(0, 60),
        instructions: String(data.get("instructions") || "").trim().slice(0, 300),
        closesAt: closesAtDate ? Timestamp.fromDate(closesAtDate) : null,
        status: "open",
        createdBy: state.user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      form.reset();
      showToast(`測驗已建立，代碼：${code}`);
    } catch (error) {
      showToast(`建立失敗：${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
  const unsubscribe = onSnapshot(collection(db, "tests"), (snapshot) => {
    const tests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.createdAt?.seconds || 0) - (left.createdAt?.seconds || 0));
    state.timers.forEach((timer) => clearTimeout(timer));
    state.timers = [];
    const nextClosingTime = tests
      .filter((test) => test.status === "open" && closingTimeMillis(test) > Date.now())
      .reduce((earliest, test) => Math.min(earliest, closingTimeMillis(test)), Number.POSITIVE_INFINITY);
    if (Number.isFinite(nextClosingTime)) {
      state.timers.push(setTimeout(renderTeacherTests, Math.min(nextClosingTime - Date.now() + 250, 2147483647)));
    }
    document.querySelector("#test-count").textContent = `${tests.length} 份`;
    const list = document.querySelector("#test-list");
    list.innerHTML = tests.length ? tests.map((test) => {
      const open = isTestOpen(test);
      return `
      <article class="record-card">
        <div class="record-top"><div><h3>${escapeHtml(test.title)}</h3><span class="meta">${escapeHtml(test.className || "未指定班級")} · ${formatTime(test.createdAt)}</span>${test.closesAt ? `<span class="scheduled-close">自動關閉：${formatTime(test.closesAt)}</span>` : ""}</div><span class="status ${open ? "open" : "closed"}">${open ? "開放中" : "已關閉"}</span></div>
        <div class="test-code">${test.code}</div>
        ${open ? `<div class="test-schedule"><label for="close-${test.id}">設定關閉時間</label><input id="close-${test.id}" data-close-time type="datetime-local" min="${minimumClosingTime()}" value="${formatDateTimeInput(test.closesAt)}" /><button class="button secondary small" data-save-close="${test.id}">儲存時間</button>${test.closesAt ? `<button class="text-button" data-clear-close="${test.id}">清除時間</button>` : ""}</div>` : ""}
        <div class="row-actions"><button class="button small" data-view-test="${test.id}">查看交卷</button><button class="button secondary small" data-copy-code="${test.code}">複製代碼</button><button class="button secondary small" data-toggle-test="${test.id}" data-status="${open ? "open" : "closed"}">${open ? "關閉測驗" : "重新開放"}</button><button class="button danger small" data-delete-test="${test.id}" data-delete-title="${escapeHtml(test.title)}">刪除</button></div>
      </article>`;
    }).join("") : '<div class="empty-state">還沒有測驗。建立第一份測驗後，學生即可加入。</div>';
    list.querySelectorAll("[data-view-test]").forEach((button) => button.addEventListener("click", () => renderTeacherSubmissions(button.dataset.viewTest)));
    list.querySelectorAll("[data-copy-code]").forEach((button) => button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.copyCode);
      showToast("測驗代碼已複製。");
    }));
    list.querySelectorAll("[data-toggle-test]").forEach((button) => button.addEventListener("click", async () => {
      const shouldClose = button.dataset.status === "open";
      await updateDoc(doc(db, "tests", button.dataset.toggleTest), {
        status: shouldClose ? "closed" : "open",
        ...(!shouldClose ? { closesAt: null } : {}),
        updatedAt: serverTimestamp()
      });
    }));
    list.querySelectorAll("[data-save-close]").forEach((button) => button.addEventListener("click", async () => {
      const input = button.closest(".record-card").querySelector("[data-close-time]");
      const closeDate = input.value ? new Date(input.value) : null;
      if (!closeDate || !Number.isFinite(closeDate.getTime()) || closeDate.getTime() <= Date.now()) {
        showToast("請選擇晚於現在的關閉時間。");
        return;
      }
      button.disabled = true;
      try {
        await updateDoc(doc(db, "tests", button.dataset.saveClose), {
          closesAt: Timestamp.fromDate(closeDate),
          updatedAt: serverTimestamp()
        });
        showToast(`測驗將於 ${formatTime(closeDate)} 自動關閉。`);
      } catch (error) {
        showToast(`設定失敗：${error.message}`);
        button.disabled = false;
      }
    }));
    list.querySelectorAll("[data-clear-close]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await updateDoc(doc(db, "tests", button.dataset.clearClose), {
          closesAt: null,
          updatedAt: serverTimestamp()
        });
        showToast("自動關閉時間已清除。");
      } catch (error) {
        showToast(`清除失敗：${error.message}`);
        button.disabled = false;
      }
    }));
    list.querySelectorAll("[data-delete-test]").forEach((button) => button.addEventListener("click", async () => {
      const confirmed = window.confirm(`確定要刪除「${button.dataset.deleteTitle}」嗎？\n\n所有學生交卷、成績和訂正也會永久刪除，無法復原。`);
      if (!confirmed) return;
      button.disabled = true;
      try {
        await deleteTestAndSubmissions(button.dataset.deleteTest);
        showToast("測驗及相關交卷已刪除。");
      } catch (error) {
        showToast(`刪除失敗：${error.message}`);
        button.disabled = false;
      }
    }));
  }, (error) => showToast(`讀取測驗失敗：${error.message}`));
  state.unsubscribers.push(unsubscribe);
}

function submissionCard(submission, showTest = false) {
  const graded = submission.status === "graded";
  return `
    <article class="record-card submission-card">
      <div class="record-top"><div><h3>${escapeHtml(submission.studentName)}</h3><span class="meta">${escapeHtml(submission.studentEmail)} · ${formatTime(submission.submittedAt)}</span></div><span class="status ${graded ? "graded" : "submitted"}">${graded ? "已批改" : "待批改"}</span></div>
      ${showTest ? `<p class="record-context">${escapeHtml(submission.testTitle)} · ${escapeHtml(submission.className || "未指定班級")}</p>` : ""}
      <p class="answer-preview">${escapeHtml(submission.answer)}</p>
      <div class="integrity-line"><span>裝置 ${escapeHtml(submission.deviceCode)}</span><span>離開 ${submission.metrics?.focusLeaves || 0} 次</span><span>貼上 ${submission.metrics?.pasteAttempts || 0} 次</span>${graded ? `<strong>成績：${escapeHtml(submission.grade)}</strong>` : ""}</div>
      <div class="row-actions"><button class="button small" data-grade-id="${submission.id}">${graded ? "查看／修改批改" : "開始批改"}</button></div>
    </article>`;
}

function groupedSubmissionCards(submissions) {
  const groups = new Map();
  submissions.forEach((submission) => {
    const key = submission.testId || submission.testTitle || "legacy-test";
    if (!groups.has(key)) {
      groups.set(key, {
        title: submission.testTitle || "未命名聽寫",
        className: submission.className || "未指定班級",
        latestSubmission: submission.submittedAt?.seconds || 0,
        submissions: []
      });
    }
    const group = groups.get(key);
    group.latestSubmission = Math.max(group.latestSubmission, submission.submittedAt?.seconds || 0);
    group.submissions.push(submission);
  });

  return [...groups.values()]
    .sort((left, right) => right.latestSubmission - left.latestSubmission)
    .map((group) => {
      const total = group.submissions.length;
      const graded = group.submissions.filter((submission) => submission.status === "graded").length;
      return `
        <details class="submission-group">
          <summary class="submission-group-header">
            <div><p class="eyebrow">聽寫名稱</p><h3>${escapeHtml(group.title)}</h3><span class="meta">${escapeHtml(group.className)}</span></div>
            <div class="submission-header-actions">
              <div class="submission-stats">
                <span>交卷總數<strong>${total}</strong></span>
                <span>已批改<strong>${graded} / ${total}</strong></span>
              </div>
              <span class="collapse-label"><span class="closed-label">展開交卷</span><span class="open-label">收合交卷</span><span class="collapse-icon">⌄</span></span>
            </div>
          </summary>
          <div class="record-list">${group.submissions.map((submission) => submissionCard(submission)).join("")}</div>
        </details>`;
    }).join("");
}

function renderTeacherSubmissions(testId) {
  cleanupView();
  app.innerHTML = roleShell(`
    <button id="back-tests" class="text-button">← 返回測驗管理</button>
    <div id="test-heading" class="page-heading-row"><div><p class="eyebrow">Test submissions</p><h2>學生交卷</h2><p>正在載入測驗資料⋯</p></div></div>
    <div id="submission-list" class="record-list"><div class="empty-state">正在載入交卷⋯</div></div>`, "tests");
  bindShellNavigation();
  document.querySelector("#back-tests").addEventListener("click", renderTeacherTests);
  const testUnsubscribe = onSnapshot(doc(db, "tests", testId), (snapshot) => {
    if (!snapshot.exists()) return;
    const test = snapshot.data();
    document.querySelector("#test-heading").innerHTML = `<div><p class="eyebrow">${escapeHtml(test.className || "現場聽寫")}</p><h2>${escapeHtml(test.title)}</h2><p>測驗代碼 <strong>${test.code}</strong></p></div>`;
  });
  const submissionsQuery = query(collection(db, "submissions"), where("testId", "==", testId));
  const submissionUnsubscribe = onSnapshot(submissionsQuery, (snapshot) => {
    const submissions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.submittedAt?.seconds || 0) - (left.submittedAt?.seconds || 0));
    const list = document.querySelector("#submission-list");
    list.innerHTML = submissions.length ? submissions.map((submission) => submissionCard(submission)).join("") : '<div class="empty-state">目前還沒有學生交卷。</div>';
    bindGradeButtons(() => renderTeacherSubmissions(testId));
  }, (error) => showToast(`讀取交卷失敗：${error.message}`));
  state.unsubscribers.push(testUnsubscribe, submissionUnsubscribe);
}

function renderTeacherAllSubmissions() {
  cleanupView();
  app.innerHTML = roleShell(`
    <div class="page-heading-row"><div><p class="eyebrow">Grading center</p><h2>批改中心</h2><p>所有學生的交卷與批改狀態。</p></div></div>
    <div id="all-submissions" class="grading-groups"><div class="empty-state">正在載入交卷⋯</div></div>`, "grading");
  bindShellNavigation();
  const unsubscribe = onSnapshot(collection(db, "submissions"), (snapshot) => {
    const submissions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.submittedAt?.seconds || 0) - (left.submittedAt?.seconds || 0));
    const list = document.querySelector("#all-submissions");
    list.innerHTML = submissions.length ? groupedSubmissionCards(submissions) : '<div class="empty-state">目前還沒有學生交卷。</div>';
    bindGradeButtons(renderTeacherAllSubmissions);
  }, (error) => showToast(`讀取交卷失敗：${error.message}`));
  state.unsubscribers.push(unsubscribe);
}

function bindGradeButtons(returnView) {
  document.querySelectorAll("[data-grade-id]").forEach((button) => button.addEventListener("click", () => renderGradeEditor(button.dataset.gradeId, returnView)));
}

async function renderGradeEditor(submissionId, returnView) {
  cleanupView();
  renderLoading("正在開啟學生答案⋯");
  try {
    const snapshot = await getDoc(doc(db, "submissions", submissionId));
    if (!snapshot.exists()) throw new Error("找不到這份交卷。");
    const submission = { id: snapshot.id, ...snapshot.data() };
    app.innerHTML = roleShell(`
      <button id="back-submissions" class="text-button">← 返回交卷列表</button>
      <div class="grade-layout">
        <section class="card panel-card">
          <p class="eyebrow">Student answer</p><h2>${escapeHtml(submission.testTitle)}</h2>
          <div class="student-summary"><strong>${escapeHtml(submission.studentName)}</strong><span>${escapeHtml(submission.studentEmail)}</span><span>裝置 ${escapeHtml(submission.deviceCode)}</span><span>${formatTime(submission.submittedAt)}</span></div>
          <div class="answer-label">學生答案</div><p class="final-answer">${escapeHtml(submission.answer)}</p>
          <div class="integrity-line"><span>作答 ${Math.max(1, Math.round((submission.metrics?.durationSeconds || 0) / 60))} 分鐘</span><span>離開畫面 ${submission.metrics?.focusLeaves || 0} 次</span><span>貼上嘗試 ${submission.metrics?.pasteAttempts || 0} 次</span><span>異常插入 ${submission.metrics?.suspiciousInsertions || 0} 次</span></div>
        </section>
        <form id="grade-form" class="card panel-card grade-panel">
          <p class="eyebrow">Teacher review</p><h3>成績與訂正</h3>
          <div class="field"><label for="grade">成績</label><input id="grade" name="grade" maxlength="20" required placeholder="例如：95、A、通過" value="${escapeHtml(submission.grade || "")}" /></div>
          <div class="field"><label for="correction">正確答案／訂正</label><textarea id="correction" name="correction" maxlength="10000" placeholder="輸入正確內容或需要修改的部分">${escapeHtml(submission.correction || "")}</textarea></div>
          <div class="field"><label for="feedback">老師評語</label><textarea id="feedback" name="feedback" maxlength="2000" placeholder="給學生的建議">${escapeHtml(submission.feedback || "")}</textarea></div>
          <button class="button full" type="submit">儲存並傳送給學生</button>
        </form>
      </div>`, "grading");
    bindShellNavigation();
    document.querySelector("#back-submissions").addEventListener("click", returnView);
    document.querySelector("#grade-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      const data = new FormData(form);
      button.disabled = true;
      try {
        await updateDoc(doc(db, "submissions", submissionId), {
          grade: String(data.get("grade") || "").trim().slice(0, 20),
          correction: String(data.get("correction") || "").trim().slice(0, 10000),
          feedback: String(data.get("feedback") || "").trim().slice(0, 2000),
          status: "graded",
          gradedAt: serverTimestamp(),
          gradedBy: state.user.uid
        });
        showToast("批改已儲存，學生現在可以查看。");
        returnView();
      } catch (error) {
        showToast(`儲存失敗：${error.message}`);
        button.disabled = false;
      }
    });
  } catch (error) {
    renderFirebaseError(error);
  }
}

function renderStudentHome() {
  cleanupView();
  app.innerHTML = roleShell(`
    <div class="student-home-grid">
      <div class="student-intro"><p class="eyebrow">Student test</p><h1>準備聽寫<span>輸入代碼，開始作答。</span></h1><p class="lead">請向老師取得六位測驗代碼。交卷後，老師會在批改中心輸入成績、訂正與評語。</p></div>
      <form id="join-test" class="card start-card">
        <h2>加入測驗</h2>
        <div class="field"><label for="test-code">六位測驗代碼</label><input id="test-code" class="code-input" name="code" maxlength="6" autocomplete="off" autocapitalize="characters" required placeholder="ABC123" /></div>
        <div class="field"><label for="student-name">交卷姓名</label><input id="student-name" name="studentName" maxlength="40" required value="${escapeHtml(state.studentName || state.user.displayName || "")}" /></div>
        <button class="button full" type="submit">尋找測驗</button>
        <div class="account-note"><span>Google 帳號</span><strong>${escapeHtml(state.user.email)}</strong></div>
      </form>
    </div>`, "take");
  bindShellNavigation();
  document.querySelector("#join-test").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const data = new FormData(form);
    const code = String(data.get("code") || "").trim().toUpperCase();
    button.disabled = true;
    try {
      const testSnapshot = await getDoc(doc(db, "tests", code));
      if (!testSnapshot.exists()) throw new Error("找不到這個測驗代碼。");
      const test = { id: testSnapshot.id, ...testSnapshot.data() };
      if (!isTestOpen(test)) throw new Error("老師已關閉這個測驗。");
      state.activeTest = test;
      state.studentName = String(data.get("studentName") || "").trim().slice(0, 40);
      renderWriting();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  });
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

function renderWatermarks() {
  const layer = document.querySelector("#watermark-layer");
  if (!layer) return;
  const deviceCode = getDeviceCode();
  const positions = [[4,12], [46,9], [73,27], [16,43], [55,52], [3,70], [67,76], [28,91]];
  layer.innerHTML = positions.map(([left, top]) => `<span class="watermark" style="left:${left}%;top:${top}%">${escapeHtml(state.studentName)} · ${deviceCode}</span>`).join("");
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
      showToast("這個快捷鍵在測驗中已停用。");
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

function renderWriting() {
  cleanupView();
  document.body.classList.add("exam-mode");
  state.startedAt = Date.now();
  state.keyEvents = 0;
  state.pasteAttempts = 0;
  state.focusLeaves = 0;
  state.suspiciousInsertions = 0;
  state.lastLength = 0;
  state.isComposing = false;
  const test = state.activeTest;
  app.innerHTML = `
    <main class="write-shell">
      <div id="watermark-layer" class="watermark-layer" aria-hidden="true"></div>
      <div class="write-frame">
        <button id="leave-writing" class="text-button write-back" type="button">← 返回</button>
        <header class="write-head"><div><p class="eyebrow">${escapeHtml(test.className || "現場聽寫")}</p><h2>${escapeHtml(test.title)}</h2><p class="meta">${escapeHtml(test.instructions || "聽老師播放或朗讀後，依序輸入內容。")}</p></div><div class="student-chip"><strong>${escapeHtml(state.studentName)}</strong> · 裝置 ${getDeviceCode()}</div></header>
        <form id="writing-form" class="card writing-card">
          <textarea id="writing-area" class="writing-area" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="聽寫作答區" placeholder="在這裡開始輸入⋯" required></textarea>
          <div class="writing-footer"><p>禁止貼上 · 離開畫面會留下紀錄 · 交卷後不能修改</p><button class="button" type="submit">完成並交卷</button></div>
        </form>
      </div>
      <div id="privacy-shield" class="privacy-shield hidden"><div><strong>作答畫面已隱藏</strong>回到這個分頁後才能繼續。</div></div>
    </main>`;
  renderWatermarks();
  const area = document.querySelector("#writing-area");
  area.focus();
  preventPaste(area);
  protectWriting(area);
  document.querySelector("#leave-writing").addEventListener("click", () => {
    if (area.value.trim() && !confirm("返回後，目前輸入的內容不會保留。確定要返回嗎？")) return;
    state.activeTest = null;
    renderStudentHome();
  });
  document.querySelector("#writing-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const answer = area.value.trim();
    if (!answer) return showToast("請先輸入聽寫內容。");
    if (!confirm("交卷後不能修改。確定要提交嗎？")) return;
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const submissionId = `${test.id}_${state.user.uid}`;
      await setDoc(doc(db, "submissions", submissionId), {
        testId: test.id,
        testCode: test.code,
        testTitle: test.title,
        className: test.className || "",
        userId: state.user.uid,
        studentName: state.studentName,
        studentEmail: state.user.email || "",
        studentPhotoURL: state.user.photoURL || "",
        answer,
        deviceCode: getDeviceCode(),
        startedAt: new Date(state.startedAt),
        submittedAt: serverTimestamp(),
        status: "submitted",
        grade: null,
        correction: "",
        feedback: "",
        gradedAt: null,
        gradedBy: null,
        metrics: {
          durationSeconds: Math.round((Date.now() - state.startedAt) / 1000),
          keyEvents: state.keyEvents,
          pasteAttempts: state.pasteAttempts,
          focusLeaves: state.focusLeaves,
          suspiciousInsertions: state.suspiciousInsertions
        }
      });
      renderSubmissionReceipt();
    } catch (error) {
      const message = error.code === "permission-denied"
        ? "無法重複交卷；請到「我的成績」查看。"
        : `交卷失敗：${error.message}`;
      showToast(message);
      button.disabled = false;
    }
  });
}

function renderSubmissionReceipt() {
  cleanupView();
  app.innerHTML = roleShell(`
    <section class="card receipt-card"><div class="success-mark">✓</div><p class="eyebrow">Submitted</p><h2>交卷成功</h2><p>${escapeHtml(state.studentName)}，你的「${escapeHtml(state.activeTest.title)}」已安全送交老師。</p><div class="notice success-notice">老師批改後，成績、訂正與評語會出現在「我的成績」。</div><button id="open-results" class="button">查看我的成績</button></section>`, "take");
  bindShellNavigation();
  document.querySelector("#open-results").addEventListener("click", renderStudentResults);
}

function renderStudentResults() {
  cleanupView();
  app.innerHTML = roleShell(`
    <div class="page-heading-row"><div><p class="eyebrow">My results</p><h2>我的成績</h2><p>只有你和老師可以查看這些內容。</p></div></div>
    <div id="student-results" class="record-list"><div class="empty-state">正在載入成績⋯</div></div>`, "results");
  bindShellNavigation();
  const resultsQuery = query(collection(db, "submissions"), where("userId", "==", state.user.uid));
  const unsubscribe = onSnapshot(resultsQuery, (snapshot) => {
    const results = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => (right.submittedAt?.seconds || 0) - (left.submittedAt?.seconds || 0));
    const container = document.querySelector("#student-results");
    container.innerHTML = results.length ? results.map((result) => {
      const graded = result.status === "graded";
      return `
        <article class="card result-record">
          <div class="record-top"><div><p class="eyebrow">${escapeHtml(result.className || "現場聽寫")}</p><h3>${escapeHtml(result.testTitle)}</h3><span class="meta">交卷：${formatTime(result.submittedAt)}</span></div><span class="status ${graded ? "graded" : "submitted"}">${graded ? "已批改" : "等待批改"}</span></div>
          ${graded ? `<div class="grade-display"><span>成績</span><strong>${escapeHtml(result.grade)}</strong></div>` : ""}
          <div class="answer-label">我的答案</div><p class="result-answer">${escapeHtml(result.answer)}</p>
          ${graded && result.correction ? `<div class="answer-label">正確答案／訂正</div><p class="correction-box">${escapeHtml(result.correction)}</p>` : ""}
          ${graded && result.feedback ? `<div class="answer-label">老師評語</div><p class="feedback-box">${escapeHtml(result.feedback)}</p>` : ""}
          ${graded ? `<p class="meta">批改時間：${formatTime(result.gradedAt)}</p>` : ""}
        </article>`;
    }).join("") : '<div class="empty-state">你還沒有交卷紀錄。</div>';
  }, (error) => showToast(`讀取成績失敗：${error.message}`));
  state.unsubscribers.push(unsubscribe);
}

renderLoading();
onAuthStateChanged(auth, (user) => {
  if (!user) {
    state.user = null;
    state.isAdmin = false;
    renderLogin();
    return;
  }
  renderLoading("正在確認帳號權限⋯");
  loadAccount(user).catch((error) => {
    state.user = user;
    renderFirebaseError(error);
  });
});
