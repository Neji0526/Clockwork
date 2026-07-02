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

// Capture the primary display at full resolution.
async function captureScreen(quality) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
  });
  if (!sources.length) return null;
  const img = sources[0].thumbnail;
  if (!img || img.isEmpty()) return null;
  return toJpegDataUrl(img, quality);
}

module.exports = { captureFrom, captureWebContents, captureScreen };
