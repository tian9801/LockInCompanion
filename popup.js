// popup.js
const DEFAULTS = {
  sessionActive: false,
  sessionEndsAt: null,
  sessionStartedAt: null,
  sessionId: null,

  allowlist: ["canvas.illinois.edu", "geeksforgeeks.org", "leetcode.com", "docs.google.com"],
  blocklist: ["youtube.com", "reddit.com", "tiktok.com", "twitter.com", "x.com"],
  blockedAttempts: 0,
  plantHealth: 100
};

function cleanDomain(s) {
  try {
    if (!s) return "";
    const str = String(s).trim();
    if (str.startsWith("http://") || str.startsWith("https://")) {
      return new URL(str).hostname.replace(/^www\./, "").toLowerCase();
    }
    return str
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  } catch {
    return "";
  }
}

async function getState() {
  const state = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...state };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

function msToMMSS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

async function enforceNow() {
  chrome.runtime.sendMessage({ type: "ENFORCE_ACTIVE_TAB" });
}

function setTimeBarFill(active, endsAt, minutesInput) {
  const fill = document.getElementById("timeFill");
  if (!active || !endsAt) {
    fill.style.width = "0%";
    return;
  }
  const mins = parseInt(minutesInput?.value || "25", 10);
  const start = endsAt - mins * 60 * 1000;
  const total = Math.max(1, endsAt - start);
  const left = Math.max(0, endsAt - Date.now());
  const done = 1 - left / total;
  fill.style.width = `${Math.min(100, Math.max(0, done * 100))}%`;
}

function setHealthBadge(health) {
  const badge = document.getElementById("healthBadge");
  const h = Math.max(0, Math.min(100, health ?? 100));
  let emoji = "🌱";
  if (h < 70) emoji = "🥀";
  if (h < 35) emoji = "💀";
  badge.textContent = `${emoji} ${h}%`;
}

function makeListItem(domain, onRemove) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.className = "domain";
  span.textContent = domain;

  const btn = document.createElement("button");
  btn.textContent = "remove";
  btn.onclick = onRemove;

  li.appendChild(span);
  li.appendChild(btn);
  return li;
}

async function render() {
  const st = await getState();

  const status = document.getElementById("status");
  const stats = document.getElementById("stats");

  setHealthBadge(st.plantHealth);

  if (!st.sessionActive) {
    status.textContent = "Not in a focus session.";
  } else {
    status.textContent = `Focus active. Time left: ${msToMMSS(st.sessionEndsAt - Date.now())}`;
  }

  stats.textContent = `Blocked attempts (this session): ${st.blockedAttempts ?? 0}`;

  setTimeBarFill(st.sessionActive, st.sessionEndsAt, document.getElementById("minutes"));

  // Allowlist
  const allowUl = document.getElementById("allowList");
  allowUl.innerHTML = "";
  st.allowlist.forEach((d, idx) => {
    allowUl.appendChild(
      makeListItem(d, async () => {
        const next = st.allowlist.filter((_, i) => i !== idx);
        await setState({ allowlist: next });
        await enforceNow();
        render();
      })
    );
  });

  // Blocklist
  const blockUl = document.getElementById("blockList");
  blockUl.innerHTML = "";
  st.blocklist.forEach((d, idx) => {
    blockUl.appendChild(
      makeListItem(d, async () => {
        const next = st.blocklist.filter((_, i) => i !== idx);
        await setState({ blocklist: next });
        await enforceNow();
        render();
      })
    );
  });
}

document.getElementById("start").onclick = async () => {
  const mins = parseInt(document.getElementById("minutes").value || "25", 10);
  await chrome.runtime.sendMessage({ type: "START_SESSION", minutes: mins });
  await enforceNow();
  render();
};

document.getElementById("stop").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "STOP_SESSION" });
  await enforceNow();
  render();
};

document.getElementById("openDash").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
};

document.getElementById("addAllow").onclick = async () => {
  const st = await getState();
  const d = cleanDomain(document.getElementById("allowInput").value);
  if (!d) return;
  if (!st.allowlist.includes(d)) st.allowlist.push(d);
  await setState({ allowlist: st.allowlist });
  document.getElementById("allowInput").value = "";
  await enforceNow();
  render();
};

document.getElementById("addBlock").onclick = async () => {
  const st = await getState();
  const d = cleanDomain(document.getElementById("blockInput").value);
  if (!d) return;
  if (!st.blocklist.includes(d)) st.blocklist.push(d);
  await setState({ blocklist: st.blocklist });
  document.getElementById("blockInput").value = "";
  await enforceNow();
  render();
};

document.getElementById("addCurrent").onclick = async () => {
  const st = await getState();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const d = cleanDomain(tab?.url || "");
  if (!d) return;
  if (!st.allowlist.includes(d)) st.allowlist.push(d);
  await setState({ allowlist: st.allowlist });
  await enforceNow();
  render();
};

document.getElementById("clearAllow").onclick = async () => {
  await setState({ allowlist: [] });
  await enforceNow();
  render();
};

document.getElementById("clearBlock").onclick = async () => {
  await setState({ blocklist: [] });
  await enforceNow();
  render();
};

render();
setInterval(render, 1000);