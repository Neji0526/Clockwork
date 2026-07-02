# ClockWork Desktop (Electron)

Cross-platform desktop build of ClockWork — a **platform migration** of the
Chrome MV3 extension (`../extension/`) to a standalone Electron app for
**Windows, macOS, and Linux**. No Chrome required.

All business logic, ingest payloads, session lifecycle, offline queue, auth
resilience, sleep/wake recovery, engagement sampling, on-demand capture
requests, web→desktop command sync, and version checking are preserved
**verbatim** from `extension/background.js`. Only the runtime environment
changed: Chrome APIs → Electron equivalents.

## Architecture

```
desktop/
├── package.json              app manifest + scripts
├── electron-builder.yml      win / mac / linux packaging
├── build/icon.png            installer + tray icon
└── src/
    ├── shared/
    │   └── config.js         Supabase URL/key, DEFAULTS, keys (verbatim from bg.js)
    ├── main/                 ELECTRON MAIN PROCESS (was the MV3 service worker)
    │   ├── main.js           app lifecycle, windows, tray, IPC wiring, boot
    │   ├── core.js           ported background.js — the capture + sync engine
    │   ├── store.js          chrome.storage.local  → electron-store
    │   ├── scheduler.js      chrome.alarms         → timers
    │   ├── tracker.js        chrome.idle + chrome.tabs (active) → powerMonitor + active-win
    │   ├── screenshot.js     chrome.tabs.captureVisibleTab → capturePage / desktopCapturer
    │   └── tray.js           chrome.action (toolbar badge) → Tray
    ├── preload/              SECURE BRIDGES (contextIsolation)
    │   ├── preload.js        `chrome.*` shim for popup/options (IPC-backed)
    │   ├── browser-preload.js host bridge for the in-app browser window
    │   └── webview-preload.js migrated recorder.js (content script) for guest pages
    └── renderer/             RENDERER (existing UI, preserved)
        ├── popup.html/.js    verbatim from extension
        ├── options.html/.js  verbatim from extension
        ├── recorder.js       reference copy (active copy lives in webview-preload.js)
        └── browser.html/.js  in-app browser (hybrid capture surface, new)
```

## Chrome API → Electron mapping

| Chrome API | Electron replacement | File |
|---|---|---|
| `chrome.runtime` messaging | `ipcMain` / `ipcRenderer` (`wt-message`) | main.js, preload.js |
| `chrome.storage.local` | `electron-store` | store.js |
| `chrome.alarms` | `setTimeout` / `setInterval` (same named-alarm API) | scheduler.js |
| background service worker | Electron **main process** | core.js |
| `chrome.idle` | `powerMonitor.getSystemIdleState` | tracker.js |
| `chrome.tabs` / `chrome.windows` (active target) | `active-win` (OS window) + in-app browser tab | tracker.js |
| `chrome.tabs.captureVisibleTab` | `webContents.capturePage()` / `desktopCapturer` | screenshot.js |
| `chrome.scripting.executeScript` (recorder) | `<webview>` preload injects the recorder | webview-preload.js |
| `chrome.action` badge | `Tray` (tooltip / mac title) | tray.js |
| `chrome.tabs.create` | `shell.openExternal` | main.js |
| `chrome.runtime.getManifest().version` | `app.getVersion()` | main.js |
| `navigator.onLine` | `net.isOnline()` | main.js |

## Hybrid tracking model

A standalone desktop app cannot read Chrome's tabs or inject a DOM recorder into
other applications, so capture is hybrid:

- **OS-level (all apps):** the foreground window (app name + title) is the
  current activity; screenshots capture the primary display; idle uses
  `powerMonitor`. This covers native apps the VA works in. Native windows have no
  URL, so the URL-based blocklist does not apply to them.
- **In-app browser (full fidelity):** when the VA browses inside the ClockWork
  Browser window, that tab's host/title/URL is the activity, screenshots capture
  the tab, and **click-trail → SOP** recording works exactly as in the
  extension (label/tag/rect/dpr/viewport), because `webview-preload.js` runs the
  original recorder inside the page.

## Develop

```bash
cd desktop
npm install
npm start          # launches the app (Electron)
```

The app connects to the same Supabase backend as the extension and web app.
Set the dashboard URL in **Tray → Settings** (or it defaults to the built-in host).

## Build installers

```bash
npm run build:win     # ClockWork-Setup-<v>.exe   (NSIS)   — buildable on Windows
npm run build:linux   # ClockWork-<v>.AppImage + .deb      — buildable on Linux
npm run build:mac     # ClockWork-<v>.dmg                  — must run on macOS
```

Cross-OS note: a macOS `.dmg` can only be produced on macOS (Apple tooling).
Use CI to build all three on native runners:
`../.github/workflows/desktop-build.yml` (matrix: windows / macos / ubuntu).
Publish the resulting installers to `public/downloads/` on the web app using the
filenames in `src/lib/desktop-version.ts`; the `/install` page links to them and
the app self-updates check hits `/api/public/desktop-version`.

## Native permissions

- **macOS:** first launch needs **Screen Recording** permission (System Settings
  → Privacy & Security) for `desktopCapturer` and `active-win`.
- **Windows / Linux:** no special permission for screen capture.
