# OBS Config Loader: project brief

## Goal and user
Anyone running OBS Studio on more than one machine, OS or install type who wants one setup applied everywhere. Public tool, not tied to any one streamer's setup.

## Feature inventory
1. Detect OBS installs: Windows (installer, portable), Linux (native/.deb, Flatpak, Snap, self-built portable), macOS. User can add a portable folder.
2. Import/export an open bundle (`docs/FORMAT.md`): scenes, sources, profiles, stream keys (as secrets), media, plugin list.
3. Cross-platform: remap paths and platform-specific sources, flag what cannot be translated, never guess.
4. Plugin report with per-platform install instructions (no bundling).
5. Git-backed config repositories: text in git, large media as placeholders (`assets.lock.json`), prompt on pull, commit live state before changes so local edits are never reverted.
6. Several OBS instances (where possible; Flatpak needs an experiment).

## Rules that must not be broken
- Secrets (stream keys) never leave the machine in a bundle or git.
- Import never overwrites without a backup; dry run available.
- Unknown JSON keys are preserved on round trip.
- Refuse bundles newer than the reader understands.
- Core has no Electron dependency and runs under plain Node, so it can be tested and scripted.

## Architecture
- `packages/core`: format, OBS detection, tokenising/de-tokenising, import/export, report.
- `apps/desktop`: Electron main/preload + React renderer (turbothemes).

## Roadmap (with done-criteria)
Done (each has automated tests, and the UI paths a real-Electron run):
1. Spec + core: detect, export, import, platform remap, round trips.
2. Desktop app: installs, import wizard with dry-run report, export, appearance, guides, optional themed title bar.
3. Git: save live edits (3-way merge with repo changes), pull/push, conflict choices, GitHub sign-in/create/publish/clone, install-git helper, bundle-to-repo.
4. Per-platform variants of capture sources; secrets never blanked on import.
5. Separate OBS instances (Linux system package, Flatpak with a post-start check).
6. Release pipeline: every merge to main publishes installers (deb, AppImage, Windows installer, macOS dmg/zip) and installed apps update themselves.

Open (needs a real machine or a decision):
- Run on real Windows and macOS; macOS code signing (auto-update needs it), Windows signing (SmartScreen).
- Real Flatpak: does `--env=XDG_CONFIG_HOME` take effect (the app checks and says so).
- Real GitHub sign-in and the install-git button on each OS.
- Plugin settings beyond Multi RTMP (e.g. Aitum) once their config locations are verified.

## Glossary
Bundle, collection (OBS scene collection), profile, asset, variable, platform map: see `docs/FORMAT.md`.
