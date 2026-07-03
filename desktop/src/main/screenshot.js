// Screenshot capture — the Electron equivalent of chrome.tabs.captureVisibleTab.
//
//   * web target   -> webContents.capturePage() of the active embedded tab
//                     (a faithful 1:1 replacement for "capture the visible tab").
//   * screen target-> desktopCapturer of the primary display (captures whatever
//                     native app the VA is in — the transparent-tracking intent
//                     is preserved for the whole desktop).
//
// Output is always a JPEG data URL, matching the extension's
// { format: "jpeg", quality } contract so the ingest payload is unchanged.

const { desktopCapturer, screen, webContents } = require("electron");

function toJpegDataUrl(nativeImage, quality) {
  const q = Math.max(1, Math.min(100, Number(quality) || 55));
  const buf = nativeImage.toJPEG(q);
  return "data:image/jpeg;base64," + buf.toString("base64");
}

// Capture from a webContents instance directly (used for click-trail step shots,
// where core.js already holds the sender webContents).
async function captureFrom(wc, quality) {
  if (!wc || wc.isDestroyed()) return null;
  const img = await wc.capturePage();
  if (!img || img.isEmpty()) return null;
  return toJpegDataUrl(img, quality);
}

// Capture a specific embedded web tab by its webContents id (used for periodic
// shots when the browser tab is active).
async function captureWebContents(id, quality) {
  const wc = webContents.fromId(id);
  return captureFrom(wc, quality);
}

// Capture the primary display. Robust against empty thumbnails: tries full
// resolution first, then falls back to a capped size (some GPU/driver combos
// return an empty image for very large thumbnailSize requests).
async function captureScreen(quality) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const sf = display.scaleFactor || 1;

  const sizes = [
    { width: Math.round(width * sf), height: Math.round(height * sf) },
    { width: Math.round(width), height: Math.round(height) }, // fallback: no scale
    { width: 1920, height: 1080 }, // last-resort cap
  ];

  for (const thumbnailSize of sizes) {
    let sources;
    try {
      sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    } catch (e) {
      continue;
    }
    // Prefer the first source whose thumbnail is non-empty.
    const src = (sources || []).find((s) => s.thumbnail && !s.thumbnail.isEmpty());
    if (src) return toJpegDataUrl(src.thumbnail, quality);
  }
  return null;
}

module.exports = { captureFrom, captureWebContents, captureScreen };
