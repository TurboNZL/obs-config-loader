# OBS Config Loader: project handoff

Read this first, then `PROJECT_BRIEF.md`. This file is the running state and decision log: update it whenever a decision or the state changes.

## Engine
This app is pinned to TurboNZL/turboengine (see `.turboengine.json`). The engine is a **reference, not a dependency**: copy working modules from its `modules/` rather than inventing new ones (updates, release naming, theme picker, window chrome, settings layout, guides). If you improve a module here, say so in the session log so it can be ported back.

## User preferences (how to work with them)
- Don't waste their usage. Fact-check and double-check yourself; use web search liberally.
- They write casually; reply in normal capitalised prose.
- Verify against real runs, not only unit tests.
- This is a **public, general tool**: never hard-code the owner's own setups (Flatpak OBS + Multi RTMP, the Prismalite setup, Aitum). Those are only examples of what it must handle.
- A merged PR cannot take new work: restart the branch from main for follow-up changes.

## Decisions made (don't re-ask)
| Topic | Decision |
|---|---|
| Repo | `TurboNZL/obs-config-loader` |
| Stack | TurboEngine: Electron + React + turbothemes; core logic in a plain TypeScript package |
| First milestone | Format spec + cross-platform core (detect, export, import, remap); minimal UI |
| Bundle | `.obsbundle` = zip (plain `.zip` accepted) + unzipped directory form for git. Spec: `docs/FORMAT.md` |
| Plugins | Never bundled; reported with install instructions |

## Repo layout
- `docs/FORMAT.md`: the open bundle format spec (source of truth for the core)
- `packages/core/src`: `types` (manifest), `detect` (OBS installs per OS, injectable `Host`), `export` / `import` (plan, then apply), `bundleIO` (zip + directory form), `tokens`, `secrets`, `plugins`, `sources` (platform-specific source ids and the default platform map), `ini`
- `.github/workflows`: `check.yml` (core on Linux/Windows/macOS), `auto-pr.yml`

## What exists and is tested
- Core (`pnpm --filter @obs-config-loader/core test`, 20 tests): detection with fake machines for Linux native/Flatpak/Snap/portable, Windows, macOS; export (secrets scrubbed, small media bundled, big media external with hash, plugin report); import (Linux round trip, idempotent, backup/keep-both/skip, OBS-running block, Linux to Windows substitution and path conversion, unmappable sources hidden); zip and directory forms.
- Not done: Electron UI, git workflow (pull prompts for missing assets), instances, release/updater wiring, Windows/macOS real-machine runs.

## Hard-won gotchas
- OBS rewrites its config on exit: importing while OBS runs is lost. Import is blocked when the caller says OBS runs.
- Source ids and config paths were checked against OBS's own source (`plugins/*`, `frontend/obs-main.cpp`, `libobs/util/platform-nix.c`) on 2026-10-29. obsproject.com is not reachable from cloud sessions; GitHub is.
- Linux OBS honours `XDG_CONFIG_HOME` and `--multi`, so a second instance with its own config is possible natively. Whether Flatpak passes `--env=XDG_CONFIG_HOME` through is UNTESTED (needs a real machine).
- Portable: Windows = `<root>/config/obs-studio`, switched on by `--portable` or `portable_mode.txt` in `<root>`; Linux only if OBS was built with `ENABLE_PORTABLE_CONFIG` (then `<root>/config/obs-studio`, started from `bin/`).
- Multi RTMP keeps its targets AND stream keys in `obs-multi-rtmp.json` inside the profile folder. All profile JSON is secret-scrubbed, not just `service.json`.
- PipeWire window/screen/desktop capture is built into OBS (ids `pipewire-*-capture-source`); the third-party plugin is PipeWire *audio* capture (`pipewire_audio_*_capture`).
- OBS appends `_vN` to versioned ids (`text_ft2_source_v2`); strip before matching.
- A substituted source loses its settings on purpose (devices/windows do not translate); a source with no equivalent keeps its id and settings and its scene items are hidden.

## Session log
- 2026-10-29: repo created from TurboEngine templates; format spec drafted; core library built on branch `claude/obs-config-core` with tests.
