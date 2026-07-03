// ClockWork Desktop — Electron main process entry point.
//
// Responsibilities:
//   * Create the app windows: the popup (the extension's toolbar popup, verbatim
//     UI), the options window (verbatim), and the in-app browser (the embedded
//     capture surface for click-trail SOPs).
//   * Own the tray icon (replaces the toolbar action).
//   * Wire IPC (ipcMain) — the Electron equivalent of chrome.runtime messaging.
//   * Inject platform services into the ported core engine and boot it.

const { app, BrowserWindow, ipcMain, shell, net, Menu } = require("electron");
const path = require("path");

const store = require("./store");
const scheduler = require("./scheduler");
const tracker = require("./tracker");
const screenshot = require("./screenshot");
const tray = require("./tray");
const core = require("./core");

const RENDERER = path.join(__dirname, "..", "renderer");
const PRELOAD = path.join(__dirname, "..", "preload", "preload.js");
const WEBVIEW_PRELOAD = path.join(__dirname, "..", "preload", "webview-preload.js");

let popupWin = null;
let optionsWin = null;
let browserWin = null;

// Only one instance — a tracker must be a singleton.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showPopup());
}

// ---------- windows ----------
function baseWebPrefs() {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    additionalArguments: [`--clockwork-version=${app.getVersion()}`],
  };
}

function createPopup() {
  popupWin = new BrowserWindow({
    width: 360,
    height: 640,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    skipTaskbar: true,
    title: "ClockWork",
    webPreferences: baseWebPrefs(),
  });
  popupWin.loadFile(path.join(RENDERER, "popup.html"));
  // Hide (don't destroy) on blur, mirroring a toolbar popup dismiss.
  popupWin.on("blur", () => {
    if (popupWin && !popupWin.webContents.isDevToolsOpened()) popupWin.hide();
  });
  popupWin.on("closed", () => {
    popupWin = null;
  });
}

function showPopup() {
  if (!popupWin) createPopup();
  popupWin.show();
  popupWin.focus();
}

function showOptions() {
  if (optionsWin) {
    optionsWin.show();
    optionsWin.focus();
    return;
  }
  optionsWin = new BrowserWindow({
    width: 600,
    height: 640,
    title: "ClockWork settings",
    autoHideMenuBar: true,
    webPreferences: baseWebPrefs(),
  });
  optionsWin.loadFile(path.join(RENDERER, "options.html"));
  optionsWin.on("closed", () => {
    optionsWin = null;
  });
}

function showBrowser() {
  if (browserWin) {
    browserWin.show();
    browserWin.focus();
    return;
  }
  browserWin = new BrowserWindow({
    width: 1200,
    height: 820,
    title: "ClockWork Browser",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "browser-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true, // enables the <webview> embedded browsing surface
      additionalArguments: [`--webview-preload=${WEBVIEW_PRELOAD}`],
    },
  });
  browserWin.loadFile(path.join(RENDERER, "browser.html"));
  // Track focus so the tracker prefers the embedded web tab as the activity
  // target only while the browser window is actually frontmost.
  browserWin.on("focus", () => tracker.setBrowserFocused(true));
  browserWin.on("blur", () => tracker.setBrowserFocused(false));
  browserWin.on("closed", () => {
    tracker.setBrowserFocused(false);
    tracker.setEmbeddedActive(null);
    browserWin = null;
  });
}

async function openDashboard() {
  const { settings } = await store.get("settings");
  const url = settings && settings.dashboardUrl;
  if (url) shell.openExternal(url);
  else showOptions();
}

// ---------- IPC (replaces chrome.runtime messaging) ----------
function wireIpc() {
  // Core message router — used by the popup, options, and the in-app browser's
  // webview recorder. event.sender is the webContents that sent the message
  // (the guest page for click-trail steps).
  ipcMain.handle("wt-message", (event, msg) => core.handleMessage(msg, event.sender));

  // chrome.storage.local shim.
  ipcMain.handle("storage-get", (_e, keys) => store.get(keys));
  ipcMain.handle("storage-set", (_e, obj) => store.set(obj));
  ipcMain.handle("storage-remove", (_e, key) => store.remove(key));

  // chrome.tabs.create / chrome.runtime.openOptionsPage shims.
  ipcMain.handle("open-external", (_e, url) => {
    if (url) shell.openExternal(url);
  });
  ipcMain.handle("open-options", () => showOptions());
  ipcMain.handle("open-browser", () => showBrowser());
  ipcMain.handle("open-dashboard", () => openDashboard());
  ipcMain.handle("get-version", () => app.getVersion());

  // In-app browser -> main: which web tab is active (for activity + capture).
  ipcMain.on("cw-embedded-active", (_e, info) => tracker.setEmbeddedActive(info));

  // Renderer -> main: fit the window height to the rendered content so there is
  // no empty space below the card/footer. Width is preserved.
  ipcMain.on("resize-window", (e, height) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const [w] = win.getContentSize();
    const h = Math.max(160, Math.min(1000, Math.round(Number(height) || 0)));
    if (h) win.setContentSize(w, h);
  });
}

// ---------- boot ----------
app.whenReady().then(() => {
  // No application menu (this is a tray app).
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  wireIpc();

  const platform = {
    store: store.local, // { get, set, remove }
    scheduler,
    tracker,
    screenshot,
    tray, // exposes setBadgeText / setBadgeBackgroundColor (chrome.action shim)
    appVersion: () => app.getVersion(),
    isOnline: () => {
      try {
        return net.isOnline();
      } catch (e) {
        return true;
      }
    },
    openExternal: (url) => shell.openExternal(url),
    openOptions: () => showOptions(),
  };

  core.init(platform);

  tray.create({
    openPopup: showPopup,
    openBrowser: showBrowser,
    openOptions: showOptions,
    openDashboard: openDashboard,
    quit: () => {
      app.isQuitting = true;
      app.quit();
    },
  });

  tracker.start();

  createPopup();
  showPopup();

  core.bootstrap().catch((e) => console.error("[ClockWork] bootstrap failed", e));

  app.on("activate", () => showPopup());
});

// Tray app — keep running when all windows are closed.
app.on("window-all-closed", (e) => {
  // Do nothing: the tracker lives in the tray/background.
});
