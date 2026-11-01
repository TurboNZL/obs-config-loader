# OBS Config Loader

A desktop app that finds your OBS Studio installs (native, Flatpak, Snap, portable, Windows, macOS) and loads a whole
streaming setup into any of them from one open, documented file: scenes, sources, profiles, stream settings, media and
the list of plugins it needs. The same setup works on Linux, Windows and macOS, and can live in a git repository.

> Status: usable, not yet proven on every system. The bundle format is specified in [`docs/FORMAT.md`](docs/FORMAT.md).

## Features
- Detect OBS installs per platform and add portable ones by folder.
- Import/export `.obsbundle` (zip) or the unzipped directory form.
- Missing media and plugins are reported (plugins with install instructions, never bundled).
- Git-backed config repositories with large files kept outside git as placeholders.
- Make a separate OBS with its own settings and plugins (Linux system package and Flatpak), so a heavy plugin only loads where it is needed.
- One setup for several operating systems: capture sources are kept per OS.

## Install
Every merge to `main` publishes a release with installers; installed copies update themselves.

| OS | Download from the [latest release](https://github.com/TurboNZL/obs-config-loader/releases/latest) |
|---|---|
| Linux (Debian, Ubuntu, Kubuntu) | `obs-config-loader-<version>-linux-amd64.deb` (or the `.AppImage`, which needs no root) |
| Windows | `obs-config-loader-<version>-win-x64.exe` |
| macOS | `obs-config-loader-<version>-mac-*.dmg` (not signed: right-click > Open the first time; it cannot update itself until it is signed) |

## Running it from source
```
pnpm install
pnpm test
```

## Releases and updates
Every merge to `main` becomes a release (`vYYYY.M.N`); installed apps update themselves from it.

## Engine
Built on [TurboNZL/turboengine](https://github.com/TurboNZL/turboengine) (`.turboengine.json` says which commit and modules).

## License
MIT, see `LICENSE`.
