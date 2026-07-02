# ClockWork browser extension

Editable source for the Chrome MV3 extension shipped as
`public/clockwork-extension.zip` and downloaded from `/install`.

## Layout

```
extension/
├── manifest.json     MV3 manifest (permissions, version)
├── popup.html        Toolbar popup markup + styles
├── popup.js          Popup view logic, talks to background via runtime messages
├── background.js     Service worker: recording, alarms, ingest queue, auth
├── recorder.js       Content script: click/interaction reporter (no input values)
├── options.html      Options page markup
├── options.js        Options page logic
└── icons/            16/48/128 PNGs referenced by manifest
```

## Shipping a new version

1. Edit files under `extension/`.
2. Bump `"version"` in `extension/manifest.json`.
3. Bump `EXTENSION_VERSION` (and `MIN_EXTENSION_VERSION` if the change is
   mandatory) in `src/lib/extension-version.ts` to match.
4. Rebuild the zip:

   ```bash
   bash scripts/build-extension.sh
   ```

   This writes `public/clockwork-extension.zip` from the current
   `extension/` tree and warns if the manifest version and
   `EXTENSION_VERSION` disagree.

5. VAs are prompted to reinstall on next popup open (the popup compares
   the installed version against `/api/public/extension-version`).

## Local testing

Load `extension/` directly in Chrome via `chrome://extensions` →
Developer mode → Load unpacked. No need to zip while iterating.
