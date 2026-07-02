// Preload for the popup + options windows — the secure bridge.
//
// It re-implements the small slice of the `chrome.*` API that popup.js and
// options.js use, backed by ipcRenderer. This lets those two files remain
// byte-for-byte the extension's originals (preserving the UI and flows exactly)
// while the calls are serviced by the Electron main process.

const { contextBridge, ipcRenderer } = require("electron");

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(flag + "="));
  return hit ? hit.slice(flag.length + 1) : "";
}
const APP_VERSION = argValue("--clockwork-version") || "1.0.0";

const chromeShim = {
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

contextBridge.exposeInMainWorld("chrome", chromeShim);

// A couple of desktop-only conveniences the renderer may use.
contextBridge.exposeInMainWorld("clockworkDesktop", {
  openBrowser: () => ipcRenderer.invoke("open-browser"),
  openDashboard: () => ipcRenderer.invoke("open-dashboard"),
  version: APP_VERSION,
});
