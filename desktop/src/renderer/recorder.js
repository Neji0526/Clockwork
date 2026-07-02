// ClockWork — click recorder content script.
// Injected into tabs while the VA is clocked in. Reports the identity of each
// element clicked (label, position, page) to the service worker, which buffers
// them into workflows.
//
// PRIVACY: never reads or transmits typed input values, key identities, or
// scroll offsets. Keyboard/scroll events are reported as opaque "interaction
// happened" pings — type tag only, no content.

(() => {
  if (window.__clockworkAttached) return;
  window.__clockworkAttached = true;

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function safeSend(payload) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      const r = chrome.runtime.sendMessage(payload, () => {
        void chrome.runtime.lastError;
      });
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch (_e) {}
  }

  function interactive(el) {
    const sel =
      'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="link"],' +
      'input, select, textarea, label, summary, [onclick], [tabindex]';
    return (el.closest && el.closest(sel)) || el;
  }

  function labelFor(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt) return clean(alt);
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const ph = el.getAttribute("placeholder");
      if (ph) return clean(ph);
      const type = el.getAttribute("type");
      if (type === "submit" || type === "button") {
        const val = el.getAttribute("value");
        if (val) return clean(val);
      }
      const nm = el.getAttribute("name") || el.getAttribute("id");
      if (nm) return clean(nm);
      return type ? type + " field" : "field";
    }
    const txt = clean(el.innerText || el.textContent);
    if (txt) return txt.slice(0, 80);
    const title = el.getAttribute && el.getAttribute("title");
    if (title) return clean(title);
    return (el.tagName || "element").toLowerCase();
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      try {
        if (e.button !== 0) return;
        const el = interactive(e.target);
        if (!el || !el.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        safeSend({
          type: "wt-click",
          meta: {
            label: labelFor(el),
            tag: (el.tagName || "").toLowerCase(),
            url: location.href.slice(0, 1000),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            dpr: window.devicePixelRatio || 1,
            viewport: { w: window.innerWidth, h: window.innerHeight },
          },
        });
      } catch (err) {}
    },
    true
  );

  // ---- Engagement pings (privacy-preserving) ----
  // We notify the background that an interaction happened. We send ONLY a
  // type tag — never the key, never typed text, never scroll offset/content.
  // Debounced per-type to ~once every 2s so we don't flood the worker.
  const lastSent = { click: 0, key: 0, scroll: 0 };
  const DEBOUNCE_MS = 2000;
  function pingInteraction(kind) {
    const now = Date.now();
    if (now - (lastSent[kind] || 0) < DEBOUNCE_MS) return;
    lastSent[kind] = now;
    safeSend({ type: "wt-interaction", kind });
  }

  document.addEventListener("pointerdown", (e) => { if (e.button === 0) pingInteraction("click"); }, { capture: true, passive: true });
  document.addEventListener("keydown", () => pingInteraction("key"), { capture: true, passive: true });
  document.addEventListener("wheel", () => pingInteraction("scroll"), { capture: true, passive: true });
  document.addEventListener("scroll", () => pingInteraction("scroll"), { capture: true, passive: true });
})();
