/* =============================================================
   pace.js — Running Pace Calculator (pace.html)

   Pure arithmetic: finish time = pace × distance. The table shows the
   chosen pace in the centre column with two faster and two slower
   columns either side (±30 s per unit).
   ============================================================= */

"use strict";

/* ── Distances (metres) ─────────────────────────────────── */
const MI = 1609.344;
const DISTANCES = [
  // Track
  { label: "400m",          m: 400,        group: "track", key: true  },
  { label: "800m",          m: 800,        group: "track", key: true  },
  { label: "1500m",         m: 1500,       group: "track" },
  { label: "1600m",         m: 1600,       group: "track", key: true  },
  { label: "3000m",         m: 3000,       group: "track" },
  { label: "3200m",         m: 3200,       group: "track", key: true  },
  { label: "5000m",         m: 5000,       group: "track" },
  // Road
  { label: "1 mi",          m: MI,         group: "road", key: true  },
  { label: "2 mi",          m: 2 * MI,     group: "road" },
  { label: "3 mi",          m: 3 * MI,     group: "road" },
  { label: "5K",            m: 5000,       group: "road", key: true  },
  { label: "4 mi",          m: 4 * MI,     group: "road" },
  { label: "5 mi",          m: 5 * MI,     group: "road" },
  { label: "6 mi",          m: 6 * MI,     group: "road" },
  { label: "10K",           m: 10000,      group: "road", key: true  },
  { label: "7 mi",          m: 7 * MI,     group: "road" },
  { label: "8 mi",          m: 8 * MI,     group: "road" },
  { label: "9 mi",          m: 9 * MI,     group: "road" },
  { label: "10 mi",         m: 10 * MI,    group: "road", key: true  },
  { label: "11 mi",         m: 11 * MI,    group: "road" },
  { label: "12 mi",         m: 12 * MI,    group: "road" },
  { label: "13 mi",         m: 13 * MI,    group: "road" },
  { label: "½ Marathon",    m: 21097.5,    group: "road", key: true  },
  { label: "14 mi",         m: 14 * MI,    group: "road" },
  { label: "15 mi",         m: 15 * MI,    group: "road" },
  { label: "16 mi",         m: 16 * MI,    group: "road" },
  { label: "17 mi",         m: 17 * MI,    group: "road" },
  { label: "18 mi",         m: 18 * MI,    group: "road" },
  { label: "19 mi",         m: 19 * MI,    group: "road" },
  { label: "20 mi",         m: 20 * MI,    group: "road" },
  { label: "21 mi",         m: 21 * MI,    group: "road" },
  { label: "22 mi",         m: 22 * MI,    group: "road" },
  { label: "23 mi",         m: 23 * MI,    group: "road" },
  { label: "24 mi",         m: 24 * MI,    group: "road" },
  { label: "25 mi",         m: 25 * MI,    group: "road" },
  { label: "26 mi",         m: 26 * MI,    group: "road" },
  { label: "Marathon",      m: 42195,      group: "road", key: true  },
  { label: "50K",           m: 50000,      group: "road", key: true  },
];

/* Pace unit → metres covered per pace interval, and sensible select ranges */
const UNITS = {
  mi:  { metres: MI,   label: "/mi",   minMin: 3, maxMin: 20, defMin: 8, defSec: 0  },
  km:  { metres: 1000, label: "/km",   minMin: 2, maxMin: 13, defMin: 5, defSec: 0  },
  400: { metres: 400,  label: "/400m", minMin: 0, maxMin: 5,  defMin: 1, defSec: 30 },
};
const STEP_SEC = 30;   // column spacing

/* ── Formatting ─────────────────────────────────────────── */
function fmtClock(totalSec) {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtPace(sec, unit) {
  const r = Math.round(sec);                 // round the total first (avoids "1:60")
  const m = Math.floor(r / 60), s = r % 60;
  return `${m}:${String(s).padStart(2, "0")}${UNITS[unit].label}`;
}

/* ── DOM ────────────────────────────────────────────────── */
const minSel  = document.getElementById("paceMin");
const secSel  = document.getElementById("paceSec");
const headRow = document.getElementById("paceHead");
const body    = document.getElementById("paceBody");
const summary = document.getElementById("paceSummary");
const form    = document.getElementById("paceForm");

function currentUnit() {
  return document.querySelector('input[name="unit"]:checked')?.value ?? "mi";
}

/* Set the two selects from a pace in seconds, snapping to the 5 s step
   and clamping to the unit's range. Rounds the TOTAL first so 119.3 s
   becomes 2:00, not "1 min + 60 s". */
function setPace(unit, paceS) {
  const u = UNITS[unit];
  const snapped = Math.round(paceS / 5) * 5;
  const clamped = Math.min(u.maxMin * 60 + 55, Math.max(u.minMin * 60, snapped));
  minSel.value = Math.floor(clamped / 60);
  secSel.value = clamped % 60;
}

function fillSelects(unit, keepSec) {
  const u = UNITS[unit];
  const prevSec = keepSec ? Number(secSel.value) : u.defSec;
  minSel.innerHTML = "";
  for (let m = u.minMin; m <= u.maxMin; m++) {
    const o = document.createElement("option");
    o.value = m; o.textContent = `${m} min`;
    minSel.appendChild(o);
  }
  minSel.value = u.defMin;
  secSel.innerHTML = "";
  for (let s = 0; s < 60; s += 5) {
    const o = document.createElement("option");
    o.value = s; o.textContent = `${s} sec`;
    secSel.appendChild(o);
  }
  secSel.value = Math.round(prevSec / 5) * 5 % 60;
}

/* ── Render ─────────────────────────────────────────────── */
function render() {
  const unit   = currentUnit();
  const u      = UNITS[unit];
  const paceS  = Number(minSel.value) * 60 + Number(secSel.value);
  if (paceS <= 0) {
    body.innerHTML = `<tr><td colspan="6" class="pace-empty">Pick a pace above.</td></tr>`;
    headRow.innerHTML = ""; summary.textContent = "";
    return;
  }

  // Five columns: −60, −30, 0, +30, +60 s; never below 30 s per unit.
  const offsets = [-2, -1, 0, 1, 2].map(k => k * STEP_SEC);
  const cols    = offsets.map(o => Math.max(30, paceS + o));

  headRow.innerHTML = `<th>Distance</th>` + cols.map((p, i) =>
    `<th class="num${i === 2 ? " is-selected" : ""}">${fmtPace(p, unit)}</th>`).join("");

  let lastGroup = null;
  const rows = [];
  DISTANCES.forEach(d => {
    if (d.group !== lastGroup) {
      rows.push(`<tr class="pace-group"><td colspan="6">${d.group === "track" ? "Track" : "Road"}</td></tr>`);
      lastGroup = d.group;
    }
    const cells = cols.map((p, i) => {
      const t = d.m / u.metres * p;
      return `<td class="num${i === 2 ? " is-selected" : ""}">${fmtClock(t)}</td>`;
    }).join("");
    rows.push(`<tr class="${d.key ? "is-key" : ""}"><td>${d.label}</td>${cells}</tr>`);
  });
  body.innerHTML = rows.join("");

  const per400 = 400 / u.metres * paceS;
  const perKm  = 1000 / u.metres * paceS;
  const perMi  = MI / u.metres * paceS;
  summary.textContent =
    `${fmtPace(paceS, unit)} = ${fmtPace(per400, 400)} · ${fmtPace(perKm, "km")} · ${fmtPace(perMi, "mi")}`;

  try { localStorage.setItem("paceCalc", JSON.stringify({ unit, paceS })); } catch (_) {}
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("paceCalc")); } catch (_) {}
  const unit = saved?.unit && UNITS[saved.unit] ? saved.unit : "mi";
  document.querySelector(`input[name="unit"][value="${unit}"]`).checked = true;
  fillSelects(unit, false);
  if (saved?.paceS) setPace(unit, saved.paceS);
  render();

  minSel.addEventListener("change", render);
  secSel.addEventListener("change", render);
  document.querySelectorAll('input[name="unit"]').forEach(r => r.addEventListener("change", () => {
    // Convert the current pace into the new unit so the table doesn't jump.
    const fromUnit = minSel.dataset.unit || "mi";
    const paceS    = Number(minSel.value) * 60 + Number(secSel.value);
    const toUnit   = r.value;
    fillSelects(toUnit, false);
    setPace(toUnit, paceS / UNITS[fromUnit].metres * UNITS[toUnit].metres);
    minSel.dataset.unit = toUnit;
    render();
  }));
  minSel.dataset.unit = unit;

  form.addEventListener("submit", e => { e.preventDefault(); render(); });
  document.getElementById("printPace")?.addEventListener("click", () => window.print());
});
