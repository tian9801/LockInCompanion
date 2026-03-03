// dashboard.js
const DEFAULTS = {
  events: []
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function msToPretty(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${r}m`;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function inRange(ts, start, end) {
  return ts >= start && ts <= end;
}

function hourOf(ts) {
  return new Date(ts).getHours(); // 0..23
}

async function getEvents() {
  const st = await chrome.storage.local.get(DEFAULTS);
  return Array.isArray(st.events) ? st.events : [];
}

function compute(events, now = Date.now()) {
  const dayStart = startOfDay(now);
  const weekStart = dayStart - 6 * 24 * 60 * 60 * 1000; // last 7 days inc today

  const weekEvents = events.filter(e => typeof e?.ts === "number" && inRange(e.ts, weekStart, now));
  const todayEvents = events.filter(e => typeof e?.ts === "number" && inRange(e.ts, dayStart, now));

  const startsWeek = weekEvents.filter(e => e.type === "session_start");
  const endsWeek = weekEvents.filter(e => e.type === "session_end");
  const endsWeekCompleted = endsWeek.filter(e => e.completed);

  // focus time: sum completed session durations if present; else approximate
  let focusWeekMs = 0;
  for (const e of endsWeek) {
    if (typeof e.durationMs === "number") focusWeekMs += Math.max(0, e.durationMs);
  }

  let focusTodayMs = 0;
  for (const e of endsWeek) {
    if (typeof e.durationMs === "number" && inRange(e.ts, dayStart, now)) {
      focusTodayMs += Math.max(0, e.durationMs);
    }
  }

  // blocked attempts: only those tied to a sessionId (during focus)
  const blockedWeek = weekEvents.filter(e => e.type === "blocked_attempt" && e.sessionId);
  const blockedToday = todayEvents.filter(e => e.type === "blocked_attempt" && e.sessionId);

  // top domains
  const domainCounts = new Map();
  for (const b of blockedWeek) {
    const d = String(b.domain || "unknown");
    domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  }
  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // hourly histogram
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const b of blockedWeek) {
    hourCounts[hourOf(b.ts)] += 1;
  }

  const maxHour = Math.max(...hourCounts, 1);

  // most/least distracted hour:
  // - "most" = max count
  // - "least" = min count among hours that actually occurred in week window (we’ll just use min overall)
  let mostIdx = 0;
  for (let i = 1; i < 24; i++) if (hourCounts[i] > hourCounts[mostIdx]) mostIdx = i;

  let leastIdx = 0;
  for (let i = 1; i < 24; i++) if (hourCounts[i] < hourCounts[leastIdx]) leastIdx = i;

  const completionRate = startsWeek.length === 0 ? null : (endsWeekCompleted.length / startsWeek.length);

  return {
    focusTodayMs,
    focusWeekMs,
    startsWeek: startsWeek.length,
    completedWeek: endsWeekCompleted.length,
    completionRate,
    blockedWeek: blockedWeek.length,
    blockedToday: blockedToday.length,
    topDomains,
    hourCounts,
    maxHour,
    mostIdx,
    leastIdx
  };
}

function hourLabel(h) {
  // 0 => 12am, 13 => 1pm
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

async function render() {
  const now = Date.now();
  document.getElementById("nowPill").textContent = `Updated: ${new Date(now).toLocaleString()}`;

  const events = await getEvents();
  const m = compute(events, now);

  document.getElementById("focusToday").textContent = msToPretty(m.focusTodayMs);
  document.getElementById("focusTodaySub").textContent = `Based on ended sessions today`;

  document.getElementById("focusWeek").textContent = msToPretty(m.focusWeekMs);
  document.getElementById("sessionsWeekSub").textContent =
    `${m.completedWeek}/${m.startsWeek} sessions completed`;

  document.getElementById("completionRate").textContent =
    m.completionRate == null ? "—" : `${Math.round(m.completionRate * 100)}%`;
  document.getElementById("completionSub").textContent =
    `Completion = completed / started (last 7 days)`;

  document.getElementById("blockedWeek").textContent = String(m.blockedWeek);
  document.getElementById("blockedTodaySub").textContent =
    `Today: ${m.blockedToday}`;

  document.getElementById("mostHour").textContent =
    `${hourLabel(m.mostIdx)} (most)`;
  document.getElementById("leastHour").textContent =
    `Least distracted: ${hourLabel(m.leastIdx)}`;

  const top = document.getElementById("topDomains");
  top.innerHTML = "";
  if (m.topDomains.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No blocked attempts logged yet.";
    top.appendChild(li);
  } else {
    for (const [d, c] of m.topDomains) {
      const li = document.createElement("li");
      li.textContent = `${d} — ${c}`;
      top.appendChild(li);
    }
  }

  const hist = document.getElementById("hist");
  hist.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const heightPct = Math.round((m.hourCounts[h] / m.maxHour) * 100);
    bar.style.height = `${Math.max(3, heightPct)}%`;
    bar.setAttribute("data-tip", `${hourLabel(h)}: ${m.hourCounts[h]} blocked attempt(s)`);
    hist.appendChild(bar);
  }
}

document.getElementById("clearAnalytics").onclick = async () => {
  await chrome.storage.local.set({ events: [] });
  render();
};

render();
setInterval(render, 10_000);