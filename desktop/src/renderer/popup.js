const $ = (id) => document.getElementById(id);
const VIEWS = ["view-signin", "view-reauth", "view-out", "view-rec", "view-break"];

function show(id) {
  for (const v of VIEWS) {
    const el = $(v);
    if (!el) continue;
    if (v === id) {
      if (el.classList.contains("hidden")) {
        el.classList.remove("hidden");
        el.classList.remove("fade"); void el.offsetWidth; el.classList.add("fade");
      }
    } else el.classList.add("hidden");
  }
}

function send(type, extra) {
  return new Promise((resolve) => clockwork.runtime.sendMessage({ type, ...(extra || {}) }, resolve));
}

function fmtHMS(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
function fmtMS(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function fmtAgo(ms) {
  if (!ms) return "Not yet synced";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "Synced just now";
  if (s < 60) return `Last synced ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Last synced ${m}m ago`;
  const h = Math.floor(m / 60);
  return `Last synced ${h}h ago`;
}

function pillsHTML(st) {
  const out = [];
  if (!st.online) out.push('<span class="pill red">● offline</span>');
  if (st.queued > 0) out.push(`<span class="pill amber">${st.queued} queued</span>`);
  if (st.online && (st.queued || 0) === 0 && st.clockedIn && !st.paused) out.push('<span class="pill green">live</span>');
  return out.join(" ");
}

// Inject (or remove) an "Update available" banner at the top of the active view.
function renderUpdateBanner(viewId) {
  // Clear from every view first so stale banners don't linger.
  document.querySelectorAll(".update-banner").forEach((n) => n.remove());
  if (!st || !st.updateAvailable) return;
  const view = document.getElementById(viewId);
  if (!view) return;
  const wrap = view.querySelector(".wrap");
  if (!wrap) return;
  const installUrl = st.installUrl || "";
  const hard = !!st.mustUpdate;
  const div = document.createElement("div");
  div.className = "banner update-banner " + (hard ? "err" : "warn");
  div.innerHTML = `
    <span class="ic">${hard ? "⚠" : "↻"}</span>
    <div style="flex:1; min-width:0;">
      <b>${hard ? "Update required" : "New version available"}</b>
      You're on v${st.version}. Latest is v${st.latestVersion}.
      <a class="upd-link" style="color:var(--gold); text-decoration:underline; cursor:pointer; display:inline-block; margin-top:4px;">
        Open install page →
      </a>
    </div>
  `;
  const link = div.querySelector(".upd-link");
  link.onclick = () => {
    if (installUrl) clockwork.tabs.create({ url: installUrl });
    else toast("Set the dashboard URL in Settings");
  };
  // Insert at top of wrap, after header if present.
  const hdr = wrap.querySelector(".hdr");
  if (hdr && hdr.nextSibling) wrap.insertBefore(div, hdr.nextSibling);
  else wrap.insertBefore(div, wrap.firstChild);
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 1800);
}

let tick = null;
let st = null;
let clientName = "No client";
let clientsCache = [];
let clientsLoaded = false;

function startTicker() {
  if (tick) clearInterval(tick);
  tick = setInterval(updateLive, 1000);
}

function updateLive() {
  if (!st) return;
  if (st.clockedIn && !st.paused && st.startedAt) {
    const sec = Math.floor((Date.now() - st.startedAt) / 1000);
    if ($("timerRec")) $("timerRec").textContent = fmtHMS(sec);
  }
  if (st.clockedIn && st.paused && st.pausedAt) {
    const sec = Math.floor((Date.now() - st.pausedAt) / 1000);
    if ($("breakTimer")) $("breakTimer").textContent = fmtMS(sec);
  }
  if ($("syncRec")) $("syncRec").textContent = fmtAgo(st.lastSyncAt);
  if ($("syncOut")) $("syncOut").textContent = st.lastSyncAt ? fmtAgo(st.lastSyncAt) : "Ready";
  if ($("syncBreak")) $("syncBreak").textContent = "Paused · " + fmtAgo(st.lastSyncAt);
}

function buildFooter(elId, includeLogout = true) {
  const el = $(elId);
  if (!el) return;
  el.innerHTML = `
    <a data-act="dash">Dashboard</a>
    <a data-act="settings">Settings</a>
    ${includeLogout ? '<a data-act="logout">Sign out</a>' : ''}
    <span class="sp"></span>
    <span>v${(st && st.version) || ""}</span>
  `;
  el.querySelectorAll("a").forEach(a => a.onclick = onFootAct);
}

async function onFootAct(e) {
  const act = e.currentTarget.getAttribute("data-act");
  if (act === "dash") {
    const { settings } = await clockwork.storage.local.get("settings");
    const url = (settings && settings.dashboardUrl) || "";
    if (url) clockwork.tabs.create({ url });
    else toast("Set the dashboard URL in Settings");
  } else if (act === "settings") {
    if (clockwork.runtime.openOptionsPage) clockwork.runtime.openOptionsPage();
  } else if (act === "logout") {
    st = await send("wt-logout");
    await refresh();
  }
}

async function loadClients(selectedId) {
  if (!clientsLoaded) {
    clientsCache = (await send("wt-clients")) || [];
    clientsLoaded = true;
  }
  const sel = $("client");
  if (!sel) return;
  sel.innerHTML = '<option value="">— No client —</option>' +
    clientsCache.map(c => `<option value="${c.id}">${(c.name || "").replace(/</g, "&lt;")}</option>`).join("");
  const { wtLastClient } = await clockwork.storage.local.get("wtLastClient");
  const want = selectedId || wtLastClient;
  if (want) sel.value = want;
}

function clientNameFor(id) {
  if (!id) return "No client";
  const c = clientsCache.find(x => x.id === id);
  return c ? c.name : "Client";
}

function shotStatusText(st) {
  const res = st && st.lastShot;
  const at = st && st.lastShotAt;
  if (res && res.ok === false) return "⚠ Screenshot failed: " + (res.reason || "error");
  if (at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    const ago = s < 60 ? s + "s ago" : s < 3600 ? Math.floor(s / 60) + "m ago" : Math.floor(s / 3600) + "h ago";
    return "📷 Last screenshot " + ago;
  }
  return st && st.clockedIn ? "📷 Waiting for first screenshot…" : "📷 No screenshots yet — clock in to start";
}

async function render() {
  if (!st) return;

  // Signed out
  if (!st.loggedIn) {
    show("view-signin");
    $("verSignin").textContent = "v" + (st.version || "");
    renderUpdateBanner("view-signin");
    return;
  }

  // Re-auth needed
  if (st.needsReauth) {
    show("view-reauth");
    $("verReauth").textContent = "v" + (st.version || "");
    renderUpdateBanner("view-reauth");
    return;
  }

  // Recording
  if (st.clockedIn && !st.paused) {
    show("view-rec");
    await loadClients(st.clientId);
    $("whoRec").textContent = (st.email || "Signed in").split("@")[0];
    $("timerRec").textContent = fmtHMS(st.elapsedSec);
    $("clientRec").textContent = clientNameFor(st.clientId);
    $("appRec").textContent = st.currentApp ? "on " + st.currentApp : "Waiting for activity…";
    $("syncRec").textContent = fmtAgo(st.lastSyncAt);
    $("pillsRec").innerHTML = pillsHTML(st);
    if ($("shotRec")) $("shotRec").textContent = shotStatusText(st);
    $("retryBtn").classList.toggle("hidden", !(st.queued > 0));
    buildFooter("footRec");
    renderUpdateBanner("view-rec");
    return;
  }

  // Break
  if (st.clockedIn && st.paused) {
    show("view-break");
    $("breakTimer").textContent = fmtMS(st.pausedAt ? (Date.now() - st.pausedAt) / 1000 : 0);
    $("pillsBreak").innerHTML = pillsHTML(st);
    buildFooter("footBreak");
    renderUpdateBanner("view-break");
    return;
  }

  // Clocked out (connected)
  show("view-out");
  await loadClients();
  $("whoOut").textContent = st.email || "Signed in";
  $("pillsOut").innerHTML = pillsHTML(st);
  buildFooter("footOut");
  $("syncOut").textContent = st.lastSyncAt ? fmtAgo(st.lastSyncAt) : "Ready";
  if ($("shotOut")) $("shotOut").textContent = shotStatusText(st);
  renderUpdateBanner("view-out");

  // First-run welcome after install + sign-in
  const { wtSawWelcome } = await clockwork.storage.local.get("wtSawWelcome");
  if (!wtSawWelcome) {
    $("welcome").classList.remove("hidden");
    clockwork.storage.local.set({ wtSawWelcome: true });
  } else {
    $("welcome").classList.add("hidden");
  }
}

// Measure the currently-visible view and ask main to size the window to it,
// so there is no empty dark space below the card/footer.
let _lastFitH = 0;
function fitWindow() {
  requestAnimationFrame(() => {
    const view = VIEWS.map((v) => $(v)).find((el) => el && !el.classList.contains("hidden"));
    const el = view || document.body;
    const h = Math.ceil(el.getBoundingClientRect().height);
    if (h && h !== _lastFitH && window.clockwork && window.clockwork.resizeWindow) {
      _lastFitH = h;
      window.clockwork.resizeWindow(h);
    }
  });
}

async function refresh() {
  st = await send("wt-status");
  await render();
  fitWindow();
}

// ============ Event wiring ============
document.addEventListener("DOMContentLoaded", () => {
  $("togglePw").onclick = () => {
    const i = $("password");
    const isPw = i.type === "password";
    i.type = isPw ? "text" : "password";
    $("togglePw").textContent = isPw ? "Hide" : "Show";
  };

  $("loginBtn").onclick = async () => {
    $("loginErr").textContent = "";
    const email = $("email").value.trim();
    const pw = $("password").value;
    if (!email || !pw) { $("loginErr").textContent = "Enter email and password."; return; }
    $("loginBtn").disabled = true; $("loginBtn").textContent = "Signing in…";
    const r = await send("wt-login", { email, password: pw });
    $("loginBtn").disabled = false; $("loginBtn").textContent = "Sign in";
    if (r && r.ok) {
      // Reset welcome flag on fresh sign-in so users get the affirmation
      await clockwork.storage.local.remove("wtSawWelcome");
      toast("Signed in ✓");
      await refresh();
    } else {
      $("loginErr").textContent = (r && r.error) || "Sign in failed. Check email and password.";
    }
  };

  $("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });
  $("email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("password").focus(); });

  $("reauthBtn").onclick = async () => {
    await send("wt-logout");
    await refresh();
  };
  $("footLogout2").onclick = async () => { await send("wt-logout"); await refresh(); };

  $("clockInBtn").onclick = async () => {
    const sel = $("client");
    const clientId = sel ? sel.value : "";
    await clockwork.storage.local.set({ wtLastClient: clientId });
    $("clockInBtn").disabled = true; $("clockInBtn").textContent = "Starting…";
    const r = await send("wt-clock-in", { clientId: clientId || null });
    $("clockInBtn").disabled = false; $("clockInBtn").innerHTML = "▶  Clock In";
    if (r && r.error) { toast(r.error); return; }
    toast("Clocked in ✓");
    await refresh();
  };

  $("clockOutBtn").onclick = async () => {
    if (!confirm("Clock out and end this session?")) return;
    $("clockOutBtn").disabled = true; $("clockOutBtn").textContent = "Stopping…";
    await send("wt-clock-out");
    toast("Clocked out");
    await refresh();
  };
  $("clockOutBtn2").onclick = $("clockOutBtn").onclick;

  $("pauseBtn").onclick = async () => {
    $("pauseBtn").disabled = true;
    await send("wt-toggle-pause", { breakType: "short_break" });
    $("pauseBtn").disabled = false;
    await refresh();
  };

  $("lunchBtn").onclick = async () => {
    $("lunchBtn").disabled = true;
    await send("wt-toggle-pause", { breakType: "lunch" });
    $("lunchBtn").disabled = false;
    await refresh();
  };

  $("resumeBtn").onclick = async () => {
    $("resumeBtn").disabled = true; $("resumeBtn").textContent = "Resuming…";
    await send("wt-toggle-pause");
    toast("Resumed ✓");
    await refresh();
  };

  $("retryBtn").onclick = async () => {
    $("retryBtn").disabled = true; $("retryBtn").textContent = "Syncing…";
    await send("wt-flush-now");
    $("retryBtn").disabled = false; $("retryBtn").textContent = "Retry sync now";
    await refresh();
  };

  $("testShotBtn").onclick = async () => {
    const btn = $("testShotBtn");
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.textContent = "📷  Capturing…";
    const r = await send("wt-test-shot");
    btn.disabled = false;
    btn.innerHTML = old;
    toast(r && r.reason ? r.reason : r && r.ok ? "Captured ✓" : "Capture failed");
    await refresh();
  };

  refresh();
  // Force a version-check on every popup open so VAs see fresh status.
  send("wt-check-update").then((s) => { if (s) { st = s; render().then(fitWindow); } });
  // Re-fit whenever the visible content changes size (banners, pills, etc.).
  window.addEventListener("load", fitWindow);
  new ResizeObserver(fitWindow).observe(document.body);
  startTicker();
  setInterval(refresh, 5000);
});
