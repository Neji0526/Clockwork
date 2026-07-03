// Activity + idle tracker — the Electron equivalent of chrome.tabs / chrome.windows
// (active-target detection) and chrome.idle (system idle state).
//
// HYBRID MODEL (chosen migration architecture):
//   * OS-level:   the foreground application window (name + title) is the
//                 "current activity" whenever the VA is working in any app.
//                 This replaces chrome.tabs' active-tab tracking for the whole
//                 desktop. There is no URL for native apps, so url is null and
//                 the URL-based blocklist simply does not apply.
//   * Embedded:   when the ClockWork in-app browser window is focused and has an
//                 active web tab, THAT tab (host + title + url) is the current
//                 activity — url-based, blocklist applies, and DOM click-trail
//                 SOP recording works exactly as in the extension.
//
// Idle is provided natively by powerMonitor.getSystemIdleState, a faithful
// 1:1 replacement for chrome.idle. Sleep/wake is surfaced via the OS
// suspend/resume + lock/unlock events.

const { powerMonitor } = require("electron");

let activeWin = null;
try {
  // active-win is a native helper; if it fails to load we degrade gracefully to
  // "no OS window" (embedded-browser tracking still works).
  activeWin = require("active-win");
} catch (e) {
  console.warn("[ClockWork] active-win unavailable — OS window tracking disabled:", e && e.message);
}

let idleThresholdSec = 300;
let lastIdleState = "active";

let embedded = null; // { app, title, url, webContentsId } | null
let browserFocused = false;

let pollTimer = null;
let idleTimer = null;

let hooks = {
  onActiveTargetChanged: () => {},
  onIdleStateChanged: () => {},
  onResume: () => {},
};

function setHooks(h) {
  hooks = { ...hooks, ...h };
}

function setIdleThreshold(sec) {
  idleThresholdSec = Math.max(15, Number(sec) || 300);
}

// Called by the embedded browser window whenever its active tab changes /
// gains or loses focus, so the tracker can prefer the web tab as the target.
function setEmbeddedActive(info) {
  embedded = info || null;
}
function setBrowserFocused(v) {
  browserFocused = !!v;
}

// Normalised current target used for activity tracking.
//   { app, title, url, kind: "web" | "os", webContentsId? } | null
async function getActiveTarget() {
  if (browserFocused && embedded && embedded.url && /^https?:\/\//i.test(embedded.url)) {
    return {
      app: embedded.app,
      title: embedded.title || "",
      url: embedded.url,
      kind: "web",
      webContentsId: embedded.webContentsId,
    };
  }
  if (!activeWin) return null;
  try {
    const w = await activeWin();
    if (!w) return null;
    const app = (w.owner && w.owner.name) || "Unknown";
    return { app, title: w.title || "", url: null, kind: "os" };
  } catch (e) {
    return null;
  }
}

// Capture target for screenshots. Only prefer the embedded web tab when the
// in-app browser is actually the focused window; otherwise ALWAYS capture the
// full screen (the reliable, default path). This prevents a backgrounded/stale
// in-app browser tab from hijacking — and breaking — every screenshot.
function getCaptureTarget() {
  if (
    browserFocused &&
    embedded &&
    embedded.url &&
    /^https?:\/\//i.test(embedded.url) &&
    embedded.webContentsId != null
  ) {
    return { kind: "web", url: embedded.url, webContentsId: embedded.webContentsId };
  }
  return { kind: "screen" };
}

let _lastKey = null;
async function pollActive() {
  const t = await getActiveTarget();
  const key = t ? `${t.kind}|${t.app}|${t.url || t.title}` : "";
  if (key !== _lastKey) {
    _lastKey = key;
    try {
      await hooks.onActiveTargetChanged();
    } catch (e) {}
  }
}

function pollIdle() {
  let state = "active";
  try {
    state = powerMonitor.getSystemIdleState(idleThresholdSec); // "active" | "idle" | "locked"
  } catch (e) {
    return;
  }
  if (state !== lastIdleState) {
    const prev = lastIdleState;
    lastIdleState = state;
    // Collapse to the same three states chrome.idle emitted.
    hooks.onIdleStateChanged(state, prev);
  }
}

// True when the OS reports the user has been active within the given window.
function systemActiveWithin(seconds) {
  try {
    return powerMonitor.getSystemIdleTime() < Math.max(1, seconds);
  } catch (e) {
    return true;
  }
}

function start() {
  if (!pollTimer) pollTimer = setInterval(() => pollActive().catch(() => {}), 1500);
  if (!idleTimer) idleTimer = setInterval(pollIdle, 1000);

  // Sleep/wake — the faithful replacement for the extension's onStartup +
  // idle "active" recovery path.
  powerMonitor.on("resume", () => hooks.onResume("resume"));
  powerMonitor.on("unlock-screen", () => hooks.onResume("unlock"));
}

module.exports = {
  setHooks,
  setIdleThreshold,
  setEmbeddedActive,
  setBrowserFocused,
  getActiveTarget,
  getCaptureTarget,
  systemActiveWithin,
  start,
};
