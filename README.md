# OBS Config Loader

A desktop app that finds your OBS Studio installs (native, Flatpak, Snap, portable, Windows, macOS) and loads a whole
streaming setup into any of them from one open, documented file: scenes, sources, profiles, stream settings, media and
the list of plugins it needs. The same setup works on Linux, Windows and macOS, and can live in a git repository.

> Status: early. The bundle format ([`docs/FORMAT.md`](docs/FORMAT.md)) is specified; the core library and app are being built.

## Features (planned)
- Detect OBS installs per platform and add portable ones by folder.
- Import/export `.obsbundle` (zip) or the unzipped directory form.
- Missing media and plugins are reported (plugins with install instructions, never bundled).
- Git-backed config repositories with large files kept outside git as placeholders.
- Manage several OBS instances (where the install type allows it).

## Running it
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
