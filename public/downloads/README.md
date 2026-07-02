# Desktop app installers

The `/install` page links to the ClockWork Desktop (Electron) installers from
this folder, and the app's self-update check (`/api/public/desktop-version`)
advertises them. Publish the CI-built artifacts here using the exact filenames
defined in `src/lib/desktop-version.ts`:

```
ClockWork-Setup-<version>.exe      # Windows (NSIS)
ClockWork-<version>.dmg            # macOS   (built on a macOS runner)
ClockWork-<version>.AppImage       # Linux
ClockWork-<version>.deb            # Linux (optional)
```

The installers are produced by `.github/workflows/desktop-build.yml` (a matrix
build on windows-latest / macos-latest / ubuntu-latest — the only reliable way
to produce the signed macOS `.dmg`). Download the workflow artifacts and drop
them here (or point the download URLs at a release CDN and update
`src/lib/desktop-version.ts`).
