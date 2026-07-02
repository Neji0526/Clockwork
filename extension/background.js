// ClockWork — VA capture service worker (Manifest V3) — v0.4.12
//
// Reliability hardening (v0.4.6):
//  - All recording state lives in chrome.storage and is reloaded per handler
//    so a suspended-then-revived MV3 service worker resumes correctly.
//  - Alarms (heartbeat / screenshot / capreq / engagement) are (re)created
//    on clock-in AND re-armed on onStartup, onInstalled, and SW revival.
//  - Explicit heartbeat ingest (kind:"heartbeat") on a 1-min cadence keeps
//    work_sessions.last_activity_at fresh independent of activity events.
//  - Offline queue: every ingest payload is enqueued in chrome.storage on
//    failure (offline / 5xx / timeout). Flushed with backoff on the next
//    tick, on `online`, and on SW revival. Bounded (drops oldest).
//  - Sleep / wake long-gap recovery: if (now - lastActivityAt) > session
//    timeout, the prior session is cleanly ended at lastActivityAt rather
//    than counting sleep as active time. Then alarms re-arm.
//  - Auth resilience: refresh failures DON'T silently wipe auth — they set
//    a needsReauth flag the popup surfaces; uploads pause (queue) until the
//    VA signs in again.
//  - Popup status exposes: state, last-synced, queued count, offline,
//    needsReauth.
//  - onSuspend best-effort flush; clockOut finalizes + flushes + clears alarms.

// ---------- config ----------
const SUPABASE_URL = "https://johibfayobgerhzjbisu.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvaGliZmF5b2JnZXJoempiaXN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTk3NjcsImV4cCI6MjA5Njg3NTc2N30.L_U3HWFg6bp3ZIKtrJfvKtUYeEofgmV3j9aKm5U713E";
const INGEST_URL = `${SUPABASE_URL}/functions/v1/track-ingest`;
const AUTH_URL = `${SUPABASE_URL}/auth/v1/token`;

const DEFAULTS = {
  idleSeconds: 300,
  shotMinutes: 5,
  workflowGapSec: 30,
  workflowMaxSteps: 25,
  // session timeout (minutes) for sleep/wake recovery — must match server default
  sessionTimeoutMin: 10,
  blocklist: ["johibfayobgerhzjbisu.supabase.co", "accounts.google.com"],
};

const QUEUE_MAX = 500;            // hard cap
const QUEUE_KEY = "wt-queue";
const SYNC_KEY = "wt-last-sync";  // ms timestamp of last successful ingest
const REAUTH_KEY = "wt-needs-reauth";
const VERSION_KEY = "wt-version-info"; // { latest, min, install_url, checkedAt }
const DEFAULT_VERSION_HOST = "https://clockwork.aiforbusiness.com";

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}) };
}

// ---------- auth ----------
async function getAuth() {
  const { auth } = await chrome.storage.local.get("auth");
  return auth || null;
}
async function setAuth(auth) {
  if (auth) await chrome.storage.local.set({ auth });
  else await chrome.storage.local.remove("auth");
}
async function setNeedsReauth(v) {
  if (v) await chrome.storage.local.set({ [REAUTH_KEY]: true });
  else await chrome.storage.local.remove(REAUTH_KEY);
}
async function getNeedsReauth() {
  const o = await chrome.storage.local.get(REAUTH_KEY);
  return !!o[REAUTH_KEY];
}

async function login(email, password) {
  try {
    const res = await fetch(`${AUTH_URL}?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error_description || data.msg || data.error || "Login failed" };
    await setAuth({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      email: data.user?.email || email,
      user_id: data.user?.id || null,
    });
    await setNeedsReauth(false);
    // Opportunistic flush of anything we queued while logged out / re-auth pending.
    flushQueue().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

async function refreshToken(auth) {
  const res = await fetch(`${AUTH_URL}?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Distinguish network vs hard auth failure. 400/401 = invalid grant → re-auth.
    const hard = res.status >= 400 && res.status < 500;
    const err = new Error(data.error_description || "refresh failed");
    err.hardAuthFail = hard;
    throw err;
  }
  const next = {
    ...auth,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  await setAuth(next);
  return next;
}

// Returns a valid access token (refreshing if needed), or null.
// On a HARD auth failure flips the needsReauth flag (does NOT wipe auth so
// the popup can still show the email and offer a clear "Sign in again").
// On a transient/network failure returns null without flipping the flag —
// the caller queues the payload instead.
async function getToken() {
  let auth = await getAuth();
  if (!auth) return null;
  if (auth.expires_at - Date.now() < 60_000) {
    try {
      auth = await refreshToken(auth);
    } catch (e) {
      if (e && e.hardAuthFail) {
        await setNeedsReauth(true);
      }
      return null;
    }
  }
  return auth.access_token;
}

// ---------- offline queue ----------
async function getQueue() {
  const o = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(o[QUEUE_KEY]) ? o[QUEUE_KEY] : [];
}
async function setQueue(q) {
  await chrome.storage.local.set({ [QUEUE_KEY]: q });
}
async function queueLength() {
  return (await getQueue()).length;
}
async function enqueue(payload) {
  const q = await getQueue();
  q.push({ payload, queuedAt: Date.now(), attempts: 0 });
  if (q.length > QUEUE_MAX) {
    const dropped = q.length - QUEUE_MAX;
    q.splice(0, dropped);
    console.warn(`[ClockWork] queue overflow, dropped ${dropped} oldest events`);
  }
  await setQueue(q);
}

let _flushing = false;
async function flushQueue() {
  if (_flushing) return;
  _flushing = true;
  try {
    let q = await getQueue();
    if (!q.length) return;
    const auth = await getAuth();
    if (!auth || (await getNeedsReauth())) return; // wait until re-auth
    const token = await getToken();
    if (!token) return;

    // Drain head-of-queue until a send fails.
    while (q.length) {
      const head = q[0];
      const r = await rawIngest(head.payload, token);
      if (r.ok) {
        q.shift();
        await setQueue(q);
        await chrome.storage.local.set({ [SYNC_KEY]: Date.now() });
        continue;
      }
      // 401 mid-flush → token went bad, stop and try again next tick.
      if (r.status === 401) {
        await setNeedsReauth(true);
        break;
      }
      // Other failure — bump attempts; if too many, drop the offender.
      head.attempts = (head.attempts || 0) + 1;
      if (head.attempts > 8) {
        console.warn("[ClockWork] dropping un-deliverable event after 8 attempts", head.payload?.kind);
        q.shift();
      }
      await setQueue(q);
      break; // backoff handled by next alarm tick
    }
  } finally {
    _flushing = false;
  }
}

// ---------- ingest ----------
async function rawIngest(payload, token) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

// Public ingest: tries direct send; on failure queues for retry.
// Returns shape compatible with old callers: { ok, status?, data? }.
// `inlineOnly` skips the queue (used for session_start where the caller needs
// the returned session_id synchronously; if it fails, the caller surfaces an error).
async function ingest(payload, opts) {
  const inlineOnly = !!(opts && opts.inlineOnly);
  const auth = await getAuth();
  if (!auth || (await getNeedsReauth())) {
    if (inlineOnly) return { ok: false, error: "needs_reauth" };
    await enqueue(payload);
    return { ok: false, queued: true, error: "needs_reauth" };
  }
  const token = await getToken();
  if (!token) {
    if (inlineOnly) return { ok: false, error: "no_token" };
    await enqueue(payload);
    return { ok: false, queued: true, error: "no_token" };
  }

  const r = await rawIngest(payload, token);
  if (r.ok) {
    await chrome.storage.local.set({ [SYNC_KEY]: Date.now() });
    // Opportunistic: if we have backlog, kick a flush.
    if ((await queueLength()) > 0) flushQueue().catch(() => {});
    return r;
  }
  if (r.status === 401) {
    await setNeedsReauth(true);
  }
  if (inlineOnly) return r;
  await enqueue(payload);
  return { ok: false, queued: true, status: r.status, error: r.error };
}

// ---------- recording state ----------
async function getRec() {
  const { rec } = await chrome.storage.local.get("rec");
  return rec || null;
}
async function setRec(rec) {
  if (rec) await chrome.storage.local.set({ rec });
  else await chrome.storage.local.remove("rec");
}

// Update the locally-tracked lastActivityAt; used for sleep/wake recovery.
async function bumpLocalActivity() {
  const rec = await getRec();
  if (!rec) return;
  rec.lastActivityAt = Date.now();
  await setRec(rec);
}

function fmtBadgeTime(sec) {
  if (sec < 60) return String(sec) + "s";
  const m = Math.floor(sec / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h";
}
async function updateBadgeLive() {
  const rec = await getRec();
  if (!rec) { chrome.action.setBadgeText({ text: "" }); return; }
  if (rec.paused) {
    chrome.action.setBadgeText({ text: "II" });
    chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() - (rec.startedAt || Date.now())) / 1000));
  chrome.action.setBadgeText({ text: fmtBadgeTime(sec) });
  chrome.action.setBadgeBackgroundColor({ color: rec.idleStart ? "#b45309" : "#16a34a" });
}
function setBadge(state) {
  if (state === "rec") {
    chrome.action.setBadgeText({ text: "0m" });
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    updateBadgeLive();
  } else if (state === "paused") {
    chrome.action.setBadgeText({ text: "II" });
    chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ""; }
}
function isBlocked(url, blocklist) {
  const h = hostOf(url);
  if (!h) return true;
  return blocklist.some((d) => h === d || h.endsWith("." + d));
}

async function listClients() {
  const token = await getToken();
  if (!token) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?select=id,name&archived=eq.false&order=name.asc`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

// ---------- alarms ----------
// Idempotent ensure: only (re)creates the alarm if it doesn't already exist
// with the same period. This is CRITICAL — calling alarms.create() with the
// same name resets the period start. The MV3 service worker revives frequently
// (on every wt-engage / wt-heartbeat / message), and if bootstrap re-arms a
// 5-min wt-shot each revival, the alarm never fires. Idempotent ensure on
// SW revival is the only correct behaviour.
async function ensureAlarm(name, periodInMinutes) {
  const existing = await chrome.alarms.get(name);
  if (existing && Math.abs((existing.periodInMinutes || 0) - periodInMinutes) < 0.001) return;
  if (existing) await chrome.alarms.clear(name);
  // delayInMinutes: small initial delay so a brand-new alarm fires soon (not
  // a full period away). For wt-shot in particular, this means the first
  // screenshot lands within ~1 min of clock-in rather than 5 min.
  chrome.alarms.create(name, {
    periodInMinutes,
    delayInMinutes: Math.min(1, periodInMinutes),
  });
}
async function armAlarms(opts) {
  const force = !!(opts && opts.force);
  const s = await getSettings();
  const shotMin = Math.max(1, Number(s.shotMinutes) || 5);
  const specs = [
    ["wt-heartbeat", 1],
    ["wt-shot", shotMin],
    ["wt-capreq", 0.5],
    ["wt-engage", 1],
    ["wt-flush-queue", 0.5],
    ["wt-version-check", 360],
  ];
  if (force) {
    for (const [name] of specs) await chrome.alarms.clear(name);
  }
  for (const [name, period] of specs) await ensureAlarm(name, period);
}
async function clearRecordingAlarms() {
  await chrome.alarms.clear("wt-heartbeat");
  await chrome.alarms.clear("wt-shot");
  await chrome.alarms.clear("wt-capreq");
  await chrome.alarms.clear("wt-engage");
  await chrome.alarms.clear("wt-flush");
  // keep wt-flush-queue + wt-version-check running
}

// ---------- clock in / out ----------
async function clockIn(clientId) {
  if (await getNeedsReauth()) return { error: "Please sign in again." };
  const token = await getToken();
  if (!token) return { error: "Please log in first." };
  const body = { kind: "session_start", source: "extension" };
  if (clientId) body.client_id = clientId;
  // session_start must be inline — we need the session_id back.
  const r = await ingest(body, { inlineOnly: true });
  if (!r.ok || !r.data || !r.data.session_id) {
    return { error: "Could not start session (" + (r.status || r.error || "?") + ")." };
  }
  await setRec({
    sessionId: r.data.session_id,
    paused: false,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    activity: null,
    idleStart: null,
    clientId: clientId || null,
  });
  await chrome.storage.local.remove("clickBuffer");

  const s = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(15, Number(s.idleSeconds) || 300));
  await armAlarms({ force: true });
  await resetEngagementWindow();

  setBadge("rec");
  await startActivityFromActiveTab();
  await injectAllTabs();
  pollCaptureRequests().catch(() => {});
  pollSessionCommands().catch(() => {});
  return await status();
}

async function clockOut() {
  const rec = await getRec();
  await clearRecordingAlarms();
  await setRec(null);
  setBadge("off");

  (async () => {
    try {
      if (rec) {
        if (rec.activity) {
          const a = rec.activity;
          const dur = Math.round((Date.now() - a.startedAt) / 1000);
          if (dur >= 1) {
            await ingest({
              kind: "activity",
              session_id: rec.sessionId,
              app: a.app, title: a.title, url: a.url,
              started_at: new Date(a.startedAt).toISOString(),
              duration_sec: dur,
            });
          }
        }
        await flushWorkflowFor(rec.sessionId);
        try { await ingest({ kind: "break_end", session_id: rec.sessionId }); } catch (e) {}
        await ingest({ kind: "session_end", session_id: rec.sessionId });
      }
      await flushQueue();
    } catch (e) { /* non-fatal */ }
  })();
  return await status();
}

async function togglePause(breakType) {
  const rec = await getRec();
  if (!rec) return await status();
  if (!rec.paused) {
    // 'lunch' or 'short_break' — picks which ingest kind to send. Defaults to
    // short_break for legacy callers (e.g. web command sync without a type).
    const bt = breakType === "lunch" ? "lunch" : "short_break";
    const sessionId = rec.sessionId;
    const activity = rec.activity;
    rec.paused = true;
    rec.pausedAt = Date.now();
    rec.activity = null;
    await setRec(rec);
    setBadge("paused");
    (async () => {
      try {
        if (activity) {
          const dur = Math.round((Date.now() - activity.startedAt) / 1000);
          if (dur >= 1) {
            await ingest({
              kind: "activity", session_id: sessionId,
              app: activity.app, title: activity.title, url: activity.url,
              started_at: new Date(activity.startedAt).toISOString(),
              duration_sec: dur,
            });
          }
        }
        await flushWorkflowFor(sessionId);
        await ingest({
          kind: bt === "lunch" ? "lunch_start" : "break_start",
          session_id: sessionId,
          started_at: new Date().toISOString(),
        });
      } catch (e) {}
    })();
  } else {
    rec.paused = false;
    rec.pausedAt = null;
    await setRec(rec);
    setBadge("rec");
    try { await ingest({ kind: "break_end", session_id: rec.sessionId }); } catch (e) {}
    await startActivityFromActiveTab();
    await injectActiveTab();
  }
  return await status();
}

// ---------- activity tracking ----------
// Strict: only returns the window if Chrome is the OS-frontmost app.
// Used for activity tracking ("current site follows focus").
async function focusedWindow() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
    if (!win || !win.focused) return null;
    return win;
  } catch (e) { return null; }
}
async function activeTab() {
  const win = await focusedWindow();
  if (!win) return null;
  const tab = (win.tabs || []).find((t) => t.active);
  return tab || null;
}
// Lenient: most-recently-focused normal window, even if Chrome isn't currently
// frontmost (popup open, DevTools focused, another app on top). Used for
// screenshots — the right capture target is still the last visible Chrome tab.
async function lastNormalWindow() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
    if (win && win.tabs && win.tabs.length) return win;
  } catch (e) {}
  // Fallback: scan all normal windows, pick the one with the most-recent active tab.
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    for (const w of wins) {
      if ((w.tabs || []).some((t) => t.active)) return w;
    }
  } catch (e) {}
  return null;
}
async function captureTargetTab() {
  const win = await lastNormalWindow();
  if (!win) return null;
  const tab = (win.tabs || []).find((t) => t.active);
  return tab || null;
}
// Throttled warning logger so a recurring failure doesn't spam the console.
const _warnedAt = {};
function warnOnce(key, ...args) {
  const now = Date.now();
  if (_warnedAt[key] && now - _warnedAt[key] < 5 * 60_000) return;
  _warnedAt[key] = now;
  console.warn("[ClockWork]", key, ...args);
}

async function startActivityFromActiveTab() {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const tab = await activeTab();
  if (!tab || !/^https?:\/\//i.test(tab.url || "")) { rec.activity = null; await setRec(rec); return; }
  const s = await getSettings();
  if (isBlocked(tab.url, s.blocklist)) { rec.activity = null; await setRec(rec); return; }
  rec.activity = {
    app: hostOf(tab.url),
    title: (tab.title || "").slice(0, 500),
    url: tab.url.slice(0, 1000),
    startedAt: Date.now(),
  };
  rec.lastActivityAt = Date.now();
  await setRec(rec);
}

async function finalizeActivity(restart = false) {
  const rec = await getRec();
  if (!rec || !rec.activity) return;
  const a = rec.activity;
  const dur = Math.round((Date.now() - a.startedAt) / 1000);
  if (dur >= 1) {
    await ingest({
      kind: "activity",
      session_id: rec.sessionId,
      app: a.app, title: a.title, url: a.url,
      started_at: new Date(a.startedAt).toISOString(),
      duration_sec: dur,
    });
  }
  if (restart) {
    a.startedAt = Date.now();
    rec.activity = a;
  } else {
    rec.activity = null;
  }
  rec.lastActivityAt = Date.now();
  await setRec(rec);
}

async function onActiveTabChanged() {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const tab = await activeTab();
  const newUrl = tab && tab.url ? tab.url : "";
  if (rec.activity && rec.activity.url === newUrl) return;
  await finalizeActivity();
  await startActivityFromActiveTab();
}

chrome.tabs.onActivated.addListener(() => onActiveTabChanged());
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab && tab.url) injectTab(tabId, tab.url);
  if (info.status === "complete" && tab && tab.active) onActiveTabChanged();
});
chrome.tabs.onCreated.addListener((tab) => {
  if (tab && tab.id && tab.url) injectTab(tab.id, tab.url);
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId !== chrome.windows.WINDOW_ID_NONE) onActiveTabChanged();
});
chrome.windows.onCreated.addListener(async (win) => {
  try {
    const full = await chrome.windows.get(win.id, { populate: true });
    for (const t of full.tabs || []) if (t.id && t.url) injectTab(t.id, t.url);
  } catch (e) {}
  onActiveTabChanged();
});

// ---------- idle ----------
chrome.idle.onStateChanged.addListener(async (state) => {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  if (state === "idle" || state === "locked") {
    await finalizeActivity();
    rec.idleStart = Date.now();
    await setRec(rec);
  } else if (state === "active") {
    if (rec.idleStart) {
      const dur = Math.round((Date.now() - rec.idleStart) / 1000);
      if (dur >= 1) {
        await ingest({
          kind: "idle",
          session_id: rec.sessionId,
          started_at: new Date(rec.idleStart).toISOString(),
          duration_sec: dur,
        });
      }
      rec.idleStart = null;
      await setRec(rec);
    }
    // Sleep/wake recovery — must run when the OS comes back to life.
    await recoverFromGapIfNeeded();
    const stillRec = await getRec();
    if (stillRec) {
      await startActivityFromActiveTab();
      await injectActiveTab();
    }
  }
});

// ---------- sleep / wake recovery ----------
// If more time has elapsed since lastActivityAt than the configured session
// timeout, the OS most likely slept. End the prior session cleanly at the
// last-known activity timestamp rather than counting sleep as active work.
async function recoverFromGapIfNeeded() {
  const rec = await getRec();
  if (!rec) return;
  const s = await getSettings();
  const timeoutMs = Math.max(60, Number(s.sessionTimeoutMin) || 10) * 60_000;
  const last = rec.lastActivityAt || rec.startedAt || Date.now();
  const gap = Date.now() - last;
  if (gap <= timeoutMs) return;
  console.log(`[ClockWork] long gap (${Math.round(gap/1000)}s) — closing session at last activity`);
  // End the abandoned session. The server will cap ended_at at last_activity_at
  // via close_stale_sessions(); we also enqueue an explicit session_end so the
  // close happens promptly.
  await clearRecordingAlarms();
  const sessionId = rec.sessionId;
  await setRec(null);
  setBadge("off");
  try { await ingest({ kind: "session_end", session_id: sessionId }); } catch (e) {}
}

// ---------- alarms tick ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Always try to drain the queue; the worker may have just revived.
  if (alarm.name === "wt-flush-queue") {
    await flushQueue();
    return;
  }
  // Periodic version check is independent of recording state.
  if (alarm.name === "wt-version-check") {
    await checkForUpdate().catch(() => {});
    return;
  }

  // Sleep/wake check on every recording alarm tick (cheap, idempotent).
  await recoverFromGapIfNeeded();

  // Apply any pending web→extension commands BEFORE the rec/paused gate, so
  // a "break_end" can unpause us and a "clock_out" can run even if our local
  // rec is stale. Cheap (single REST round-trip; no-op when no commands).
  if (alarm.name === "wt-heartbeat" || alarm.name === "wt-capreq") {
    await pollSessionCommands().catch(() => {});
  }

  const rec = await getRec();
  if (!rec) return;
  if (rec.paused && alarm.name !== "wt-flush-queue") return;

  if (alarm.name === "wt-heartbeat") {
    await ingest({ kind: "heartbeat", session_id: rec.sessionId });
    await bumpLocalActivity();
    if (!rec.idleStart) await finalizeActivity(true);
    await updateBadgeLive();
    pollCaptureRequests().catch(() => {});
    await flushQueue();
    await maybeSelfHealScreenshot("heartbeat");
  } else if (alarm.name === "wt-shot") {
    const r = await takeScreenshot({ trigger: "alarm" });
    console.log("[ClockWork] wt-shot tick:", r.ok ? "ok" : r.reason);
  } else if (alarm.name === "wt-flush") {
    await flushWorkflow();
  } else if (alarm.name === "wt-capreq") {
    pollCaptureRequests().catch(() => {});
  } else if (alarm.name === "wt-engage") {
    flushEngagementSample().catch(() => {});
    maybeSelfHealScreenshot("engage").catch(() => {});
  }
});

// Self-heal: if the periodic alarm has somehow stopped firing (MV3 quirks,
// long suspensions, etc.), force a capture when the last successful shot is
// stale. Caps to ~1 forced capture per shotMinutes window via the same
// lastShotAt timestamp the periodic path writes.
async function maybeSelfHealScreenshot(trigger) {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const s = await getSettings();
  const shotMin = Math.max(1, Number(s.shotMinutes) || 5);
  const staleMs = Math.round(1.5 * shotMin * 60_000);
  const last = await getLastShotAt();
  // First-shot-after-clockin grace: treat startedAt as the floor.
  const ref = Math.max(last, rec.startedAt || 0);
  if (Date.now() - ref < staleMs) return;
  console.log(`[ClockWork] self-heal screenshot (trigger=${trigger}, gap=${Math.round((Date.now()-ref)/1000)}s)`);
  const r = await takeScreenshot({ trigger: "self-heal:" + trigger });
  if (!r.ok) console.log("[ClockWork] self-heal result:", r.reason);
}

// ---------- engagement sampling ----------
async function resetEngagementWindow() {
  await chrome.storage.local.set({
    engageWin: { startedAt: Date.now(), click: 0, key: 0, scroll: 0 },
  });
}
async function noteInteraction(kind) {
  const rec = await getRec();
  // An interaction itself proves the user is active — do NOT gate on idleStart
  // (which can stick across SW restarts if the "active" idle transition was
  // missed). Recording a click/key/scroll always counts while clocked in.
  if (!rec || rec.paused) return;
  const { engageWin } = await chrome.storage.local.get("engageWin");
  const w = engageWin || { startedAt: Date.now(), click: 0, key: 0, scroll: 0 };
  if (kind === "click") w.click++;
  else if (kind === "key") w.key++;
  else if (kind === "scroll") w.scroll++;
  await chrome.storage.local.set({ engageWin: w });
  // Any genuine interaction also bumps local activity (sleep/wake guard).
  await bumpLocalActivity();
}
async function flushEngagementSample() {
  const rec = await getRec();
  // Only gate on the two things that truly mean "we shouldn't sample":
  //   - not clocked in
  //   - explicitly paused
  // We do NOT gate on rec.idleStart (sticky state risk) and we do NOT gate on
  // chrome.idle.queryState — those used to silently suppress every sample for
  // VAs whose idle threshold cleared between interactions. The sample row
  // itself carries interacted/counts so the server can distinguish idle vs
  // active windows.
  if (!rec || !rec.sessionId || rec.paused) return;

  const { engageWin } = await chrome.storage.local.get("engageWin");
  const w = engageWin || { startedAt: Date.now() - 60_000, click: 0, key: 0, scroll: 0 };
  const elapsed = Math.max(1, Math.min(600, Math.round((Date.now() - w.startedAt) / 1000)));
  await resetEngagementWindow();
  const interacted = (w.click + w.key + w.scroll) > 0;
  try {
    await ingest({
      kind: "engagement",
      session_id: rec.sessionId,
      window_sec: elapsed,
      interacted,
      click_count: w.click,
      key_count: w.key,
      scroll_count: w.scroll,
    });
  } catch (e) { warnOnce("engagement_ingest_failed", e && e.message); }
}

const LAST_SHOT_KEY = "wt-last-shot-at";
async function getLastShotAt() {
  const o = await chrome.storage.local.get(LAST_SHOT_KEY);
  return Number(o[LAST_SHOT_KEY]) || 0;
}
async function setLastShotAt(ts) {
  await chrome.storage.local.set({ [LAST_SHOT_KEY]: ts });
}

async function takeScreenshot(opts) {
  const trigger = (opts && opts.trigger) || "alarm";
  const rec = await getRec();
  if (!rec || rec.paused) {
    warnOnce("shot_skip_not_recording", trigger);
    return { ok: false, reason: "not_recording" };
  }
  const tab = await captureTargetTab();
  if (!tab || !/^https?:\/\//i.test(tab.url || "")) {
    warnOnce("shot_skip_no_capturable_tab", trigger, tab && tab.url);
    return { ok: false, reason: "no_capturable_tab" };
  }
  const s = await getSettings();
  if (isBlocked(tab.url, s.blocklist)) {
    warnOnce("shot_skip_blocked_url", trigger, hostOf(tab.url));
    return { ok: false, reason: "blocked_url" };
  }
  let dataUrl = null;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 55 });
  } catch (e) {
    warnOnce("shot_skip_capture_throttled", trigger, e && e.message);
    return { ok: false, reason: "capture_throttled" };
  }
  if (!dataUrl) {
    warnOnce("shot_skip_capture_failed", trigger);
    return { ok: false, reason: "capture_failed" };
  }
  try {
    const payload = { kind: "screenshot", session_id: rec.sessionId, data_url: dataUrl };
    if (opts && opts.captureRequestId) payload.capture_request_id = opts.captureRequestId;
    const r = await ingest(payload);
    if (r.ok || r.queued) await setLastShotAt(Date.now());
    if (!r.ok && !r.queued) warnOnce("shot_skip_upload_failed", trigger, r.status);
    return { ok: !!r.ok, reason: r.ok ? null : (r.queued ? "queued" : "upload_failed") };
  } catch (e) {
    warnOnce("shot_skip_ingest_exception", trigger, e && e.message);
    return { ok: false, reason: "ingest_failed" };
  }
}

// ---------- on-demand capture requests ----------
async function pollCaptureRequests() {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const auth = await getAuth();
  if (!auth || !auth.user_id) return;
  const token = await getToken();
  if (!token) return;
  let rows;
  try {
    const url = `${SUPABASE_URL}/rest/v1/capture_requests`
      + `?select=id,expires_at,status`
      + `&va_id=eq.${encodeURIComponent(auth.user_id)}`
      + `&status=eq.pending`
      + `&order=created_at.asc&limit=5`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    rows = await res.json();
  } catch (e) { return; }
  if (!Array.isArray(rows) || !rows.length) return;
  for (const row of rows) {
    if (Date.parse(row.expires_at) < Date.now()) {
      await markCaptureRequest(row.id, { status: "expired", reason: "expired_before_fulfillment" });
      continue;
    }
    const r = await takeScreenshot({ captureRequestId: row.id });
    if (!r.ok && r.reason !== "queued") {
      await markCaptureRequest(row.id, { status: "failed", reason: r.reason || "capture_failed" });
    }
  }
}
async function markCaptureRequest(id, patch) {
  const token = await getToken();
  if (!token) return;
  const body = { ...patch };
  if (patch.status === "fulfilled" || patch.status === "failed" || patch.status === "expired") {
    body.fulfilled_at = new Date().toISOString();
  }
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/capture_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
      { method: "PATCH",
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`,
                   "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body) }
    );
  } catch (e) {}
}

// ---------- web → extension session commands ----------
// The web "My day" UI writes commands (clock_out / break_start / break_end)
// into public.session_commands. We apply them LOCALLY ONLY — the web side
// already made the canonical DB write (break_segments row, session_end via
// track-ingest). Our job is just to bring this SW's in-memory recording
// state (alarms, paused flag, rec) into sync, so the extension stops
// recording / pauses / resumes within ~30s of the user's web action.
async function pollSessionCommands() {
  const auth = await getAuth();
  if (!auth || !auth.user_id) return;
  const token = await getToken();
  if (!token) return;
  let rows;
  try {
    const url = `${SUPABASE_URL}/rest/v1/session_commands`
      + `?select=id,command,session_id,expires_at,status`
      + `&va_id=eq.${encodeURIComponent(auth.user_id)}`
      + `&status=eq.pending`
      + `&order=created_at.asc&limit=10`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    rows = await res.json();
  } catch (e) { return; }
  if (!Array.isArray(rows) || !rows.length) return;
  for (const row of rows) {
    if (Date.parse(row.expires_at) < Date.now()) {
      await markSessionCommand(row.id, "expired");
      continue;
    }
    try {
      await applySessionCommandLocally(row.command, row.session_id);
      await markSessionCommand(row.id, "applied");
    } catch (e) {
      warnOnce("session_command_apply_failed", row.command, e && e.message);
    }
  }
}
async function markSessionCommand(id, status) {
  const token = await getToken();
  if (!token) return;
  const body = { status, applied_at: new Date().toISOString() };
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/session_commands?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
      { method: "PATCH",
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`,
                   "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body) }
    );
  } catch (e) {}
}
async function applySessionCommandLocally(command, sessionId) {
  const rec = await getRec();
  // If we have no local rec, the command is a no-op (already in target state).
  // We still mark it applied so the web UI clears its "syncing…" indicator.
  if (!rec) return;
  // If a session_id was supplied and it doesn't match ours, ignore — this is
  // a stale command from a previous session.
  if (sessionId && rec.sessionId && sessionId !== rec.sessionId && command !== "clock_out") return;

  if (command === "clock_out") {
    console.log("[ClockWork] applying web command: clock_out");
    // Mirror clockOut() but WITHOUT sending session_end (web already did).
    await clearRecordingAlarms();
    // Best-effort flush of any local activity row / workflow before discarding rec.
    try {
      if (rec.activity) {
        const a = rec.activity;
        const dur = Math.round((Date.now() - a.startedAt) / 1000);
        if (dur >= 1) {
          await ingest({
            kind: "activity", session_id: rec.sessionId,
            app: a.app, title: a.title, url: a.url,
            started_at: new Date(a.startedAt).toISOString(),
            duration_sec: dur,
          });
        }
      }
      await flushWorkflowFor(rec.sessionId);
    } catch (e) {}
    await setRec(null);
    setBadge("off");
    await chrome.storage.local.remove("clickBuffer");
    flushQueue().catch(() => {});
  } else if (command === "break_start") {
    if (rec.paused) return; // already paused
    console.log("[ClockWork] applying web command: break_start");
    const activity = rec.activity;
    rec.paused = true;
    rec.pausedAt = Date.now();
    rec.activity = null;
    await setRec(rec);
    setBadge("paused");
    // Flush activity locally (no break_start ingest — web already inserted
    // the break_segments row).
    try {
      if (activity) {
        const dur = Math.round((Date.now() - activity.startedAt) / 1000);
        if (dur >= 1) {
          await ingest({
            kind: "activity", session_id: rec.sessionId,
            app: activity.app, title: activity.title, url: activity.url,
            started_at: new Date(activity.startedAt).toISOString(),
            duration_sec: dur,
          });
        }
      }
      await flushWorkflowFor(rec.sessionId);
    } catch (e) {}
  } else if (command === "break_end") {
    if (!rec.paused) return; // already running
    console.log("[ClockWork] applying web command: break_end");
    rec.paused = false;
    rec.pausedAt = null;
    rec.lastActivityAt = Date.now();
    await setRec(rec);
    setBadge("rec");
    await startActivityFromActiveTab();
    await injectActiveTab();
  }
}



// ---------- click-trails → workflows ----------
async function injectTab(tabId, url) {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  if (!/^https?:\/\//i.test(url || "")) return;
  const s = await getSettings();
  if (isBlocked(url, s.blocklist)) return;
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["recorder.js"] }); } catch (e) {}
}
async function injectActiveTab() {
  const tab = await activeTab();
  if (tab && tab.id) await injectTab(tab.id, tab.url);
}
async function injectAllTabs() {
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    for (const w of wins) for (const t of w.tabs || []) if (t.id && t.url) injectTab(t.id, t.url);
  } catch (e) {}
}

async function getBuffer() {
  const { clickBuffer } = await chrome.storage.local.get("clickBuffer");
  return clickBuffer || null;
}
async function setBuffer(b) {
  if (b) await chrome.storage.local.set({ clickBuffer: b });
  else await chrome.storage.local.remove("clickBuffer");
}

async function handleClick(meta) {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const s = await getSettings();
  if (isBlocked(meta.url, s.blocklist)) return;

  const host = hostOf(meta.url);
  const now = Date.now();
  let buf = await getBuffer();
  const boundary = buf && (
    buf.host !== host ||
    now - buf.lastAt > s.workflowGapSec * 1000 ||
    buf.items.length >= s.workflowMaxSteps
  );
  if (boundary) { await flushWorkflow(); buf = null; }
  let shot = null;
  try {
    const tab = await captureTargetTab();
    if (tab && tab.windowId != null && /^https?:\/\//i.test(tab.url || "")) {
      shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 45 });
    }
  } catch (e) { warnOnce("click_shot_failed", e && e.message); }
  if (!buf) buf = { host, items: [], lastAt: now };
  buf.items.push({
    label: (meta.label || "").slice(0, 200),
    tag: meta.tag || null,
    url: (meta.url || "").slice(0, 1000),
    rect: meta.rect || null,
    dpr: meta.dpr || null,
    viewport: meta.viewport || null,
    shot,
  });
  buf.lastAt = now;
  await setBuffer(buf);
  await bumpLocalActivity();

  await chrome.alarms.clear("wt-flush");
  chrome.alarms.create("wt-flush", { delayInMinutes: Math.max(0.5, s.workflowGapSec / 60) });
}

async function flushWorkflow() {
  const rec = await getRec();
  await flushWorkflowFor(rec ? rec.sessionId : null);
}
async function flushWorkflowFor(sessionId) {
  const buf = await getBuffer();
  if (!buf || !buf.items.length) { await setBuffer(null); return; }
  if (!sessionId) { await setBuffer(null); return; }
  const labels = buf.items.map((i) => i.label).filter(Boolean);
  for (let i = 0; i < buf.items.length; i++) {
    const it = buf.items[i];
    const last = i === buf.items.length - 1;
    try {
      await ingest({
        kind: "step",
        session_id: sessionId,
        step_index: i,
        label: it.label,
        tag: it.tag,
        url: it.url,
        rect: it.rect,
        dpr: it.dpr,
        viewport: it.viewport,
        screenshot: it.shot || null,
        ...(last ? { workflow_end: true, workflow_labels: labels } : {}),
      });
    } catch (e) {}
  }
  await setBuffer(null);
}

// ---------- version check ----------
function cmpVer(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
async function versionHost() {
  const { settings } = await chrome.storage.local.get("settings");
  const dash = settings && settings.dashboardUrl;
  return (dash && /^https?:\/\//.test(dash)) ? dash.replace(/\/+$/, "") : DEFAULT_VERSION_HOST;
}
async function checkForUpdate() {
  const host = await versionHost();
  try {
    const res = await fetch(`${host}/api/public/extension-version`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.latest) return null;
    const info = {
      latest: String(data.latest),
      min: String(data.min || data.latest),
      install_url: String(data.install_url || `${host}/install`),
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ [VERSION_KEY]: info });
    return info;
  } catch (e) {
    return null;
  }
}
async function getVersionInfo() {
  const o = await chrome.storage.local.get(VERSION_KEY);
  return o[VERSION_KEY] || null;
}

// ---------- status for popup ----------
async function status() {
  const auth = await getAuth();
  const rec = await getRec();
  const needsReauth = await getNeedsReauth();
  const queued = await queueLength();
  const syncObj = await chrome.storage.local.get(SYNC_KEY);
  const lastSyncAt = syncObj[SYNC_KEY] || null;
  const vinfo = await getVersionInfo();
  const installed = chrome.runtime.getManifest().version;
  const updateAvailable = !!(vinfo && cmpVer(installed, vinfo.latest) < 0);
  const mustUpdate = !!(vinfo && cmpVer(installed, vinfo.min) < 0);
  let elapsed = 0;
  if (rec && rec.startedAt) elapsed = Math.round((Date.now() - rec.startedAt) / 1000);
  return {
    loggedIn: !!auth,
    email: auth ? auth.email : null,
    needsReauth,
    clockedIn: !!rec,
    paused: !!(rec && rec.paused),
    pausedAt: rec && rec.pausedAt ? rec.pausedAt : null,
    startedAt: rec && rec.startedAt ? rec.startedAt : null,
    clientId: rec && rec.clientId ? rec.clientId : null,
    onIdle: !!(rec && rec.idleStart),
    currentApp: rec && rec.activity ? rec.activity.app : null,
    elapsedSec: elapsed,
    queued,
    lastSyncAt,
    online: (typeof navigator !== "undefined") ? navigator.onLine !== false : true,
    version: installed,
    updateAvailable,
    mustUpdate,
    latestVersion: vinfo ? vinfo.latest : null,
    installUrl: vinfo ? vinfo.install_url : null,
  };
}

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "wt-status": sendResponse(await status()); break;
      case "wt-login": sendResponse(await login(msg.email, msg.password)); break;
      case "wt-logout": {
        const rec = await getRec();
        if (rec) await clockOut();
        await setAuth(null);
        await setNeedsReauth(false);
        sendResponse(await status());
        break;
      }
      case "wt-clients": sendResponse(await listClients()); break;
      case "wt-clock-in": sendResponse(await clockIn(msg.clientId)); break;
      case "wt-clock-out": sendResponse(await clockOut()); break;
      case "wt-toggle-pause": sendResponse(await togglePause(msg.breakType)); break;
      case "wt-flush-now": await flushQueue(); sendResponse(await status()); break;
      case "wt-check-update": await checkForUpdate(); sendResponse(await status()); break;
      case "wt-click": await handleClick(msg.meta); sendResponse({ ok: true }); break;
      case "wt-interaction": await noteInteraction(msg.kind); sendResponse({ ok: true }); break;
      default: sendResponse({ ok: false });
    }
  })();
  return true;
});

// ---------- lifecycle: revival, install, online, suspend ----------
async function bootstrap() {
  // IMPORTANT: never force-reset alarms on revival — that resets the period
  // start and the screenshot alarm (5 min) would never fire because the SW
  // revives more frequently than once per 5 minutes. ensureAlarm() is a no-op
  // when the alarm already exists with the correct period.
  const rec = await getRec();
  if (rec) {
    setBadge(rec.paused ? "paused" : "rec");
    await armAlarms({ force: false });
    await recoverFromGapIfNeeded();
  } else {
    setBadge("off");
    await ensureAlarm("wt-flush-queue", 0.5);
  }
  await ensureAlarm("wt-version-check", 360);
  flushQueue().catch(() => {});
  checkForUpdate().catch(() => {});
  // Apply any commands the web issued while the SW was asleep.
  pollSessionCommands().catch(() => {});
}

chrome.runtime.onStartup.addListener(() => { bootstrap().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { bootstrap().catch(() => {}); });

// `online` events fire in the SW global when the network comes back.
if (typeof self !== "undefined" && self.addEventListener) {
  self.addEventListener("online", () => { flushQueue().catch(() => {}); });
}

chrome.runtime.onSuspend.addListener(() => {
  // Best-effort: try one flush. The SW gets ~30s of grace.
  flushQueue().catch(() => {});
});

// Run bootstrap on every cold start of the SW (top-level executes on revival).
bootstrap().catch(() => {});
