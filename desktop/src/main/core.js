// ClockWork Desktop — core capture + sync engine (Electron main process).
//
// This is a faithful port of the Chrome extension's background.js (v0.4.13).
// ALL business logic is preserved verbatim: the ingest payload shapes, session
// lifecycle, offline queue + backoff, auth/refresh/re-auth resilience,
// sleep/wake recovery, engagement sampling, on-demand capture requests,
// web->desktop session-command sync, and version checking.
//
// Only the PLATFORM bindings change (see the injected `P` object):
//   chrome.storage.local        -> store          (electron-store)
//   chrome.alarms               -> scheduler      (timers)
//   chrome.action (badge)       -> tray
//   chrome.idle                 -> tracker (powerMonitor)
//   chrome.tabs/windows (active)-> tracker.getActiveTarget / getCaptureTarget
//   chrome.tabs.captureVisibleTab-> screenshot (capturePage / desktopCapturer)
//   chrome.scripting (recorder) -> injected by the in-app browser's webview preload
//   chrome.runtime.getManifest  -> app.getVersion()
//   navigator.onLine            -> net.isOnline()
//   chrome.tabs.create          -> shell.openExternal

const C = require("../shared/config");

// Platform services injected by main.js at startup.
let P = null;
function init(platform) {
  P = platform;
  P.scheduler.onAlarm((alarm) => onAlarm(alarm));
  P.tracker.setHooks({
    onActiveTargetChanged: () => onActiveTargetChanged(),
    onIdleStateChanged: (state) => onIdleStateChanged(state),
    onResume: () => onResume(),
  });
}

// Convenience aliases so the ported body reads like the original.
const store = () => P.store; // store.get/set/remove
const alarms = () => P.scheduler;
const action = () => P.tray;

// ---------- settings ----------
async function getSettings() {
  const { settings } = await P.store.get("settings");
  return { ...C.DEFAULTS, ...(settings || {}) };
}

// ---------- auth ----------
async function getAuth() {
  const { auth } = await P.store.get("auth");
  return auth || null;
}
async function setAuth(auth) {
  if (auth) await P.store.set({ auth });
  else await P.store.remove("auth");
}
async function setNeedsReauth(v) {
  if (v) await P.store.set({ [C.REAUTH_KEY]: true });
  else await P.store.remove(C.REAUTH_KEY);
}
async function getNeedsReauth() {
  const o = await P.store.get(C.REAUTH_KEY);
  return !!o[C.REAUTH_KEY];
}

async function login(email, password) {
  try {
    const res = await fetch(`${C.AUTH_URL}?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON },
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
    flushQueue().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

async function refreshToken(auth) {
  const res = await fetch(`${C.AUTH_URL}?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
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
  const o = await P.store.get(C.QUEUE_KEY);
  return Array.isArray(o[C.QUEUE_KEY]) ? o[C.QUEUE_KEY] : [];
}
async function setQueue(q) {
  await P.store.set({ [C.QUEUE_KEY]: q });
}
async function queueLength() {
  return (await getQueue()).length;
}
async function enqueue(payload) {
  const q = await getQueue();
  q.push({ payload, queuedAt: Date.now(), attempts: 0 });
  if (q.length > C.QUEUE_MAX) {
    const dropped = q.length - C.QUEUE_MAX;
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

    while (q.length) {
      const head = q[0];
      const r = await rawIngest(head.payload, token);
      if (r.ok) {
        q.shift();
        await setQueue(q);
        await P.store.set({ [C.SYNC_KEY]: Date.now() });
        continue;
      }
      if (r.status === 401) {
        await setNeedsReauth(true);
        break;
      }
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
    const res = await fetch(C.INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: C.SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

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
    await P.store.set({ [C.SYNC_KEY]: Date.now() });
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
  const { rec } = await P.store.get("rec");
  return rec || null;
}
async function setRec(rec) {
  if (rec) await P.store.set({ rec });
  else await P.store.remove("rec");
}

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
  if (!rec) {
    action().setBadgeText({ text: "" });
    return;
  }
  if (rec.paused) {
    action().setBadgeText({ text: "II" });
    action().setBadgeBackgroundColor({ color: "#b45309" });
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() - (rec.startedAt || Date.now())) / 1000));
  action().setBadgeText({ text: fmtBadgeTime(sec) });
  action().setBadgeBackgroundColor({ color: rec.idleStart ? "#b45309" : "#16a34a" });
}
function setBadge(state) {
  if (state === "rec") {
    action().setBadgeText({ text: "0m" });
    action().setBadgeBackgroundColor({ color: "#16a34a" });
    updateBadgeLive();
  } else if (state === "paused") {
    action().setBadgeText({ text: "II" });
    action().setBadgeBackgroundColor({ color: "#b45309" });
  } else {
    action().setBadgeText({ text: "" });
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return "";
  }
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
      `${C.SUPABASE_URL}/rest/v1/clients?select=id,name&archived=eq.false&order=name.asc`,
      { headers: { apikey: C.SUPABASE_ANON, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

// ---------- alarms ----------
async function ensureAlarm(name, periodInMinutes) {
  const existing = alarms().get(name);
  if (existing && Math.abs((existing.periodInMinutes || 0) - periodInMinutes) < 0.001) return;
  if (existing) alarms().clear(name);
  alarms().create(name, {
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
    for (const [name] of specs) alarms().clear(name);
  }
  for (const [name, period] of specs) await ensureAlarm(name, period);
}
async function clearRecordingAlarms() {
  alarms().clear("wt-heartbeat");
  alarms().clear("wt-shot");
  alarms().clear("wt-capreq");
  alarms().clear("wt-engage");
  alarms().clear("wt-flush");
  // keep wt-flush-queue + wt-version-check running
}

// ---------- clock in / out ----------
async function clockIn(clientId) {
  if (await getNeedsReauth()) return { error: "Please sign in again." };
  const token = await getToken();
  if (!token) return { error: "Please log in first." };
  const body = { kind: "session_start", source: "desktop" };
  if (clientId) body.client_id = clientId;
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
  await P.store.remove("clickBuffer");

  const s = await getSettings();
  P.tracker.setIdleThreshold(Math.max(15, Number(s.idleSeconds) || 300));
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
              app: a.app,
              title: a.title,
              url: a.url,
              started_at: new Date(a.startedAt).toISOString(),
              duration_sec: dur,
            });
          }
        }
        await flushWorkflowFor(rec.sessionId);
        try {
          await ingest({ kind: "break_end", session_id: rec.sessionId });
        } catch (e) {}
        await ingest({ kind: "session_end", session_id: rec.sessionId });
      }
      await flushQueue();
    } catch (e) {
      /* non-fatal */
    }
  })();
  return await status();
}

async function togglePause(breakType) {
  const rec = await getRec();
  if (!rec) return await status();
  if (!rec.paused) {
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
              kind: "activity",
              session_id: sessionId,
              app: activity.app,
              title: activity.title,
              url: activity.url,
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
    try {
      await ingest({ kind: "break_end", session_id: rec.sessionId });
    } catch (e) {}
    await startActivityFromActiveTab();
    await injectActiveTab();
  }
  return await status();
}

// ---------- activity tracking ----------
// Chrome tab/window focus is replaced by the tracker's normalised active target
// (OS foreground window, or the focused in-app browser tab).
async function startActivityFromActiveTab() {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const t = await P.tracker.getActiveTarget();
  if (!t) {
    rec.activity = null;
    await setRec(rec);
    return;
  }
  const s = await getSettings();
  if (t.kind === "web") {
    if (!/^https?:\/\//i.test(t.url || "")) {
      rec.activity = null;
      await setRec(rec);
      return;
    }
    if (isBlocked(t.url, s.blocklist)) {
      rec.activity = null;
      await setRec(rec);
      return;
    }
    rec.activity = {
      app: hostOf(t.url),
      title: (t.title || "").slice(0, 500),
      url: t.url.slice(0, 1000),
      startedAt: Date.now(),
    };
  } else {
    // Native OS window: there is no URL, so the URL-based blocklist does not
    // apply. The app name + window title are the activity identity.
    rec.activity = {
      app: (t.app || "").slice(0, 200),
      title: (t.title || "").slice(0, 500),
      url: null,
      startedAt: Date.now(),
    };
  }
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
      app: a.app,
      title: a.title,
      url: a.url,
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

function targetKey(t) {
  if (!t) return "";
  return t.kind === "web" ? t.url || "" : (t.app || "") + "|" + (t.title || "");
}
function activityKey(a) {
  if (!a) return "";
  return a.url ? a.url : (a.app || "") + "|" + (a.title || "");
}

async function onActiveTargetChanged() {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const t = await P.tracker.getActiveTarget();
  if (rec.activity && activityKey(rec.activity) === targetKey(t)) return;
  await finalizeActivity();
  await startActivityFromActiveTab();
}

// ---------- idle ----------
async function onIdleStateChanged(state) {
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
    await recoverFromGapIfNeeded();
    const stillRec = await getRec();
    if (stillRec) {
      await startActivityFromActiveTab();
      await injectActiveTab();
    }
  }
}

// OS resume / unlock — faithful replacement for the extension's onStartup +
// idle "active" wake path.
async function onResume() {
  await recoverFromGapIfNeeded();
  const rec = await getRec();
  if (rec) {
    await startActivityFromActiveTab();
    await injectActiveTab();
  }
  flushQueue().catch(() => {});
  pollSessionCommands().catch(() => {});
}

// ---------- sleep / wake recovery ----------
async function recoverFromGapIfNeeded() {
  const rec = await getRec();
  if (!rec) return;
  const s = await getSettings();
  const timeoutMs = Math.max(60, Number(s.sessionTimeoutMin) || 10) * 60_000;
  const last = rec.lastActivityAt || rec.startedAt || Date.now();
  const gap = Date.now() - last;
  if (gap <= timeoutMs) return;
  console.log(`[ClockWork] long gap (${Math.round(gap / 1000)}s) — closing session at last activity`);
  await clearRecordingAlarms();
  const sessionId = rec.sessionId;
  await setRec(null);
  setBadge("off");
  try {
    await ingest({ kind: "session_end", session_id: sessionId });
  } catch (e) {}
}

// ---------- alarms tick ----------
async function onAlarm(alarm) {
  if (alarm.name === "wt-flush-queue") {
    await flushQueue();
    return;
  }
  if (alarm.name === "wt-version-check") {
    await checkForUpdate().catch(() => {});
    return;
  }

  await recoverFromGapIfNeeded();

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
}

async function maybeSelfHealScreenshot(trigger) {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const s = await getSettings();
  const shotMin = Math.max(1, Number(s.shotMinutes) || 5);
  const staleMs = Math.round(1.5 * shotMin * 60_000);
  const last = await getLastShotAt();
  const ref = Math.max(last, rec.startedAt || 0);
  if (Date.now() - ref < staleMs) return;
  console.log(`[ClockWork] self-heal screenshot (trigger=${trigger}, gap=${Math.round((Date.now() - ref) / 1000)}s)`);
  const r = await takeScreenshot({ trigger: "self-heal:" + trigger });
  if (!r.ok) console.log("[ClockWork] self-heal result:", r.reason);
}

// ---------- engagement sampling ----------
async function resetEngagementWindow() {
  await P.store.set({
    engageWin: { startedAt: Date.now(), click: 0, key: 0, scroll: 0 },
  });
}
async function noteInteraction(kind) {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const { engageWin } = await P.store.get("engageWin");
  const w = engageWin || { startedAt: Date.now(), click: 0, key: 0, scroll: 0 };
  if (kind === "click") w.click++;
  else if (kind === "key") w.key++;
  else if (kind === "scroll") w.scroll++;
  await P.store.set({ engageWin: w });
  await bumpLocalActivity();
}
async function flushEngagementSample() {
  const rec = await getRec();
  if (!rec || !rec.sessionId || rec.paused) return;

  const { engageWin } = await P.store.get("engageWin");
  const w = engageWin || { startedAt: Date.now() - 60_000, click: 0, key: 0, scroll: 0 };
  const elapsed = Math.max(1, Math.min(600, Math.round((Date.now() - w.startedAt) / 1000)));
  await resetEngagementWindow();
  // In-app interactions come from the browser recorder (click/key/scroll pings).
  // For native OS work there is no content-script surface, so we also treat the
  // window as "interacted" when the OS reports the user was active within it —
  // the desktop-native equivalent of the extension's activity pings, preserving
  // the active-vs-idle semantic of the engagement sample.
  const interacted = w.click + w.key + w.scroll > 0 || P.tracker.systemActiveWithin(elapsed);
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
  } catch (e) {
    warnOnce("engagement_ingest_failed", e && e.message);
  }
}

// Throttled warning logger.
const _warnedAt = {};
function warnOnce(key, ...args) {
  const now = Date.now();
  if (_warnedAt[key] && now - _warnedAt[key] < 5 * 60_000) return;
  _warnedAt[key] = now;
  console.warn("[ClockWork]", key, ...args);
}

async function getLastShotAt() {
  const o = await P.store.get(C.LAST_SHOT_KEY);
  return Number(o[C.LAST_SHOT_KEY]) || 0;
}
async function setLastShotAt(ts) {
  await P.store.set({ [C.LAST_SHOT_KEY]: ts });
}
// Last screenshot outcome, surfaced in the popup so the VA can see capture is
// working (or why it isn't).
async function setLastShotResult(ok, reason) {
  await P.store.set({ "wt-last-shot-result": { ok: !!ok, reason: reason || null, at: Date.now() } });
}
async function getLastShotResult() {
  const o = await P.store.get("wt-last-shot-result");
  return o["wt-last-shot-result"] || null;
}

async function takeScreenshot(opts) {
  const trigger = (opts && opts.trigger) || "alarm";
  const rec = await getRec();
  if (!rec || rec.paused) {
    warnOnce("shot_skip_not_recording", trigger);
    return { ok: false, reason: "not_recording" };
  }
  const target = P.tracker.getCaptureTarget();
  const s = await getSettings();
  let dataUrl = null;
  if (target.kind === "web" && !isBlocked(target.url, s.blocklist)) {
    // Try the focused in-app browser tab first.
    try {
      dataUrl = await P.screenshot.captureWebContents(target.webContentsId, 55);
    } catch (e) {
      warnOnce("shot_web_capture_err", trigger, e && e.message);
    }
  }
  // Default / fallback: capture the whole screen (the reliable path). This also
  // covers the case where the in-app web tab couldn't be captured.
  if (!dataUrl) {
    try {
      dataUrl = await P.screenshot.captureScreen(55);
    } catch (e) {
      warnOnce("shot_screen_capture_err", trigger, e && e.message);
    }
  }
  if (!dataUrl) {
    warnOnce("shot_skip_capture_failed", trigger);
    await setLastShotResult(false, "capture_failed");
    return { ok: false, reason: "capture_failed" };
  }
  try {
    const payload = { kind: "screenshot", session_id: rec.sessionId, data_url: dataUrl };
    if (opts && opts.captureRequestId) payload.capture_request_id = opts.captureRequestId;
    const r = await ingest(payload);
    if (r.ok || r.queued) await setLastShotAt(Date.now());
    if (!r.ok && !r.queued) warnOnce("shot_skip_upload_failed", trigger, r.status);
    await setLastShotResult(!!(r.ok || r.queued), r.ok ? "ok" : r.queued ? "queued" : "upload_failed" + (r.status ? ":" + r.status : ""));
    return { ok: !!r.ok, reason: r.ok ? null : r.queued ? "queued" : "upload_failed" };
  } catch (e) {
    warnOnce("shot_skip_ingest_exception", trigger, e && e.message);
    await setLastShotResult(false, "ingest_failed");
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
    const url =
      `${C.SUPABASE_URL}/rest/v1/capture_requests` +
      `?select=id,expires_at,status` +
      `&va_id=eq.${encodeURIComponent(auth.user_id)}` +
      `&status=eq.pending` +
      `&order=created_at.asc&limit=5`;
    const res = await fetch(url, { headers: { apikey: C.SUPABASE_ANON, Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    rows = await res.json();
  } catch (e) {
    return;
  }
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
      `${C.SUPABASE_URL}/rest/v1/capture_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
      {
        method: "PATCH",
        headers: {
          apikey: C.SUPABASE_ANON,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(body),
      }
    );
  } catch (e) {}
}

// ---------- web -> desktop session commands ----------
async function pollSessionCommands() {
  const auth = await getAuth();
  if (!auth || !auth.user_id) return;
  const token = await getToken();
  if (!token) return;
  let rows;
  try {
    const url =
      `${C.SUPABASE_URL}/rest/v1/session_commands` +
      `?select=id,command,session_id,expires_at,status` +
      `&va_id=eq.${encodeURIComponent(auth.user_id)}` +
      `&status=eq.pending` +
      `&order=created_at.asc&limit=10`;
    const res = await fetch(url, { headers: { apikey: C.SUPABASE_ANON, Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    rows = await res.json();
  } catch (e) {
    return;
  }
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
async function markSessionCommand(id, statusStr) {
  const token = await getToken();
  if (!token) return;
  const body = { status: statusStr, applied_at: new Date().toISOString() };
  try {
    await fetch(
      `${C.SUPABASE_URL}/rest/v1/session_commands?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
      {
        method: "PATCH",
        headers: {
          apikey: C.SUPABASE_ANON,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(body),
      }
    );
  } catch (e) {}
}
async function applySessionCommandLocally(command, sessionId) {
  const rec = await getRec();
  if (!rec) return;
  if (sessionId && rec.sessionId && sessionId !== rec.sessionId && command !== "clock_out") return;

  if (command === "clock_out") {
    console.log("[ClockWork] applying web command: clock_out");
    await clearRecordingAlarms();
    try {
      if (rec.activity) {
        const a = rec.activity;
        const dur = Math.round((Date.now() - a.startedAt) / 1000);
        if (dur >= 1) {
          await ingest({
            kind: "activity",
            session_id: rec.sessionId,
            app: a.app,
            title: a.title,
            url: a.url,
            started_at: new Date(a.startedAt).toISOString(),
            duration_sec: dur,
          });
        }
      }
      await flushWorkflowFor(rec.sessionId);
    } catch (e) {}
    await setRec(null);
    setBadge("off");
    await P.store.remove("clickBuffer");
    flushQueue().catch(() => {});
  } else if (command === "break_start") {
    if (rec.paused) return;
    console.log("[ClockWork] applying web command: break_start");
    const activity = rec.activity;
    rec.paused = true;
    rec.pausedAt = Date.now();
    rec.activity = null;
    await setRec(rec);
    setBadge("paused");
    try {
      if (activity) {
        const dur = Math.round((Date.now() - activity.startedAt) / 1000);
        if (dur >= 1) {
          await ingest({
            kind: "activity",
            session_id: rec.sessionId,
            app: activity.app,
            title: activity.title,
            url: activity.url,
            started_at: new Date(activity.startedAt).toISOString(),
            duration_sec: dur,
          });
        }
      }
      await flushWorkflowFor(rec.sessionId);
    } catch (e) {}
  } else if (command === "break_end") {
    if (!rec.paused) return;
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

// ---------- click-trails -> workflows ----------
// In the extension these functions injected recorder.js into browser tabs. In
// the desktop app the recorder is always present in the in-app browser (loaded
// by the webview preload), so injection is a no-op — clicks arrive via the
// wt-click message and are buffered here identically.
async function injectTab() {}
async function injectActiveTab() {}
async function injectAllTabs() {}

async function getBuffer() {
  const { clickBuffer } = await P.store.get("clickBuffer");
  return clickBuffer || null;
}
async function setBuffer(b) {
  if (b) await P.store.set({ clickBuffer: b });
  else await P.store.remove("clickBuffer");
}

async function handleClick(meta, senderWebContents) {
  const rec = await getRec();
  if (!rec || rec.paused) return;
  const s = await getSettings();
  if (isBlocked(meta.url, s.blocklist)) return;

  const host = hostOf(meta.url);
  const now = Date.now();
  let buf = await getBuffer();
  const boundary =
    buf &&
    (buf.host !== host ||
      now - buf.lastAt > s.workflowGapSec * 1000 ||
      buf.items.length >= s.workflowMaxSteps);
  if (boundary) {
    await flushWorkflow();
    buf = null;
  }
  let shot = null;
  try {
    if (senderWebContents && !senderWebContents.isDestroyed() && /^https?:\/\//i.test(meta.url || "")) {
      shot = await P.screenshot.captureFrom(senderWebContents, 45);
    }
  } catch (e) {
    warnOnce("click_shot_failed", e && e.message);
  }
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

  alarms().clear("wt-flush");
  alarms().create("wt-flush", { delayInMinutes: Math.max(0.5, s.workflowGapSec / 60) });
}

async function flushWorkflow() {
  const rec = await getRec();
  await flushWorkflowFor(rec ? rec.sessionId : null);
}
async function flushWorkflowFor(sessionId) {
  const buf = await getBuffer();
  if (!buf || !buf.items.length) {
    await setBuffer(null);
    return;
  }
  if (!sessionId) {
    await setBuffer(null);
    return;
  }
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
  const { settings } = await P.store.get("settings");
  const dash = settings && settings.dashboardUrl;
  return dash && /^https?:\/\//.test(dash) ? dash.replace(/\/+$/, "") : C.DEFAULT_VERSION_HOST;
}
async function checkForUpdate() {
  const host = await versionHost();
  try {
    const res = await fetch(`${host}/api/public/desktop-version`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.latest) return null;
    const info = {
      latest: String(data.latest),
      min: String(data.min || data.latest),
      install_url: String(data.install_url || `${host}/install`),
      checkedAt: Date.now(),
    };
    await P.store.set({ [C.VERSION_KEY]: info });
    return info;
  } catch (e) {
    return null;
  }
}
async function getVersionInfo() {
  const o = await P.store.get(C.VERSION_KEY);
  return o[C.VERSION_KEY] || null;
}

// ---------- status for popup ----------
async function status() {
  const auth = await getAuth();
  const rec = await getRec();
  const needsReauth = await getNeedsReauth();
  const queued = await queueLength();
  const syncObj = await P.store.get(C.SYNC_KEY);
  const lastSyncAt = syncObj[C.SYNC_KEY] || null;
  const vinfo = await getVersionInfo();
  const installed = P.appVersion();
  const updateAvailable = !!(vinfo && cmpVer(installed, vinfo.latest) < 0);
  const mustUpdate = !!(vinfo && cmpVer(installed, vinfo.min) < 0);
  let elapsed = 0;
  if (rec && rec.startedAt) elapsed = Math.round((Date.now() - rec.startedAt) / 1000);
  const lastShotAt = await getLastShotAt();
  const lastShot = await getLastShotResult();
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
    lastShotAt: lastShotAt || null,
    lastShot: lastShot || null,
    online: P.isOnline(),
    version: installed,
    updateAvailable,
    mustUpdate,
    latestVersion: vinfo ? vinfo.latest : null,
    installUrl: vinfo ? vinfo.install_url : null,
  };
}

// Manual capture test — proves screen capture works on this machine, and (if
// clocked in) uploads the shot so it appears on the dashboard.
async function testShot() {
  let dataUrl = null;
  try {
    dataUrl = await P.screenshot.captureScreen(55);
  } catch (e) {
    await setLastShotResult(false, "capture_error");
    return { ok: false, reason: "Capture error: " + (e && e.message) };
  }
  if (!dataUrl) {
    await setLastShotResult(false, "capture_empty");
    return { ok: false, reason: "Capture returned empty (screen recording blocked?)" };
  }
  const kb = Math.round(dataUrl.length / 1024);
  const rec = await getRec();
  if (rec && !rec.paused) {
    const r = await ingest({ kind: "screenshot", session_id: rec.sessionId, data_url: dataUrl });
    if (r.ok) {
      await setLastShotAt(Date.now());
      await setLastShotResult(true, "ok");
      return { ok: true, reason: `Captured ${kb}KB and uploaded ✓` };
    }
    if (r.queued) {
      await setLastShotResult(true, "queued");
      return { ok: true, reason: `Captured ${kb}KB, queued (offline) — will upload` };
    }
    await setLastShotResult(false, "upload_failed");
    return { ok: false, reason: `Captured ${kb}KB but upload failed (${r.status || r.error || "?"})` };
  }
  await setLastShotResult(true, "capture_only");
  return { ok: true, reason: `Capture works (${kb}KB). Clock in to upload screenshots.` };
}

// ---------- message router ----------
// Faithful port of chrome.runtime.onMessage. Returns the response value
// (main.js wires this to ipcMain.handle). `sender` is the webContents that
// sent the message (used to capture click-trail step screenshots).
async function handleMessage(msg, sender) {
  switch (msg && msg.type) {
    case "wt-status":
      return await status();
    case "wt-login":
      return await login(msg.email, msg.password);
    case "wt-logout": {
      const rec = await getRec();
      if (rec) await clockOut();
      await setAuth(null);
      await setNeedsReauth(false);
      return await status();
    }
    case "wt-clients":
      return await listClients();
    case "wt-clock-in":
      return await clockIn(msg.clientId);
    case "wt-clock-out":
      return await clockOut();
    case "wt-toggle-pause":
      return await togglePause(msg.breakType);
    case "wt-test-shot":
      return await testShot();
    case "wt-flush-now":
      await flushQueue();
      return await status();
    case "wt-check-update":
      await checkForUpdate();
      return await status();
    case "wt-click":
      await handleClick(msg.meta, sender);
      return { ok: true };
    case "wt-interaction":
      await noteInteraction(msg.kind);
      return { ok: true };
    default:
      return { ok: false };
  }
}

// ---------- lifecycle ----------
async function bootstrap() {
  const rec = await getRec();
  if (rec) {
    setBadge(rec.paused ? "paused" : "rec");
    const s = await getSettings();
    P.tracker.setIdleThreshold(Math.max(15, Number(s.idleSeconds) || 300));
    await armAlarms({ force: false });
    await recoverFromGapIfNeeded();
  } else {
    setBadge("off");
    await ensureAlarm("wt-flush-queue", 0.5);
  }
  await ensureAlarm("wt-version-check", 360);
  flushQueue().catch(() => {});
  checkForUpdate().catch(() => {});
  pollSessionCommands().catch(() => {});
}

module.exports = { init, bootstrap, handleMessage, status, clockOut };
