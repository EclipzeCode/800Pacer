/* training.html — page logic. Requires models.js. */
"use strict";


/* -- Helpers --------------------------------------------- */
function fmtPer400(sec) {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return m + ":" + s;
}
function fmtPerKm(sec) {
  if (!sec || sec <= 0) return "—";
  const perKm = sec * (1000 / 400);
  const m = Math.floor(perKm / 60);
  const s = (perKm % 60).toFixed(0).padStart(2, "0");
  return m + ":" + s + "/km";
}
function fmtTime(sec) {
  if (!sec || isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return m + ":" + s;
}

/* -- VDOT Training Zones --------------------------------- */
const ZONE_DISTS = {
  R: 1609,
  I: 3200,
  T: 10000,
  M: 21097,
  E: 40000,
};

const ZONE_META = [
  { key: "R", name: "Rep (Speed)",        color: "#e85d20", purpose: "Neuromuscular speed, short fast reps",              factor: 1/4.025   },
  { key: "I", name: "Interval (VO₂max)", color: "#c9820a", purpose: "VO₂max development, 3–5 min reps",    factor: 1/8       },
  { key: "T", name: "Threshold / Tempo",  color: "#3a6fcf", purpose: "Lactate threshold, 20–40 min continuous or reps", factor: 1/25   },
  { key: "M", name: "Marathon",           color: "#6a3fcf", purpose: "Aerobic power base, longer tempo runs",             factor: 1/52.7425 },
  // Easy is NOT a race-equivalent pace: Daniels defines it as ~59–74 % of
  // VDOT. We use the midpoint (~66 %) and solve the running-economy curve
  // directly rather than predicting a fictional 40 km race.
  { key: "E", name: "Easy",               color: "#2d8a4e", purpose: "Recovery and aerobic base building (~66 % VDOT)",   pctVdot: 0.66 },
];

/* Invert Daniels' oxygen-cost curve: VO₂ = -4.60 + 0.182258·v + 0.000104·v²
   (v in m/min) → velocity for a given VO₂ demand. */
function velocityAtVo2(vo2) {
  const a = 0.000104, b = 0.182258, c = -(4.60 + vo2);
  const disc = b * b - 4 * a * c;
  return disc > 0 ? (-b + Math.sqrt(disc)) / (2 * a) : null;
}

function computeZones(vdot) {
  const zones = {};
  for (const z of ZONE_META) {
    if (z.pctVdot) {
      const v = velocityAtVo2(vdot * z.pctVdot);          // m/min
      zones[z.key] = v ? 400 / v * 60 : null;              // s per 400m
    } else {
      const raceSec = predictFromVdot(ZONE_DISTS[z.key], vdot);
      zones[z.key] = raceSec ? raceSec * z.factor : null;
    }
  }
  return zones;
}

function renderZones(vdot, zones, t1600) {
  const vdotDisplay = vdot ? vdot.toFixed(1) : "—";
  const heroVdot    = document.getElementById("heroVdot");
  const heroVdotSub = document.getElementById("heroVdotSub");
  if (heroVdot) heroVdot.textContent = vdotDisplay;
  if (heroVdotSub && t1600) {
    heroVdotSub.textContent = "Based on 1600m PR of " + fmtTime(t1600);
  }

  const rows = ZONE_META.map(function(z) {
    const pace = zones[z.key];
    return "<tr>" +
      "<td>" +
        "<span class='zone-dot' style='background:" + z.color + "'></span>" +
        "<span class='zone-name'>" + z.name + "</span>" +
      "</td>" +
      "<td>" +
        "<div class='zone-pace'>" + (pace ? fmtPer400(pace) : "—") + " / 400m</div>" +
        "<div class='zone-sub'>" + (pace ? fmtPerKm(pace) : "") + "</div>" +
      "</td>" +
      "<td style='font-size:0.74rem;color:var(--text-secondary)'>" + z.purpose + "</td>" +
      "</tr>";
  }).join("");

  return "<table class='zone-table'>" +
    "<thead><tr><th>Zone</th><th>Target Pace</th><th>Purpose</th></tr></thead>" +
    "<tbody>" + rows + "</tbody>" +
    "</table>" +
    "<p style='font-size:0.72rem;color:var(--text-secondary);margin-top:8px'>" +
    "R, I, T and M paces are derived from Jack Daniels' VDOT model at equivalent race distances; Easy pace is ~66 % of VDOT. " +
    "Paces are per 400m on a standard outdoor track." +
    "</p>";
}

/* -- Workout Generator ----------------------------------- */
const WORKOUT_DB = {
  speed: [
    { name: "Speed Reps",      sets: "10 \xD7 200m",    zoneKey: "R", rest: "2:30 walk/jog", why: "Build maximal sprint speed and neuromuscular power — the raw ingredient of 800m kick." },
    { name: "Speed-Endurance", sets: "6 \xD7 400m",     zoneKey: "R", rest: "3:00 walk",     why: "Bridge the gap between pure speed and 800m race pace. Highly specific for sprinter types." },
    { name: "Lactate Repeats", sets: "3 \xD7 3 \xD7 300m", zoneKey: "I", rest: "45s / 3:30", why: "Accumulates lactate then flushes it — trains your body to handle pace changes mid-race." },
    { name: "VO₂max Intervals", sets: "8 \xD7 400m", zoneKey: "I", rest: "60s",         why: "Develops aerobic ceiling — the limiting factor for speed-dominant 800m runners." },
    { name: "Threshold Run",   sets: "20 min",          zoneKey: "T", rest: "continuous",    why: "Aerobic base work to support race demands beyond the 400m sprint duration." },
    { name: "Race Pace 600s",  sets: "5 \xD7 600m",     zoneKey: "I", rest: "2:30",          why: "Race-specific conditioning at 800m goal pace, longer than race reps." },
  ],
  balanced: [
    { name: "VO₂max 400s",    sets: "8 \xD7 400m",  zoneKey: "I", rest: "60s",           why: "Classic 800m interval session — develops the aerobic power central to specialist performance." },
    { name: "Race-Pace 600s",  sets: "5 \xD7 600m",     zoneKey: "I", rest: "2:00",           why: "Extends race-specific conditioning beyond the 400m, building lactate tolerance needed mid-race." },
    { name: "Threshold 800s",  sets: "4 \xD7 800m",     zoneKey: "T", rest: "60s",            why: "Tempo-effort 800s raise lactate threshold — the ceiling of sustainable pace." },
    { name: "Speed Sharpener", sets: "8 \xD7 200m",     zoneKey: "R", rest: "2:00 walk",      why: "Maintains top-end speed for a strong kick at the bell." },
    { name: "Threshold Run",   sets: "25 min",          zoneKey: "T", rest: "continuous",     why: "Aerobic volume at threshold keeps your base strong through the competitive season." },
    { name: "Race-Sim 1000s",  sets: "4 \xD7 1000m",    zoneKey: "I", rest: "3:00",           why: "Simulates the second half of the 800m; builds mental and physical toughness." },
  ],
  endurance: [
    { name: "Threshold Cruise",  sets: "4 \xD7 1200m", zoneKey: "T", rest: "60s",            why: "High-volume threshold work builds the aerobic engine — essential for miler-type 800m runners." },
    { name: "VO₂max 1000s",   sets: "4 \xD7 1000m", zoneKey: "I", rest: "3:00",         why: "Drives VO₂max higher, which lifts the ceiling on your 800m potential." },
    { name: "Speed Development", sets: "10 \xD7 300m", zoneKey: "R", rest: "2:30 walk",      why: "Counteracts the natural speed deficit of endurance athletes at shorter 800m intensities." },
    { name: "Race-Pace 600s",    sets: "5 \xD7 600m",  zoneKey: "I", rest: "2:30",           why: "Develops the ability to sustain 800m goal pace for extended periods." },
    { name: "Easy Long Run",     sets: "35–45 min", zoneKey: "E", rest: "continuous",   why: "Aerobic base volume — gives endurance athletes an edge in the second lap of the 800m." },
    { name: "Tempo 2-miler",     sets: "1 \xD7 3200m", zoneKey: "T", rest: "continuous",     why: "Continuous threshold effort builds mental toughness and steady-state aerobic power." },
  ],
};

function renderWorkouts(profile, zones) {
  const workouts = WORKOUT_DB[profile] || WORKOUT_DB.balanced;
  const tiles = workouts.map(function(w) {
    const zmeta = ZONE_META.find(function(z) { return z.key === w.zoneKey; });
    const pace  = zones && zones[w.zoneKey] ? fmtPer400(zones[w.zoneKey]) + " / 400m" : "—";
    return "<div class='workout-tile'>" +
      "<span class='wk-zone-badge' style='background:" + zmeta.color + "22;color:" + zmeta.color + ";border:1px solid " + zmeta.color + "44'>" + zmeta.name + "</span>" +
      "<div class='wk-name'>" + w.name + "</div>" +
      "<div class='wk-reps'>" + w.sets + "</div>" +
      "<div class='wk-pace'>Target: " + pace + "</div>" +
      "<div class='wk-rest'>Recovery: " + w.rest + "</div>" +
      "<div class='wk-why'>" + w.why + "</div>" +
      "</div>";
  }).join("");

  const profileLabels = { speed: "Speed / Sprinter", balanced: "800m Specialist", endurance: "Miler / Endurance" };
  return "<p style='font-size:0.84rem;color:var(--text-secondary);margin-bottom:10px'>" +
    "Profile: <strong>" + profileLabels[profile] + "</strong> — showing sessions most relevant to your physiology." +
    "</p>" +
    "<div class='workout-grid'>" + tiles + "</div>" +
    "<p style='font-size:0.74rem;color:var(--text-secondary);margin-top:12px'>" +
    "Paces from your VDOT zones. Aim to complete 1–2 of these sessions per week during your build phase. " +
    "Always book-end quality sessions with easy-day recovery." +
    "</p>";
}

/* -- Race Pace Calculator -------------------------------- */
function renderPaceTable(goalSec, profile) {
  if (!goalSec) return "";
  profile = profile || "balanced";

  const strategies = ["even", "negative", "frontLoaded", "sitAndKick"];
  const labels     = { even: "Even", negative: "Negative", frontLoaded: "Front Loaded", sitAndKick: "Sit & Kick" };

  const allSplits = {};
  const avgSplit  = goalSec / 8;
  strategies.forEach(function(s) {
    const mults = getStrategyMultipliers(s, profile);
    const total = mults.reduce(function(a, b) { return a + b; }, 0);
    allSplits[s] = mults.map(function(m) { return m * (goalSec / total); });
  });

  let html = "<div style='overflow-x:auto'><table class='pace-table'><thead><tr><th>100m</th>" +
    strategies.map(function(s) { return "<th>" + labels[s] + "</th>"; }).join("") +
    "</tr></thead><tbody>";

  for (let i = 0; i < 8; i++) {
    const dist = (i + 1) * 100;
    const lap  = i < 4 ? "Lap 1" : "Lap 2";
    const cells = strategies.map(function(s) {
      const sec = allSplits[s][i];
      const cls = sec < avgSplit - 0.3 ? "pace-fast" : sec > avgSplit + 0.3 ? "pace-slow" : "";
      return "<td class='" + cls + "'>" + sec.toFixed(2) + "s</td>";
    }).join("");
    const lapBorder = i === 3 ? " style='border-top:2px solid rgba(0,0,0,0.12)'" : "";
    html += "<tr" + lapBorder + "><td>" + dist + "m <span style='opacity:0.5;font-size:0.7rem'>(" + lap + ")</span></td>" + cells + "</tr>";
  }

  const lap1 = strategies.map(function(s) { return { s: s, t: allSplits[s].slice(0,4).reduce(function(a,b){return a+b;},0) }; });
  const lap2 = strategies.map(function(s) { return { s: s, t: allSplits[s].slice(4,8).reduce(function(a,b){return a+b;},0) }; });
  html += "<tr style='border-top:2px solid var(--line);font-weight:700'><td>Lap 1</td>" +
    lap1.map(function(r) { return "<td>" + fmtTime(r.t) + "</td>"; }).join("") + "</tr>";
  html += "<tr style='font-weight:700'><td>Lap 2</td>" +
    lap2.map(function(r) { return "<td>" + fmtTime(r.t) + "</td>"; }).join("") + "</tr>";
  html += "<tr style='font-weight:700;font-size:0.9rem'><td>Finish</td>" +
    strategies.map(function() { return "<td>" + fmtTime(goalSec) + "</td>"; }).join("") + "</tr>";

  html += "</tbody></table></div>" +
    "<p style='font-size:0.72rem;color:var(--text-secondary);margin-top:6px'>" +
    "<span style='background:rgba(45,138,78,0.1);padding:1px 5px;border-radius:3px'>Green</span> = faster than average 100m split. " +
    "<span style='background:rgba(232,93,32,0.08);padding:1px 5px;border-radius:3px;margin-left:4px'>Orange</span> = slower." +
    "</p>";
  return html;
}

/* -- Speed Profile Analysis ------------------------------ */
function renderSpeedProfile(t400, t1600, profile, sex) {
  const srr    = (400 / t400) / (1600 / t1600);
  const riegel = modelRiegel(t400, profile, sex);
  const vdotP  = modelVdot(t1600);

  const srrPct = Math.max(0, Math.min(100, (srr - 1.30) / 0.40 * 100));
  const gap    = vdotP ? (riegel - vdotP) : null;
  const gapAbs = gap !== null ? Math.abs(gap).toFixed(2) : null;

  let verdict, recs;
  if (!vdotP) {
    verdict = "Enter your 1600m PR for a full speed-aerobic analysis.";
    recs    = [];
  } else if (gap > 3.0) {
    verdict = "Your speed model (Riegel) predicts " + gapAbs + "s faster than your aerobic model (VDOT). You have excellent raw speed but your aerobic ceiling is limiting your 800m.";
    recs = [
      "Run 1–2 threshold/tempo sessions per week (T-pace) to raise your aerobic ceiling.",
      "Add a weekly easy long run of 30–40 min to build aerobic base.",
      "Reduce pure sprint work temporarily — it's already your strength.",
    ];
  } else if (gap < -3.0) {
    verdict = "Your aerobic model (VDOT) predicts " + gapAbs + "s faster than your speed model (Riegel). You have a strong aerobic base but lack the top-end speed needed for a strong 800m kick.";
    recs = [
      "Add 1–2 Rep-pace sessions per week (200m–400m at R-pace) to develop neuromuscular speed.",
      "Include short hill sprints (8–10 \xD7 10s) once a week to improve stride power.",
      "Work on the last 200m: practice kicking from rep pace in training.",
    ];
  } else {
    verdict = "Your speed and aerobic models are closely matched (" + (gapAbs || "—") + "s difference). You're a well-balanced 800m athlete — focus on race-specific conditioning rather than patching a single weakness.";
    recs = [
      "Emphasise race-specific 600m–800m reps at Interval pace to sharpen event fitness.",
      "One session per week at Rep pace (200m–400m) to maintain your kick.",
      "A weekly threshold run keeps your aerobic base solid without overloading.",
    ];
  }

  const recItems = recs.map(function(r) { return "<li>" + r + "</li>"; }).join("");
  return "<div class='spectrum-wrap'>" +
    "<div class='spectrum-label-row'>" +
      "<span>Speed-dominant</span>" +
      "<span>SRR: " + srr.toFixed(3) + "</span>" +
      "<span>Aerobic-dominant</span>" +
    "</div>" +
    "<div class='spectrum-track'>" +
      "<div class='spectrum-dot' style='left:" + (100 - srrPct).toFixed(1) + "%'></div>" +
    "</div>" +
    "</div>" +
    "<p style='font-size:0.84rem;color:var(--text);margin-top:10px'>" + verdict + "</p>" +
    (recs.length ? "<ul class='rec-list'>" + recItems + "</ul>" : "") +
    "<p style='font-size:0.72rem;color:var(--text-secondary);margin-top:10px'>" +
    "Based on comparison of Riegel (speed-derived) vs. VDOT (aerobic-derived) 800m predictions. " +
    "Spectrum position reflects your Speed Reserve Ratio (SRR = MSS \xF7 MAS)." +
    "</p>";
}

/* -- Time-to-Goal Planner -------------------------------- */
function renderPlanner(goalSec, raceDateStr, currentSec) {
  if (!goalSec || !raceDateStr || !currentSec) {
    return "<p style='color:var(--text-secondary);font-size:0.85rem'>Fill in all three fields above to see your training phase plan.</p>";
  }

  const raceDate  = new Date(raceDateStr + "T12:00:00");
  const today     = new Date();
  const msPerWeek = 7 * 24 * 3600 * 1000;
  const daysOut   = Math.ceil((raceDate - today) / (24 * 3600 * 1000));
  const gapSec    = currentSec - goalSec;

  if (daysOut < 0) {
    return "<p style='color:var(--danger);font-weight:600'>That race date is in the past — pick an upcoming race to plan for.</p>";
  }
  const weeksOut = Math.round(daysOut / 7);

  if (weeksOut === 0) {
    return "<p style='color:var(--accent);font-weight:600'>Race week — focus on staying sharp, sleep, and confidence. Taper is in effect.</p>";
  }

  /* Split `total` weeks across `shares` proportionally, guaranteeing every
     phase gets ≥ 1 week and the parts sum exactly to `total`
     (largest-remainder method). */
  function partitionWeeks(total, shares) {
    const n = shares.length;
    if (total <= n) {
      // Not enough weeks for every phase — drop the earliest ones.
      return shares.map(function(_, i) { return i < n - total ? 0 : 1; });
    }
    const exact = shares.map(function(s) { return total * s; });
    const floor = exact.map(function(v) { return Math.max(1, Math.floor(v)); });
    let remaining = total - floor.reduce(function(a, b) { return a + b; }, 0);
    // A phase already lifted to the 1-week floor has "borrowed" a week, so its
    // remainder is negative and it won't also win a leftover week.
    const order = exact.map(function(v, i) { return { i: i, frac: v - floor[i] }; })
                       .sort(function(a, b) { return b.frac - a.frac; });
    for (let k = 0; remaining > 0; k = (k + 1) % n, remaining--) floor[order[k].i]++;
    return floor;
  }

  let names, colors, shares;
  if (weeksOut <= 4) {
    names = ["Peak / Race Prep", "Taper"];           colors = ["#e85d20", "#c9820a"];
    shares = [0.7, 0.3];
  } else if (weeksOut <= 8) {
    names = ["Build", "Peak", "Taper"];               colors = ["#3a6fcf", "#e85d20", "#c9820a"];
    shares = [0.55, 0.30, 0.15];
  } else if (weeksOut <= 16) {
    names = ["Base", "Build", "Peak", "Taper"];       colors = ["#2d8a4e", "#3a6fcf", "#e85d20", "#c9820a"];
    shares = [0.35, 0.40, 0.15, 0.10];
  } else {
    names = ["Foundation", "Build", "Peak", "Taper"]; colors = ["#2d8a4e", "#3a6fcf", "#e85d20", "#c9820a"];
    shares = [0.40, 0.35, 0.15, 0.10];
  }
  const weeks  = partitionWeeks(weeksOut, shares);
  const phases = names.map(function(name, i) {
    return { name: name, weeks: weeks[i], color: colors[i] };
  }).filter(function(p) { return p.weeks > 0; });
  phases[0].current = true;

  const phaseRows = phases.map(function(p) {
    return "<div class='phase-row" + (p.current ? " phase-current" : "") + "'>" +
      "<span class='phase-badge' style='background:" + p.color + "22;color:" + p.color + ";border:1px solid " + p.color + "44'>" + p.name + "</span>" +
      "<span class='phase-weeks'>" + p.weeks + " week" + (p.weeks !== 1 ? "s" : "") + "</span>" +
      (p.current ? "<span style='font-size:0.72rem;color:var(--accent);margin-left:auto'>← You are here</span>" : "") +
      "</div>";
  }).join("");

  const gapStr = gapSec > 0
    ? gapSec.toFixed(2) + "s to close (" + (gapSec / weeksOut).toFixed(2) + "s/week needed)"
    : "You're already at your goal — great work!";

  return "<div style='margin-bottom:10px'>" +
    "<p style='font-size:0.84rem;margin:0 0 4px'><strong>" + weeksOut + " week" + (weeksOut !== 1 ? "s" : "") + "</strong> to race day " +
    "(" + raceDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + ").</p>" +
    "<p style='font-size:0.84rem;color:var(--text-secondary);margin:0'>Gap: " + gapStr + "</p>" +
    "</div>" +
    phaseRows +
    "<p style='font-size:0.72rem;color:var(--text-secondary);margin-top:10px'>" +
    "Phase breakdown is a general guideline. Adjust based on your current training load, injury history, and coach guidance." +
    "</p>";
}

/* -- Pre-fill from localStorage -------------------------- */
function prefillFromStorage() {
  try {
    const p = JSON.parse(localStorage.getItem("athleteProfile"));
    if (!p) return;
    if (p.t400  && document.getElementById("tr400"))
      document.getElementById("tr400").value  = formatInput(p.t400);
    if (p.t1600 && document.getElementById("tr1600"))
      document.getElementById("tr1600").value = formatInput(p.t1600);
    if (p.profile && document.getElementById("trProfile"))
      document.getElementById("trProfile").value = p.profile;
    if (p.sex && document.getElementById("trSex"))
      document.getElementById("trSex").value = p.sex;

    const notice = document.getElementById("savedNotice");
    if (notice) notice.textContent = "PRs loaded from your saved profile — update below if needed.";

    const g = JSON.parse(localStorage.getItem("athleteGoal"));
    if (g && g.goalTime && document.getElementById("planGoal"))
      document.getElementById("planGoal").value = formatTime(g.goalTime);

    const hist = JSON.parse(localStorage.getItem("predictionHistory") || "[]");
    if (hist.length && document.getElementById("planCurrent"))
      document.getElementById("planCurrent").value = formatTime(hist[hist.length - 1].predicted);
  } catch (_) {}
}

/* -- Main generate --------------------------------------- */
function generateTraining(t400, t1600, profile, sex) {
  const vdot  = t1600 ? computeVdot(1600, t1600) : null;
  const zones = vdot  ? computeZones(vdot) : null;

  const zonesEl = document.getElementById("zonesOutput");
  if (zonesEl) {
    zonesEl.innerHTML = vdot
      ? renderZones(vdot, zones, t1600)
      : "<div class='zone-locked'>A 1600m PR is needed to compute training zones.<br><a href='index.html'>Run the predictor</a> to generate your VDOT.</div>";
  }

  const workoutsEl = document.getElementById("workoutsOutput");
  if (workoutsEl) {
    workoutsEl.innerHTML = renderWorkouts(profile, zones);
  }

  const profileEl = document.getElementById("profileOutput");
  if (profileEl) {
    profileEl.innerHTML = (t400 && t1600)
      ? renderSpeedProfile(t400, t1600, profile, sex)
      : "<p style='color:var(--text-secondary);font-size:0.88rem'>Enter both your 400m and 1600m PRs to see your speed-aerobic profile.</p>";
  }
}

/* -- Event binding --------------------------------------- */
document.addEventListener("DOMContentLoaded", function() {
  prefillFromStorage();

  try {
    const p = JSON.parse(localStorage.getItem("athleteProfile"));
    if (p && p.t400) {
      generateTraining(p.t400, p.t1600 || null, p.profile || "balanced", p.sex || "male");
    }
  } catch (_) {}

  const trainForm = document.getElementById("trainForm");
  const notice    = document.getElementById("savedNotice");
  if (trainForm) {
    trainForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const r400  = validateTimeInput(document.getElementById("tr400").value,  "t400");
      const r1600 = validateTimeInput(document.getElementById("tr1600").value, "t1600");
      const prof  = document.getElementById("trProfile").value;
      const sex   = document.getElementById("trSex").value;
      const err   = r400.error || (!r400.sec ? "A 400m PR is required." : null) || r1600.error;
      if (err) {
        if (notice) { notice.textContent = err; notice.style.color = "var(--danger)"; }
        return;
      }
      if (notice) {
        notice.style.color = "";
        notice.textContent = r1600.warn ? "1600m " + r1600.warn : "";
      }
      generateTraining(r400.sec, r1600.sec, prof, sex);
    });
  }

  const paceCalcBtn = document.getElementById("paceCalcBtn");
  const paceOutput  = document.getElementById("paceOutput");
  if (paceCalcBtn && paceOutput) {
    paceCalcBtn.addEventListener("click", function() {
      const goalSec = parseTime(document.getElementById("paceGoalInput").value);
      if (!goalSec || goalSec < 60 || goalSec > 400) {
        alert("Enter a valid 800m goal time (1:00–6:40).");
        return;
      }
      paceOutput.innerHTML = renderPaceTable(goalSec, document.getElementById("trProfile").value);
    });
  }

  const printBtn = document.getElementById("printBtn");
  if (printBtn) printBtn.addEventListener("click", function() { window.print(); });

  const planBtn    = document.getElementById("planBtn");
  const planOutput = document.getElementById("planOutput");
  if (planBtn && planOutput) {
    planBtn.addEventListener("click", function() {
      const goalSec = parseTime(document.getElementById("planGoal").value);
      const dateStr = document.getElementById("planDate").value;
      const curSec  = parseTime(document.getElementById("planCurrent").value);
      planOutput.innerHTML = renderPlanner(goalSec, dateStr, curSec);
    });
  }
});
