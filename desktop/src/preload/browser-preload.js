// Preload for the in-app browser window host (browser.html / browser.js).
//
// Exposes a tiny bridge so the host page can: know where the guest <webview>
// preload lives, and report which web tab is currently active so the main
// process tracker can treat it as the activity + screenshot target.

const { contextBridge, ipcRenderer } = require("electron");

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(flag + "="));
  return hit ? hit.slice(flag.length + 1) : "";
}

contextBridge.exposeInMainWorld("cwBrowser", {
  // file:// URL of the guest recorder preload — set as the <webview> preload.
  webviewPreload: "file:///" + argValue("--webview-preload").replace(/\\/g, "/"),
  // Report the active web tab (host, title, url, guest webContents id).
  reportActive: (info) => ipcRenderer.send("cw-embedded-active", info),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
