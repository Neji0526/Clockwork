// Tray / badge — the Electron equivalent of the extension's toolbar action
// (chrome.action) and its live time badge.
//
// The extension showed a colored text badge on the toolbar icon ("0m", "1h",
// "II" for paused). Native OS trays don't render colored text badges, so we
// preserve the SAME information via the tray tooltip + macOS tray title, and
// keep the exact setBadgeText / setBadgeBackgroundColor call sites in core.js
// working unchanged by implementing them here.

const { Tray, Menu, nativeImage, app } = require("electron");
const path = require("path");

let tray = null;
let badgeText = "";
let actions = {};

function iconPath() {
  return path.join(__dirname, "..", "..", "build", "icon.png");
}

function refreshTooltip() {
  if (!tray) return;
  const label = badgeText ? `ClockWork · ${badgeText}` : "ClockWork";
  tray.setToolTip(label);
  // macOS shows text beside the tray icon; use it as the live badge surface.
  if (process.platform === "darwin") tray.setTitle(badgeText ? ` ${badgeText}` : "");
}

function create(handlers) {
  actions = handlers || {};
  let img = nativeImage.createFromPath(iconPath());
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("ClockWork");
  rebuildMenu({ clockedIn: false, paused: false });
  // Left-click opens the popup, mirroring clicking the extension's toolbar icon.
  tray.on("click", () => actions.openPopup && actions.openPopup());
  return tray;
}

function rebuildMenu(st) {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Open ClockWork", click: () => actions.openPopup && actions.openPopup() },
    { label: "Open in-app browser", click: () => actions.openBrowser && actions.openBrowser() },
    { type: "separator" },
    { label: "Settings", click: () => actions.openOptions && actions.openOptions() },
    { label: "Open dashboard", click: () => actions.openDashboard && actions.openDashboard() },
    { type: "separator" },
    { label: "Quit ClockWork", click: () => actions.quit && actions.quit() },
  ]);
  tray.setContextMenu(menu);
}

// --- chrome.action-compatible shims used by core.js -----------------------
function setBadgeText(opts) {
  badgeText = (opts && opts.text) || "";
  refreshTooltip();
}
// Color has no native tray analogue; accepted for call-site parity.
function setBadgeBackgroundColor() {}

module.exports = { create, rebuildMenu, setBadgeText, setBadgeBackgroundColor };
