// background.js
const DEFAULTS = {
  sessionActive: false,
  sessionEndsAt: null, // ms epoch
  sessionStartedAt: null, // ms epoch
  sessionId: null,

  allowlist: ["canvas.illinois.edu", "geeksforgeeks.org", "leetcode.com", "docs.google.com"],
  blocklist: ["youtube.com", "reddit.com", "tiktok.com", "twitter.com", "x.com"],

  blockedAttempts: 0,
  plantHealth: 100, // 0..100

  // analytics event log (local only)
  events: [] // capped
};

const ALARM_NAME = "focusTick";
const EVENTS_CAP = 3000;

async function getState() {
  const state = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...state };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

function normalizeDomain(hostname) {
  return (hostname || "").toLowerCase().replace(/^www\./, "");
}

function getDomain(url) {
  try {
    const u = new URL(url);
    return normalizeDomain(u.hostname);
  } catch {
    return "";
  }
}

// Matches exact + subdomains:
// - youtube.com matches youtube.com, www.youtube.com, m.youtube.com
function domainMatches(domain, list) {
  const d = normalizeDomain(domain);
  return (list || []).some(item => {
    const it = normalizeDomain(item);
    return d === it || d.endsWith("." + it);
  });
}

function makeId() {
  // simple unique id for session correlation
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function logEvent(evt) {
  const st = await getState();
  const events = Array.isArray(st.events) ? st.events : [];
  events.push(evt);
  const trimmed = events.length > EVENTS_CAP ? events.slice(events.length - EVENTS_CAP) : events;
  await setState({ events: trimmed });
}

async function startSession(minutes) {
  const mins = Math.max(1, parseInt(minutes || "25", 10));
  const now = Date.now();
  const endsAt = now + mins * 60 * 1000;
  const sessionId = makeId();

  await setState({
    sessionActive: true,
    sessionStartedAt: now,
    sessionEndsAt: endsAt,
    sessionId,
    blockedAttempts: 0,
    plantHealth: 100
  });

  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

  await logEvent({
    type: "session_start",
    ts: now,
    sessionId,
    plannedMinutes: mins
  });
}

async function endSession(reason) {
  const st = await getState();
  const now = Date.now();
  const sessionId = st.sessionId;

  // Only log if there was an active session
  if (st.sessionActive && sessionId) {
    const completed = reason === "completed";
    await logEvent({
      type: "session_end",
      ts: now,
      sessionId,
      reason,
      completed,
      durationMs: st.sessionStartedAt ? Math.max(0, now - st.sessionStartedAt) : null
    });
  }

  await setState({
    sessionActive: false,
    sessionEndsAt: null,
    sessionStartedAt: null,
    sessionId: null,

    // reset “this session” stats
    blockedAttempts: 0,
    plantHealth: 100
  });

  await chrome.alarms.clear(ALARM_NAME);
}

async function shouldBlockUrl(url) {
  const { sessionActive, allowlist, blocklist, sessionEndsAt } = await getState();
  if (!sessionActive) return false;

  // auto-end if time passed
  if (sessionEndsAt && Date.now() > sessionEndsAt) {
    await endSession("completed");
    return false;
  }

  // only enforce on http(s)
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;

  const domain = getDomain(url);
  if (!domain) return false;

  // If explicitly blocked → block
  if (domainMatches(domain, blocklist)) return true;

  // If allowlist has entries, require allowlist match
  if (allowlist && allowlist.length > 0) {
    return !domainMatches(domain, allowlist);
  }

  return false;
}

async function enforceOnTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!tab?.url) return;

  // Skip Chrome internal + extension pages
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;

  const block = await shouldBlockUrl(tab.url);
  if (block) {
    const st = await getState();
    const nextAttempts = (st.blockedAttempts ?? 0) + 1;

    // deduct 10 per attempt
    let nextHealth = (st.plantHealth ?? 100) - 10;
    nextHealth = Math.max(0, nextHealth);

    await setState({ blockedAttempts: nextAttempts, plantHealth: nextHealth });

    // analytics
    const domain = getDomain(tab.url);
    await logEvent({
      type: "blocked_attempt",
      ts: Date.now(),
      sessionId: st.sessionId,
      domain,
      url: tab.url
    });

    // Redirect to blocked screen
    const blockedUrl = chrome.runtime.getURL("blocked.html");
    await chrome.tabs.update(tabId, { url: blockedUrl });
  }
}

// Enforce on tab activity/updates
chrome.tabs.onActivated.addListener(({ tabId }) => enforceOnTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") enforceOnTab(tabId);
});

// Timer tick using alarms so popup doesn’t need to be open
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const st = await getState();
  if (!st.sessionActive) return;

  const now = Date.now();

  // Heal discipline meter +1% per minute while focused
  let health = st.plantHealth ?? 100;
  health = Math.min(100, health + 1);
  await setState({ plantHealth: health });

  // End session if time passed
  if (st.sessionEndsAt && now > st.sessionEndsAt) {
    await endSession("completed");
  }
});

// Ensure alarm exists if sessionActive survived a service worker restart
async function ensureAlarmConsistency() {
  const st = await getState();

  if (st.sessionActive) {
    // if session already expired, end it
    if (st.sessionEndsAt && Date.now() > st.sessionEndsAt) {
      await endSession("completed");
      return;
    }
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

chrome.runtime.onStartup.addListener(() => {
  ensureAlarmConsistency();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarmConsistency();
});

// Allow popup/blocked page/dashboard to send commands
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "ENFORCE_ACTIVE_TAB") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const t = tabs?.[0];
        if (t?.id != null) enforceOnTab(t.id);
      });
      return;
    }

    if (msg?.type === "START_SESSION") {
      await startSession(msg.minutes);
      // after starting, immediately enforce current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const t = tabs?.[0];
        if (t?.id != null) enforceOnTab(t.id);
      });
      sendResponse?.({ ok: true });
      return;
    }

    if (msg?.type === "STOP_SESSION") {
      await endSession("manual_stop");

      // If currently on blocked page, close it to new tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const t = tabs?.[0];
        if (t?.id != null && t.url?.startsWith(chrome.runtime.getURL("blocked.html"))) {
          chrome.tabs.update(t.id, { url: "chrome://newtab" });
        }
      });

      sendResponse?.({ ok: true });
      return;
    }

    if (msg?.type === "OPEN_DASHBOARD") {
      const url = chrome.runtime.getURL("dashboard.html");
      await chrome.tabs.create({ url });
      sendResponse?.({ ok: true });
      return;
    }
  })();

  // keep MV3 message channel alive for async sendResponse
  return true;
});