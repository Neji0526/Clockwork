// Single source of truth for the current ClockWork Desktop (Electron) release.
// Bump these when shipping new installers to public/downloads/.
// Keep in sync with desktop/package.json "version".
export const DESKTOP_VERSION = "1.0.0";
// Below this, the desktop app shows a HARD "you must update" block.
export const MIN_DESKTOP_VERSION = "1.0.0";

// Installer filenames served from /downloads on the site. The CI workflow
// (.github/workflows/desktop-build.yml) produces these per-OS; publish them to
// public/downloads/ (or a release CDN) using these exact names.
export const DESKTOP_DOWNLOADS = {
  windows: `/downloads/ClockWork-Setup-${DESKTOP_VERSION}.exe`,
  mac: `/downloads/ClockWork-${DESKTOP_VERSION}.dmg`,
  linux: `/downloads/ClockWork-${DESKTOP_VERSION}.AppImage`,
} as const;
