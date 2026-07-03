// Preload for the popup + options windows — the secure context bridge.
//
// Exposes a minimal, namespaced `window.clockwork` API (same shape the renderer
// expects) backed by ipcRenderer. It is deliberately NOT named `chrome`:
// Chromium pre-defines a read-only `window.chrome`, and contextBridge refuses to
// bind on top of it ("Cannot bind an API on top of an existing property").
// Namespacing keeps contextIsolation:true + nodeIntegration:false intact
// (Electron security best practice) while the renderer talks to the main process.

const { contextBridge, ipcRenderer } = require("electron");

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(flag + "="));
  return hit ? hit.slice(flag.length + 1) : "";
}
const APP_VERSION = argValue("--clockwork-version") || "1.0.0";

const api = {
  runtime: {
    id: "clockwork-desktop",
    lastError: null,
    // chrome.runtime.sendMessage(msg, callback?) — returns a Promise when no
    // callback is given (both call styles are used in the ported UI).
    sendMessage: (msg, cb) => {
      const p = ipcRenderer.invoke("wt-message", msg);
      if (typeof cb === "function") {
        p.then((r) => cb(r), () => cb(undefined));
        return;
      }
      return p;
    },
    openOptionsPage: () => ipcRenderer.invoke("open-options"),
    getManifest: () => ({ version: APP_VERSION }),
  },
  storage: {
    local: {
      get: (keys) => ipcRenderer.invoke("storage-get", keys),
      set: (obj) => ipcRenderer.invoke("storage-set", obj),
      remove: (key) => ipcRenderer.invoke("storage-remove", key),
    },
  },
  tabs: {
    // chrome.tabs.create({ url }) -> open in the user's real default browser.
    create: (opts) => ipcRenderer.invoke("open-external", opts && opts.url),
  },
};

// Desktop-only conveniences the renderer may use.
api.openBrowser = () => ipcRenderer.invoke("open-browser");
api.openDashboard = () => ipcRenderer.invoke("open-dashboard");
api.version = APP_VERSION;
// Ask main to size the window to the rendered content height (no dead space).
api.resizeWindow = (height) => ipcRenderer.send("resize-window", height);

contextBridge.exposeInMainWorld("clockwork", api);
