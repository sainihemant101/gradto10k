// ============================================================
// 10K BUILD — app.js
// Plan = static reference data (plan.json, optionally refreshed
// from the published Google Sheet CSV).
// Logs = user performance data, stored separately in Firestore
// at users/{uid}/logs/{taskId}, cached offline by the SDK.
// ============================================================

import { firebaseConfig, SHEET_CSV_URL } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, setDoc, collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- state ----------
const state = {
  plan: [],            // [{id,date,day,week,type,runType,plannedKm,instructions}]
  logs: {},            // taskId -> log doc
  uid: null,
  viewDate: todayISO(),
  streakWindow: 10,
  firebaseReady: false,
};

const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-IN",
    { weekday: "short", day: "numeric", month: "short" });
}
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), ms);
}

// ============================================================
// PLAN LOADING — bundled plan.json, then optional sheet refresh
// ============================================================
async function loadPlan() {
  const cached = localStorage.getItem("plan-v1");
  if (cached) { try { state.plan = JSON.parse(cached); } catch {} }

  if (!state.plan.length) {
    const res = await fetch("plan.json");
    state.plan = await res.json();
  }
  renderAll();

  if (SHEET_CSV_URL) {
    try {
      const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const fresh = parsePlanCSV(await res.text());
      if (fresh.length) {
        state.plan = fresh;
        localStorage.setItem("plan-v1", JSON.stringify(fresh));
        renderAll();
      }
    } catch (e) {
      console.warn("Sheet refresh failed, using bundled plan.", e);
    }
  }
}

// Minimal CSV parser that handles quoted fields.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some(v => v !== "")) rows.push(row); }
  return rows;
}

const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parsePlanCSV(text) {
  const rows = parseCSV(text);
  const head = rows.shift().map(h => h.trim().toLowerCase());
  const col = (name) => head.findIndex(h => h.startsWith(name));
  const ci = {
    day: col("day"), date: col("date"), task: col("task"),
    runType: col("run type"), km: col("run distance"), instr: col("run instructions"),
  };
  const out = [];
  for (const r of rows) {
    const raw = (r[ci.date] || "").trim();           // e.g. 15-Jun-2026
    const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) continue;
    const iso = `${m[3]}-${String(MONTHS[m[2]] + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const type = (r[ci.task] || "").trim().toLowerCase();
    if (!type) continue;
    const instr = (r[ci.instr] || "").trim();
    const wkMatch = instr.match(/Week (\d+):/);
    out.push({
      id: `${iso}_${type}`,
      date: iso,
      day: (r[ci.day] || "").trim(),
      week: wkMatch ? Number(wkMatch[1]) : null,
      type,
      runType: (r[ci.runType] || "").trim() || null,
      plannedKm: r[ci.km] && r[ci.km].trim() ? Number(r[ci.km]) : null,
      instructions: instr.replace(/^Week \d+:\s*/, ""),
    });
  }
  return out;
}

// ============================================================
// FIREBASE — anonymous auth + live log sync (offline-capable)
// ============================================================
let db = null;
function initFirebase() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
    $("syncDot").className = "sync-dot err";
    $("syncDot").title = "Firebase not configured — logs stay on this device";
    loadLocalLogs();
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
    });
    const auth = getAuth(app);
    onAuthStateChanged(auth, (user) => {
      if (!user) return;
      state.uid = user.uid;
      state.firebaseReady = true;
      $("syncDot").className = "sync-dot ok";
      $("syncDot").title = "Synced with Firebase";
      onSnapshot(collection(db, "users", state.uid, "logs"), (snap) => {
        snap.docChanges().forEach((ch) => { state.logs[ch.doc.id] = ch.doc.data(); });
        renderAll();
      });
    });
    signInAnonymously(auth).catch((e) => {
      console.error(e);
      $("syncDot").className = "sync-dot err";
      $("syncDot").title = "Auth failed — enable Anonymous sign-in in Firebase";
      loadLocalLogs();
    });
  } catch (e) {
    console.error(e);
    loadLocalLogs();
  }
}

// Local fallback so the app is usable before Firebase is set up.
function loadLocalLogs() {
  try { state.logs = JSON.parse(localStorage.getItem("logs-v1") || "{}"); } catch {}
  renderAll();
}
async function saveLog(taskId, data) {
  const log = { ...data, taskId, loggedAt: new Date().toISOString() };
  state.logs[taskId] = log;
  renderAll();
  if (state.firebaseReady) {
    await setDoc(doc(db, "users", state.uid, "logs", taskId),
      { ...log, serverLoggedAt: serverTimestamp() }, { merge: true });
  } else {
    localStorage.setItem("logs-v1", JSON.stringify(state.logs));
  }
}

// ============================================================
// TODAY VIEW
// ============================================================
function renderToday() {
  const iso = state.viewDate;
  $("dateLabel").textContent = iso === todayISO() ? `TODAY · ${fmtDate(iso)}` : fmtDate(iso);
  $("jumpToday").classList.toggle("hidden", iso === todayISO());

  const tasks = state.plan.filter(t => t.date === iso);
  const wk = tasks[0]?.week;
  $("weekBadge").textContent = wk ? `WK ${String(wk).padStart(2, "0")}/12` : "WK —";

  const wrap = $("taskCards");
  wrap.innerHTML = "";
  if (!tasks.length) {
    wrap.innerHTML = `<p class="empty-note">No task scheduled — this date is outside the 12-week block (15 Jun – 6 Sep 2026).</p>`;
    return;
  }

  for (const t of tasks) {
    const log = state.logs[t.id];
    const card = document.createElement("article");
    card.className = `bib ${t.type}`;
    const headline = t.type === "run"
      ? `<span class="bib-number">${t.plannedKm}<small> KM</small></span>
         <span class="bib-runtype">${t.runType || "Run"}</span>`
      : t.type === "lift"
        ? `<span class="bib-number">LIFT</span><span class="bib-runtype">Strength</span>`
        : `<span class="bib-number">REST</span><span class="bib-runtype">Recovery</span>`;

    const statusHTML = log
      ? `<span class="bib-status ${log.status}">${statusLabel(log)}</span>`
      : `<span class="bib-status">NOT LOGGED</span>`;

    card.innerHTML = `
      <div class="bib-band">
        <span class="bib-band-left">${t.type.toUpperCase()}</span>
        <span class="bib-band-right">WK ${String(t.week).padStart(2, "0")} · ${t.day.toUpperCase()} · ${t.id.slice(0, 10)}</span>
      </div>
      <div class="bib-main">
        <div class="bib-headline">${headline}</div>
        <p class="bib-instructions">${t.instructions}</p>
      </div>
      <div class="bib-footer">
        ${statusHTML}
        <button class="btn ${log ? "" : "btn-primary"}" data-log="${t.id}">
          ${log ? "Edit log" : "Log performance"}
        </button>
      </div>`;
    wrap.appendChild(card);
  }
  wrap.querySelectorAll("[data-log]").forEach(btn =>
    btn.addEventListener("click", () => openFlashcards(btn.dataset.log)));
}

function statusLabel(log) {
  if (log.status === "done") {
    const bits = ["✓ DONE"];
    if (log.distanceKm != null) bits.push(`${log.distanceKm} KM`);
    if (log.timeMin != null) bits.push(`${log.timeMin} MIN`);
    return bits.join(" · ");
  }
  if (log.status === "partial") return `◐ PARTIAL · ${log.completionPct ?? "?"}%`;
  return "✗ SKIPPED";
}

// ============================================================
// FLASHCARD LOGGER
// ============================================================
const flash = { task: null, steps: [], idx: 0, answers: {} };

function buildSteps(task, prev) {
  const a = flash.answers;
  const steps = [];

  steps.push({
    key: "status",
    render: () => choiceStep(
      `Did you complete the ${task.type === "rest" ? "rest day" : task.type}?`,
      task.type === "run" ? `${task.plannedKm} km ${task.runType || ""} planned` : task.instructions.slice(0, 80) + "…",
      [
        { v: "done", label: "Done", sub: "completed as planned" },
        { v: "partial", label: "Partially", sub: "did some of it" },
        { v: "skipped", label: "Skipped", sub: "didn't do it" },
      ], a.status),
  });

  const active = () => a.status && a.status !== "skipped";

  if (task.type === "run") {
    steps.push({
      key: "distanceKm", when: active,
      render: () => numberStep("How far did you run?", "km", a.distanceKm ?? prev?.distanceKm ?? task.plannedKm,
        `Planned: ${task.plannedKm} km`, 0.1),
    });
    steps.push({
      key: "timeMin", when: active,
      render: () => numberStep("Total time on feet?", "min", a.timeMin ?? prev?.timeMin ?? "", "Include warm-up and cool-down", 1),
    });
  }
  if (task.type !== "rest") {
    steps.push({
      key: "difficulty", when: active,
      render: () => chipStep("How hard did it feel?", "1 = very easy · 10 = max effort",
        Array.from({ length: 10 }, (_, i) => i + 1), a.difficulty ?? prev?.difficulty),
    });
    steps.push({
      key: "completionPct", when: () => a.status === "partial",
      render: () => chipStep("Roughly how much did you finish?", "of the planned session",
        [10, 25, 40, 50, 60, 75, 90], a.completionPct ?? prev?.completionPct, "%"),
    });
  }

  steps.push({ key: "summary", render: () => summaryStep(task) });
  return steps;
}

function visibleSteps() {
  return flash.steps.filter(s => !s.when || s.when());
}

function openFlashcards(taskId) {
  flash.task = state.plan.find(t => t.id === taskId);
  const prev = state.logs[taskId];
  flash.answers = prev ? {
    status: prev.status, distanceKm: prev.distanceKm, timeMin: prev.timeMin,
    difficulty: prev.difficulty, completionPct: prev.completionPct,
  } : {};
  flash.steps = buildSteps(flash.task, prev);
  flash.idx = 0;
  $("flashOverlay").classList.remove("hidden");
  renderFlash();
}
function closeFlashcards() { $("flashOverlay").classList.add("hidden"); }

function renderFlash() {
  const steps = visibleSteps();
  flash.idx = Math.min(flash.idx, steps.length - 1);
  const step = steps[flash.idx];
  $("flashBar").style.width = `${((flash.idx + 1) / steps.length) * 100}%`;
  $("flashBody").innerHTML = "";
  $("flashBody").appendChild(step.render());
  $("flashBack").style.visibility = flash.idx === 0 ? "hidden" : "visible";
  const last = flash.idx === steps.length - 1;
  $("flashNext").textContent = last ? "Save" : "Next";
  updateNextEnabled();
  const input = $("flashBody").querySelector("input");
  if (input) setTimeout(() => input.focus(), 60);
}

function updateNextEnabled() {
  const step = visibleSteps()[flash.idx];
  let ok = true;
  if (step.key === "status") ok = !!flash.answers.status;
  if (step.key === "difficulty") ok = flash.answers.difficulty != null;
  if (step.key === "completionPct") ok = flash.answers.completionPct != null;
  if (step.key === "distanceKm") ok = isFinite(parseFloat($("numField")?.value));
  $("flashNext").disabled = !ok;
}

function choiceStep(q, hint, options, current) {
  const el = document.createElement("div");
  el.innerHTML = `<h3 class="flash-q">${q}</h3><p class="flash-hint">${hint}</p>`;
  const grid = document.createElement("div");
  grid.className = "choice-grid";
  options.forEach(o => {
    const b = document.createElement("button");
    b.className = "choice" + (current === o.v ? " selected" : "");
    b.innerHTML = `<span class="choice-mark"></span><span>${o.label}<br><span class="mono">${o.sub}</span></span>`;
    b.addEventListener("click", () => {
      flash.answers.status = o.v;
      grid.querySelectorAll(".choice").forEach(c => c.classList.remove("selected"));
      b.classList.add("selected");
      updateNextEnabled();
      setTimeout(next, 220);
    });
    grid.appendChild(b);
  });
  el.appendChild(grid);
  return el;
}

function numberStep(q, unit, value, planNote, stepSize) {
  const el = document.createElement("div");
  el.innerHTML = `
    <h3 class="flash-q">${q}</h3>
    <div class="num-input-wrap">
      <input id="numField" class="num-input" type="number" inputmode="decimal"
             step="${stepSize}" min="0" value="${value !== "" && value != null ? value : ""}">
      <span class="num-unit">${unit}</span>
    </div>
    <p class="num-plan">${planNote}</p>`;
  el.querySelector("input").addEventListener("input", updateNextEnabled);
  return el;
}

function chipStep(q, hint, values, current, suffix = "") {
  const el = document.createElement("div");
  el.innerHTML = `<h3 class="flash-q">${q}</h3><p class="flash-hint">${hint}</p>`;
  const row = document.createElement("div");
  row.className = "chip-row";
  values.forEach(v => {
    const b = document.createElement("button");
    b.className = "chip" + (current === v ? " selected" : "");
    b.textContent = v + suffix;
    b.addEventListener("click", () => {
      const key = visibleSteps()[flash.idx].key;
      flash.answers[key] = v;
      row.querySelectorAll(".chip").forEach(c => c.classList.remove("selected"));
      b.classList.add("selected");
      updateNextEnabled();
      setTimeout(next, 220);
    });
    row.appendChild(b);
  });
  el.appendChild(row);
  return el;
}

function summaryStep(task) {
  const a = flash.answers;
  if (a.status === "done") a.completionPct = 100;
  if (a.status === "skipped") a.completionPct = 0;
  const rows = [
    ["Task", `${task.type.toUpperCase()}${task.runType ? " · " + task.runType : ""}`],
    ["Status", a.status?.toUpperCase()],
  ];
  if (a.distanceKm != null && a.status !== "skipped") rows.push(["Distance", `${a.distanceKm} km of ${task.plannedKm} km`]);
  if (a.timeMin != null && a.status !== "skipped") rows.push(["Time", `${a.timeMin} min`]);
  if (a.difficulty != null && a.status !== "skipped") rows.push(["Difficulty", `${a.difficulty}/10`]);
  rows.push(["Completion", `${a.completionPct}%`]);
  const el = document.createElement("div");
  el.innerHTML = `<h3 class="flash-q">Save this entry?</h3>
    <div class="flash-summary">${rows.map(([k, v]) =>
      `<div class="row"><span>${k}</span><strong>${v ?? "—"}</strong></div>`).join("")}</div>`;
  return el;
}

function captureCurrent() {
  const step = visibleSteps()[flash.idx];
  if (step.key === "distanceKm" || step.key === "timeMin") {
    const v = parseFloat($("numField")?.value);
    flash.answers[step.key] = isFinite(v) ? v : null;
  }
}
function next() {
  captureCurrent();
  const steps = visibleSteps();
  if (flash.idx < steps.length - 1) { flash.idx++; renderFlash(); }
  else finishFlash();
}
async function finishFlash() {
  const t = flash.task, a = flash.answers;
  const log = {
    date: t.date, week: t.week, type: t.type, runType: t.runType,
    plannedKm: t.plannedKm,
    status: a.status,
    distanceKm: a.status === "skipped" ? 0 : (a.distanceKm ?? null),
    timeMin: a.status === "skipped" ? null : (a.timeMin ?? null),
    difficulty: a.status === "skipped" ? null : (a.difficulty ?? null),
    completionPct: a.status === "done" ? 100 : a.status === "skipped" ? 0 : (a.completionPct ?? null),
  };
  closeFlashcards();
  await saveLog(t.id, log);
  toast(state.firebaseReady ? "Saved to Firebase ✓" : "Saved on this device (Firebase not configured)");
}

// ============================================================
// ANALYTICS — runs only
// ============================================================
function renderAnalytics() {
  const runs = state.plan.filter(t => t.type === "run")
    .sort((x, y) => x.date.localeCompare(y.date));
  const total = runs.length;
  const logged = runs.map(r => ({ ...r, log: state.logs[r.id] }));
  const done = logged.filter(r => r.log?.status === "done");
  const partial = logged.filter(r => r.log?.status === "partial");

  // 1. % completed
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  $("statPct").textContent = pct;
  $("statPctDetail").textContent =
    `${done.length} done${partial.length ? ` · ${partial.length} partial` : ""} of ${total} planned runs`;

  // 3. total distance
  const km = logged.reduce((s, r) => s + (r.log?.distanceKm || 0), 0);
  $("statKm").textContent = km % 1 ? km.toFixed(1) : km;
  $("statKmDetail").textContent = `of ${runs.reduce((s, r) => s + (r.plannedKm || 0), 0).toFixed(0)} km in the plan`;

  // 4. total runs completed
  $("statRuns").textContent = done.length;
  $("statRunsDetail").textContent = `of ${total} planned`;

  // 5. % left to go
  const remaining = total - done.length;
  $("statLeft").textContent = total ? Math.round((remaining / total) * 100) : 0;
  $("statLeftDetail").textContent = `${remaining} runs remaining`;

  // 2. consistency: last X runs that have already come due
  const today = todayISO();
  const due = logged.filter(r => r.date <= today);
  const win = due.slice(-state.streakWindow);
  const strip = $("streakStrip");
  strip.innerHTML = "";
  win.forEach(r => {
    const cell = document.createElement("div");
    const st = r.log?.status;
    cell.className = "streak-cell " + (st || "");
    cell.title = `${fmtDate(r.date)} · ${r.runType || "run"} · ${st || "not logged"}`;
    cell.textContent = st === "done" ? "✓" : st === "partial" ? "◐" : st === "skipped" ? "✗" : "·";
    strip.appendChild(cell);
  });
  const hit = win.filter(r => r.log?.status === "done").length;
  $("streakHit").textContent = win.length ? `${hit}/${win.length}` : "—";
  let now = 0;
  for (let i = due.length - 1; i >= 0; i--) {
    if (due[i].log?.status === "done") now++;
    else break;
  }
  $("streakNow").textContent = `${now} run${now === 1 ? "" : "s"}`;

  renderLanes(runs, done);
  renderWeeklyKm(logged);
}

function renderLanes(runs, done) {
  const track = $("laneTrack");
  track.innerHTML = "";
  const today = todayISO();
  const curWk = state.plan.find(t => t.date === today)?.week
    ?? state.plan.filter(t => t.date <= today).at(-1)?.week ?? 0;
  for (let w = 1; w <= 12; w++) {
    const wkRuns = runs.filter(r => r.week === w);
    const wkDone = done.filter(r => r.week === w).length;
    const seg = document.createElement("div");
    seg.className = "lane-seg" + (w === curWk ? " current" : "");
    seg.innerHTML = `<div class="fill" style="width:${wkRuns.length ? (wkDone / wkRuns.length) * 100 : 0}%"></div><span class="wk">${w}</span>`;
    track.appendChild(seg);
  }
  $("laneSummary").textContent = curWk ? `WEEK ${curWk} OF 12` : "STARTS 15 JUN";
}

function renderWeeklyKm(logged) {
  const wrap = $("weeklyKm");
  const maxPlan = Math.max(...Array.from({ length: 12 }, (_, i) =>
    logged.filter(r => r.week === i + 1).reduce((s, r) => s + (r.plannedKm || 0), 0)));
  let html = `<span class="lane-caption">WEEKLY KM · DONE VS PLANNED</span>`;
  for (let w = 1; w <= 12; w++) {
    const wk = logged.filter(r => r.week === w);
    const plan = wk.reduce((s, r) => s + (r.plannedKm || 0), 0);
    const ran = wk.reduce((s, r) => s + (r.log?.distanceKm || 0), 0);
    html += `
      <div class="wkm-row">
        <span class="wkm-label">W${w}</span>
        <div class="wkm-bar-wrap">
          <div class="wkm-plan" style="width:${(plan / maxPlan) * 100}%"></div>
          <div class="wkm-done" style="width:${(ran / maxPlan) * 100}%"></div>
        </div>
        <span class="wkm-val">${ran ? ran.toFixed(1) : "0"} / ${plan.toFixed(0)}</span>
      </div>`;
  }
  wrap.innerHTML = html;
}

// ============================================================
// NAV + WIRING
// ============================================================
function renderAll() { renderToday(); renderAnalytics(); }

document.querySelectorAll(".tab").forEach(tab =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    $(`view-${tab.dataset.view}`).classList.add("active");
  }));

$("prevDay").addEventListener("click", () => { state.viewDate = addDays(state.viewDate, -1); renderToday(); });
$("nextDay").addEventListener("click", () => { state.viewDate = addDays(state.viewDate, 1); renderToday(); });
$("jumpToday").addEventListener("click", () => { state.viewDate = todayISO(); renderToday(); });
$("streakWindow").addEventListener("change", (e) => { state.streakWindow = +e.target.value; renderAnalytics(); });

$("flashNext").addEventListener("click", next);
$("flashBack").addEventListener("click", () => { captureCurrent(); if (flash.idx > 0) { flash.idx--; renderFlash(); } });
$("flashClose").addEventListener("click", closeFlashcards);
$("flashOverlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeFlashcards(); });

// ---------- boot ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}
loadPlan();
initFirebase();
