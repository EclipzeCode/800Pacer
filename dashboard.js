/* dashboard.html — page logic. Requires models.js. */
"use strict";


const BAND_META = {
  A: { label: "Band A — Elite",        desc: "Sub-2:00 range. National/international level.",   cls: "band-A" },
  B: { label: "Band B — Sub-Elite",    desc: "2:00–2:10 range. High-level collegiate or club.", cls: "band-B" },
  C: { label: "Band C — Competitive",  desc: "2:10–2:20 range. Strong club athlete.",           cls: "band-C" },
  D: { label: "Band D — Developing",   desc: "2:20+ range. Building aerobic base and speed.",  cls: "band-D" },
};

function loadStorage() {
  const safe = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  };
  return {
    profile : safe("athleteProfile",    null),
    history : safe("predictionHistory", []),
    raceLog : safe("raceLog",           []),
    goal    : safe("athleteGoal",       null),
  };
}

function saveRaceLog(log) {
  try { localStorage.setItem("raceLog", JSON.stringify(log)); } catch (_) {}
}

function saveGoal(goal) {
  try { localStorage.setItem("athleteGoal", JSON.stringify(goal)); } catch (_) {}
}

function fmtTime(sec) {
  if (!sec || isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/* Escape user-entered text before inserting via innerHTML. */
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* Local-date helpers — avoid the UTC-midnight shift that "YYYY-MM-DD"
   parsing and toISOString() both introduce. */
function localDateInputValue(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localDateToTs(dateStr) {
  return dateStr ? new Date(dateStr + "T12:00:00").getTime() : Date.now();
}

function parseTimeStr(str) {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split(":");
  const t = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(str);
  return isNaN(t) || t <= 0 ? null : t;
}

/* ── Hero ──────────────────────────────────────────────── */
function renderHero(history) {
  const heroLatest = document.getElementById("heroLatest");
  const heroSub    = document.getElementById("heroSub");
  if (!history.length) return;
  const latest = history[history.length - 1];
  if (heroLatest) heroLatest.textContent = fmtTime(latest.predicted);
  if (heroSub) {
    const prev = history.length > 1 ? history[history.length - 2].predicted : null;
    if (prev) {
      const delta = latest.predicted - prev;
      if (Math.abs(delta) < 0.005) {
        heroSub.textContent = `Unchanged since previous estimate · ${fmtDate(latest.date)}`;
        return;
      }
      const sign  = delta < 0 ? "▼" : "▲";
      const color = delta < 0 ? "#2d8a4e" : "#e85d20";
      heroSub.innerHTML = `<span style="color:${color}">${sign} ${Math.abs(delta).toFixed(2)}s vs previous estimate</span>`;
    } else {
      heroSub.textContent = `Last updated ${fmtDate(latest.date)}`;
    }
  }
}

/* ── Profile card ──────────────────────────────────────── */
function renderProfileCard(profile) {
  const profileNames = { speed: "Speed / Sprinter", balanced: "800m Specialist", endurance: "Miler / Endurance" };
  const srr = (profile.t400 && profile.t1600)
    ? ((400 / profile.t400) / (1600 / profile.t1600)).toFixed(3)
    : null;
  const h  = JSON.parse(localStorage.getItem("predictionHistory") || "[]");
  const bm = h.length ? BAND_META[h[h.length - 1].band] : null;

  const srrNum   = srr ? parseFloat(srr) : null;
  // Bar runs speed-dominant (high SRR) on the left → aerobic-dominant (low SRR)
  // on the right, matching the Training page's spectrum.
  const srrPct   = srrNum ? Math.max(0, Math.min(100, (srrNum - 1.30) / 0.40 * 100)) : 50;
  const dotLeft  = 100 - srrPct;
  const srrInterp = srrNum
    ? srrNum >= 1.58
      ? "Speed-dominant — more aerobic work will unlock your 800m ceiling."
      : srrNum <= 1.47
        ? "Aerobic-dominant — focused speed work at R-pace will sharpen your kick."
        : "Well-balanced 800m profile — maintain both systems."
    : "";

  return `
  <div class="card dash-profile-card">
    <div class="section-heading">
      <h2>Athlete Profile</h2>
      <a href="index.html" style="font-size:0.78rem;color:var(--accent);text-decoration:none;margin-left:auto">Update PRs ↗</a>
    </div>
    <div class="pr-row">
      <div class="pr-chip"><span>400m PR</span><strong>${profile.t400 ? formatInput(profile.t400) : "—"}</strong></div>
      <div class="pr-chip"><span>1600m PR</span><strong>${profile.t1600 ? formatInput(profile.t1600) : "—"}</strong></div>
      <div class="pr-chip"><span>800m PR</span><strong>${profile.t800 ? formatInput(profile.t800) : "—"}</strong></div>
      <div class="pr-chip"><span>Profile</span><strong style="font-size:0.82rem">${profileNames[profile.profile] ?? "—"}</strong></div>
    </div>
    ${srr ? `
    <div class="srr-wrap">
      <div class="srr-label-row">
        <span>Speed-dominant (≥1.58)</span>
        <span>SRR: ${srr}</span>
        <span>Aerobic-dominant (≤1.47)</span>
      </div>
      <div class="srr-track"><div class="srr-dot" style="left:${dotLeft.toFixed(1)}%"></div></div>
      <p class="srr-value">${srrInterp}</p>
    </div>` : ""}
    ${bm ? `<span class="band-badge ${bm.cls}">${bm.label}</span>
            <span style="font-size:0.78rem;color:var(--text-secondary);margin-left:8px">${bm.desc}</span>` : ""}
  </div>`;
}

/* ── Goal card ─────────────────────────────────────────── */
function renderGoalCard(goal, history) {
  const latestPred = history.length ? history[history.length - 1].predicted : null;
  const firstPred  = history.length > 1 ? history[0].predicted : latestPred;
  const goalSec    = goal ? goal.goalTime : null;

  let progressPct = 0;
  let gapStr = "";
  if (goalSec && latestPred) {
    const gap = latestPred - goalSec;
    gapStr = gap > 0
      ? `${gap.toFixed(2)}s above goal`
      : `${Math.abs(gap).toFixed(2)}s under goal — you're there!`;
    if (firstPred && firstPred > goalSec) {
      progressPct = Math.max(0, Math.min(100, (firstPred - latestPred) / (firstPred - goalSec) * 100));
    }
  }

  return `
  <div class="card dash-goal-card">
    <div class="section-heading"><h2>Goal Time</h2></div>
    <div class="goal-form">
      <input id="goalInput" type="text" placeholder="e.g. 1:55.0" value="${goalSec ? fmtTime(goalSec) : ""}">
      <button class="log-add-btn" id="goalSaveBtn">Save</button>
    </div>
    <div class="goal-gap">
      Gap: <strong>${goalSec && latestPred ? gapStr : "Set a goal to track your progress."}</strong>
    </div>
    ${goalSec && latestPred ? `
    <div class="goal-progress-wrap">
      <div class="goal-progress-bar" style="width:${progressPct.toFixed(1)}%"></div>
    </div>
    <p class="goal-note">${progressPct.toFixed(0)}% of the gap closed since first estimate.</p>` : ""}
  </div>`;
}

/* ── History chart ─────────────────────────────────────── */
function renderHistoryChart(history, goal) {
  if (!history.length) {
    return `
    <div class="card dash-history-card">
      <div class="section-heading"><h2>Prediction History</h2></div>
      <div class="chart-empty">
        No history yet. <a href="index.html">Run the predictor</a> to start tracking your progress.
      </div>
    </div>`;
  }

  const W = 620, H = 190, PX = 52, PY = 18, usableW = W - PX * 2, usableH = H - PY * 2;
  const vals   = history.map(h => h.predicted);
  // Pad the axis so a flat series still gets three distinct labels.
  const span   = Math.max(Math.max(...vals) - Math.min(...vals), 3);
  const minVal = Math.min(...vals) - span * 0.35;
  const maxVal = Math.max(...vals) + span * 0.35;
  const range  = maxVal - minVal;
  const goalSec = goal ? goal.goalTime : null;

  const cx = i => PX + usableW * (i / Math.max(history.length - 1, 1));
  const cy = v => PY + usableH - usableH * ((v - minVal) / range);

  const pts = history.map((h, i) => `${cx(i).toFixed(1)},${cy(h.predicted).toFixed(1)}`).join(" ");

  const areaPath = history.length > 1
    ? `M ${cx(0).toFixed(1)},${(PY + usableH).toFixed(1)} ` +
      history.map((h, i) => `L ${cx(i).toFixed(1)},${cy(h.predicted).toFixed(1)}`).join(" ") +
      ` L ${cx(history.length - 1).toFixed(1)},${(PY + usableH).toFixed(1)} Z`
    : "";

  const goalY = goalSec ? cy(goalSec) : null;
  const goalLine = goalY && goalY > PY && goalY < PY + usableH
    ? `<line x1="${PX}" y1="${goalY.toFixed(1)}" x2="${PX + usableW}" y2="${goalY.toFixed(1)}"
           stroke="rgba(100,200,120,0.65)" stroke-width="1.5" stroke-dasharray="6 4"/>
       <text x="${PX + usableW + 4}" y="${(goalY + 4).toFixed(1)}" font-size="9"
             fill="rgba(100,200,120,0.8)" font-family="Bahnschrift,sans-serif">Goal</text>`
    : "";

  const indices = [...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])];
  const xLabels = indices.map(i => `
    <text x="${cx(i).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="8.5"
          fill="rgba(100,100,100,0.55)" font-family="sans-serif">${fmtDate(history[i].date)}</text>`).join("");

  const yLabels = [0, 0.5, 1].map(f => {
    const v = minVal + range * f;
    return `<text x="${PX - 4}" y="${(cy(v) + 3).toFixed(1)}" text-anchor="end" font-size="8.5"
                  fill="rgba(100,100,100,0.55)" font-family="sans-serif">${fmtTime(v)}</text>`;
  }).join("");

  const profileNames = { speed: "Sprinter", balanced: "Specialist", endurance: "Miler" };
  const dots = history.map((h, i) => {
    const c = { A: "#2d8a4e", B: "#e85d20", C: "#3a6fcf", D: "#888" }[h.band] ?? "#e85d20";
    const inputs = [
      `400m ${h.t400 ? formatInput(h.t400) : "—"}`,
      h.t1600 ? `1600m ${formatInput(h.t1600)}` : null,
      h.t800  ? `prev 800m ${formatInput(h.t800)}` : null,
      h.profile ? profileNames[h.profile] : null,
    ].filter(Boolean).join(" · ");
    return `<g class="hist-pt" data-i="${i}" data-title="${fmtTime(h.predicted)} — ${fmtDate(h.date)}" data-sub="${esc(inputs)}">
      <circle cx="${cx(i).toFixed(1)}" cy="${cy(h.predicted).toFixed(1)}" r="12" fill="transparent"/>
      <circle cx="${cx(i).toFixed(1)}" cy="${cy(h.predicted).toFixed(1)}" r="5" fill="${c}" stroke="#fff" stroke-width="1.5"/>
    </g>`;
  }).join("");

  const sparseNote = history.length < 3
    ? `<p class="chart-sparse">Only ${history.length} estimate${history.length === 1 ? "" : "s"} so far — run the predictor after each block of training and a trend will appear here.</p>`
    : "";

  return `
  <div class="card dash-history-card">
    <div class="section-heading">
      <h2>Prediction History</h2>
      <span style="font-size:0.75rem;color:var(--text-secondary);margin-left:auto">
        ${history.length} estimate${history.length !== 1 ? "s" : ""}
      </span>
    </div>
    ${sparseNote}
    <div class="chart-wrap">
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="histFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="#e85d20" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#e85d20" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${yLabels}
      ${xLabels}
      ${areaPath ? `<path d="${areaPath}" fill="url(#histFill)"/>` : ""}
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      ${goalLine}
      ${dots}
    </svg>
    <div class="chart-tip" id="histTip"></div>
    </div>
    <p style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px">
      Dots colored by band:
      <span style="color:#2d8a4e">■ Elite</span>
      <span style="color:#e85d20;margin-left:6px">■ Sub-elite</span>
      <span style="color:#3a6fcf;margin-left:6px">■ Competitive</span>
      <span style="color:#888;margin-left:6px">■ Developing</span>
    </p>
  </div>`;
}

/* ── Race log ──────────────────────────────────────────── */
function renderRaceLog(raceLog, history) {
  const anchored = loadStorage().profile?.t800 ?? null;
  const rows = [...raceLog].sort((a, b) => b.date - a.date).map(entry => {
    const isAnchor = anchored != null && Math.abs(anchored - entry.time) < 0.005;
    let delta = null;
    if (history.length) {
      const closest = history.reduce((best, h) =>
        Math.abs(h.date - entry.date) < Math.abs(best.date - entry.date) ? h : best
      );
      if (Math.abs(closest.date - entry.date) < 30 * 24 * 3600 * 1000) {
        delta = entry.time - closest.predicted;
      }
    }
    const origIdx  = raceLog.indexOf(entry);
    const deltaStr = delta !== null
      ? `<span class="${delta > 0 ? "delta-pos" : "delta-neg"}">${delta > 0 ? "+" : ""}${delta.toFixed(2)}s</span>`
      : "—";
    return `<tr>
      <td>${fmtDate(entry.date)}</td>
      <td>${fmtTime(entry.time)}</td>
      <td>${entry.venue ? esc(entry.venue) : "—"}</td>
      <td>${deltaStr}</td>
      <td class="log-actions">
        <button class="log-anchor-btn" data-idx="${origIdx}" ${isAnchor ? "disabled" : ""} title="Use this result as the 'Previous 800m' anchor in the predictor">${isAnchor ? "Anchored ✓" : "Use as anchor"}</button>
        <button class="log-del-btn" data-idx="${origIdx}" title="Delete entry">✕</button>
      </td>
    </tr>`;
  }).join("");

  return `
  <div class="card dash-racelog-card">
    <div class="section-heading"><h2>Race Log</h2></div>
    <div class="log-form">
      <label>Date<input id="logDate" type="date" value="${localDateInputValue()}"></label>
      <label>Finish Time<input id="logTime" type="text" placeholder="e.g. 1:58.4"></label>
      <label>Venue / Meet<input id="logVenue" type="text" placeholder="optional"></label>
      <button class="log-add-btn" id="logAddBtn">+ Add Race</button>
    </div>
    <div class="table-inner">
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Venue</th><th>vs Prediction</th><th></th></tr></thead>
        <tbody id="logBody">
          ${rows || `<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-secondary);font-size:0.88rem">No races logged yet — add your first result above.</td></tr>`}
        </tbody>
      </table>
    </div>
    <p style="font-size:0.74rem;color:var(--text-secondary);margin-top:10px">
      "vs Prediction" compares your actual finish to the nearest saved estimate within 30 days.
      <span style="color:#2d8a4e">Green = faster</span> than predicted,
      <span style="color:#e85d20">orange = slower</span>.
    </p>
  </div>`;
}

/* ── Data card ─────────────────────────────────────────── */
function renderDataCard(history, raceLog) {
  return `
  <div class="card dash-data-card">
    <div class="section-heading"><h2>Your Data</h2></div>
    <p class="data-copy">Everything lives in this browser only. Export a backup to move it to another device, or start over.</p>
    <p class="data-copy" id="anchorNote"></p>
    <div class="data-actions">
      <button class="ghost-btn" id="exportBtn" type="button">Export JSON</button>
      <label class="ghost-btn file-btn">Import JSON<input type="file" id="importFile" accept="application/json,.json" hidden></label>
      <button class="ghost-btn" id="clearHistoryBtn" type="button" ${history.length ? "" : "disabled"}>Clear estimates (${history.length})</button>
      <button class="ghost-btn danger" id="resetAllBtn" type="button">Reset all data</button>
    </div>
    <p class="data-copy" id="dataStatus"></p>
  </div>`;
}

/* ── Main render ───────────────────────────────────────── */
function renderDashboard() {
  const { profile, history, raceLog, goal } = loadStorage();
  const main = document.getElementById("dashMain");
  if (!main) return;

  if (!profile && !history.length) {
    main.innerHTML = `
      <div class="dash-empty">
        <h2>Set up your athlete profile</h2>
        <p>Run the 800m predictor once to save your PRs. Your dashboard will track every estimate, race result, and your progress toward your goal.</p>
        <a href="index.html" class="primary-btn">Go to Race Predictor ↗</a>
      </div>`;
    return;
  }

  renderHero(history);

  const parts = [];
  if (profile) parts.push(renderProfileCard(profile));
  parts.push(renderGoalCard(goal, history));
  parts.push(renderHistoryChart(history, goal));
  parts.push(renderRaceLog(raceLog, history));
  parts.push(renderDataCard(history, raceLog));
  main.innerHTML = parts.join("");

  // History point tooltips
  const tip = document.getElementById("histTip");
  const wrap = document.querySelector(".chart-wrap");
  document.querySelectorAll(".hist-pt").forEach(pt => {
    const showTip = evt => {
      if (!tip || !wrap) return;
      tip.innerHTML = `<strong>${pt.dataset.title}</strong>${pt.dataset.sub}`;
      const r = wrap.getBoundingClientRect();
      let x = evt.clientX - r.left + 12;
      if (x + tip.offsetWidth > r.width) x = Math.max(0, evt.clientX - r.left - tip.offsetWidth - 12);
      tip.style.left = x + "px";
      tip.style.top  = (evt.clientY - r.top - 10) + "px";
      tip.classList.add("on");
    };
    pt.addEventListener("pointerenter", showTip);
    pt.addEventListener("pointermove",  showTip);
    pt.addEventListener("pointerleave", () => tip?.classList.remove("on"));
    pt.addEventListener("click", showTip);
  });

  document.getElementById("goalSaveBtn")?.addEventListener("click", () => {
    const t = parseTimeStr(document.getElementById("goalInput")?.value);
    if (!t || t < 60 || t > 400) { alert("Enter a valid goal time, e.g. 1:55.0"); return; }
    saveGoal({ goalTime: t, setAt: Date.now() });
    renderDashboard();
  });

  document.getElementById("logAddBtn")?.addEventListener("click", () => {
    const t = parseTimeStr(document.getElementById("logTime")?.value);
    if (!t || t < 60 || t > 400) { alert("Enter a valid finish time, e.g. 1:58.4"); return; }
    const { raceLog: log } = loadStorage();
    const dateStr = document.getElementById("logDate")?.value;
    log.push({
      date  : localDateToTs(dateStr),
      time  : t,
      venue : document.getElementById("logVenue")?.value?.trim() || "",
    });
    saveRaceLog(log);
    renderDashboard();
  });

  document.querySelectorAll(".log-anchor-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const { raceLog: log, profile: p } = loadStorage();
      const entry = log[parseInt(btn.dataset.idx, 10)];
      if (!entry) return;
      const next = Object.assign({}, p || {}, { t800: entry.time, savedAt: Date.now() });
      try { localStorage.setItem("athleteProfile", JSON.stringify(next)); localStorage.removeItem("formDraft"); } catch (_) {}
      renderDashboard();   // refresh chips + row state
      const note = document.getElementById("anchorNote");
      if (note) note.innerHTML = `<strong>${fmtTime(entry.time)}</strong> is now your Previous 800m anchor. <a href="index.html">Re-run the predictor ↗</a>`;
    });
  });

  document.getElementById("exportBtn")?.addEventListener("click", () => {
    const data = { exportedAt: new Date().toISOString(), version: 1, ...loadStorage() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `800m-data-${localDateInputValue()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById("importFile")?.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    const status = document.getElementById("dataStatus");
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ok = data && typeof data === "object" && (Array.isArray(data.history) || Array.isArray(data.raceLog) || data.profile);
      if (!ok) throw new Error("not an export file");
      if (data.profile)               localStorage.setItem("athleteProfile",    JSON.stringify(data.profile));
      if (Array.isArray(data.history)) localStorage.setItem("predictionHistory", JSON.stringify(data.history.slice(-50)));
      if (Array.isArray(data.raceLog)) localStorage.setItem("raceLog",           JSON.stringify(data.raceLog));
      if (data.goal)                   localStorage.setItem("athleteGoal",       JSON.stringify(data.goal));
      renderDashboard();
      const s2 = document.getElementById("dataStatus");
      if (s2) s2.textContent = `Imported ${file.name}.`;
    } catch (err) {
      if (status) { status.textContent = "Couldn't import that file — it doesn't look like an export from this app."; status.style.color = "var(--danger)"; }
    }
  });

  document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
    if (!confirm("Clear all saved prediction estimates? Race log and profile are kept.")) return;
    localStorage.removeItem("predictionHistory");
    renderDashboard();
  });
  document.getElementById("resetAllBtn")?.addEventListener("click", () => {
    if (!confirm("Delete ALL saved data (profile, estimates, race log, goal)? This cannot be undone.")) return;
    ["athleteProfile", "predictionHistory", "raceLog", "athleteGoal", "formDraft"].forEach(k => localStorage.removeItem(k));
    renderDashboard();
  });

  document.querySelectorAll(".log-del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const { raceLog: log } = loadStorage();
      log.splice(parseInt(btn.dataset.idx, 10), 1);
      saveRaceLog(log);
      renderDashboard();
    });
  });
}

document.addEventListener("DOMContentLoaded", renderDashboard);
