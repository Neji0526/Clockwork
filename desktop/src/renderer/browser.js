// In-app browser host logic.
//
// Owns a single <webview> that loads the guest recorder preload
// (webview-preload.js). As the VA browses, we report the active tab (host,
// title, url, guest webContents id) to the main process so the tracker treats
// it as the current activity + screenshot + click-trail target — preserving the
// extension's browser-scoped capture with full DOM fidelity.

const HOME = "https://www.google.com";

const host = document.getElementById("host");
const urlBar = document.getElementById("url");

// Build the <webview> now that we know the guest preload path.
const view = document.createElement("webview");
view.setAttribute("src", HOME);
view.setAttribute("preload", window.cwBrowser.webviewPreload);
view.setAttribute("allowpopups", "");
view.setAttribute("partition", "persist:clockwork"); // persistent cookies/session
view.style.flex = "1";
view.style.width = "100%";
host.appendChild(view);

function normalizeInput(v) {
  const s = (v || "").trim();
  if (!s) return HOME;
  if (/^https?:\/\//i.test(s)) return s;
  // Looks like a domain? go directly; otherwise search.
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return "https://" + s;
  return "https://www.google.com/search?q=" + encodeURIComponent(s);
}

function report() {
  try {
    const url = view.getURL();
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch (e) {}
    window.cwBrowser.reportActive({
      app: hostname,
      title: view.getTitle(),
      url,
      webContentsId: view.getWebContentsId(),
    });
    urlBar.value = url;
  } catch (e) {}
}

// Navigation controls
document.getElementById("back").onclick = () => view.canGoBack() && view.goBack();
document.getElementById("fwd").onclick = () => view.canGoForward() && view.goForward();
document.getElementById("reload").onclick = () => view.reload();
urlBar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") view.loadURL(normalizeInput(urlBar.value));
});

// Report activity on every navigation / title change.
view.addEventListener("dom-ready", report);
view.addEventListener("did-navigate", report);
view.addEventListener("did-navigate-in-page", report);
view.addEventListener("page-title-updated", report);

// Open target=_blank inside the same webview rather than a new OS window.
view.addEventListener("new-window", (e) => {
  if (e.url) view.loadURL(e.url);
});
