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
1. Spec + core: round-trip test (export a sample OBS dir, import to a fresh dir, compare) passes on Linux paths; Windows/macOS paths unit-tested with injected env.
2. Desktop UI shell: install list, import/export wizard with dry-run report.
3. Git repositories: init/commit/pull flow with asset placeholders.
4. Instances (Flatpak spike), release pipeline, auto-update.

## Glossary
Bundle, collection (OBS scene collection), profile, asset, variable, platform map: see `docs/FORMAT.md`.
