// Single source of truth for the current extension release.
// Bump these when shipping a new public/clockwork-extension.zip.
export const EXTENSION_VERSION = "0.4.13";
// Below this, the popup shows a HARD "you must reinstall" block.
// 0.4.12 introduces web→extension command sync (Clock out / Start break /
// Resume from the web actually stop/pause the extension within ~30s).
export const MIN_EXTENSION_VERSION = "0.4.12";
