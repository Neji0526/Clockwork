const $ = (id) => document.getElementById(id);
const DEFAULTS = { idleSeconds: 300, shotMinutes: 5, dashboardUrl: "" };

async function load() {
  const { settings } = await clockwork.storage.local.get("settings");
  const s = { ...DEFAULTS, ...(settings || {}) };
  $("idleSeconds").value = s.idleSeconds;
  $("shotMinutes").value = s.shotMinutes;
  $("dashboardUrl").value = s.dashboardUrl || "";
}

$("save").onclick = async () => {
  const { settings } = await clockwork.storage.local.get("settings");
  const raw = ($("dashboardUrl").value || "").trim().replace(/\/+$/, "");
  let dashboardUrl = "";
  if (raw) {
    try { dashboardUrl = new URL(raw).origin; } catch { dashboardUrl = ""; }
  }
  const next = {
    ...(settings || {}),
    idleSeconds: Math.min(3600, Math.max(15, Number($("idleSeconds").value) || 300)),
    shotMinutes: Math.min(60, Math.max(1, Number($("shotMinutes").value) || 5)),
    dashboardUrl,
  };
  await clockwork.storage.local.set({ settings: next });
  $("ok").textContent = raw && !dashboardUrl ? "Saved — but dashboard URL was invalid." : "Saved.";
};

load();
