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
- `packages/core/src`: `types` (manifest), `detect` (OBS installs per OS, injectable `Host`), `export` / `import` (plan, then apply), `bundleIO` (zip + directory form), `repo` (git: status/clone/pull/push/log, `captureLive` = 3-way merge of live OBS edits into the repo, `markSynced`, `assetNeeds`), `tokens`, `secrets`, `plugins`, `sources` (platform-specific source ids and the default platform map), `ini`
- `apps/desktop`: Electron app. `electron/` (main, preload, `api.ts` = the typed IPC contract), `src/renderer` (React + turbothemes + Tailwind 3: pages Installs, Import, Export, Git repositories, Appearance, About), `scripts/build.mjs` (esbuild for main/preload with core bundled in, Vite for the renderer)
- `vendor/turbothemes`: copy of the engine's themes package (see `scripts/sync-themes.mjs`)
- `.github/workflows`: `check.yml` (core on Linux/Windows/macOS), `auto-pr.yml`

## What exists and is tested
- Core (`pnpm --filter @obs-config-loader/core test`, 35 tests, real git in temp dirs): detection with fake machines for Linux native/Flatpak/Snap/portable, Windows, macOS; export (secrets scrubbed, small media bundled, big media external with hash, plugin report); import (Linux round trip, idempotent, backup/keep-both/skip, OBS-running block, Linux to Windows substitution and path conversion, unmappable sources hidden); zip and directory forms; git: first capture, unchanged capture makes no commit, live edit commits, dry run, dirty tree refused / committed first, AI-edit + live-edit merge keeps both, pending repo change is not a live change, true conflict aborts cleanly (scratch worktree removed), other platform's source kept, bare-remote push/pull/conflict, placeholders for big media (missing / located / changed).
- Desktop app: typechecks and builds; driven end to end in a real Electron under Xvfb (Playwright `_electron`, stubbed file dialogs): detect a Flatpak install, export a bundle, add a portable install, open the bundle, fill secrets, dry-run report, import, verify the files written. Re-run it with `xvfb-run -a node apps/desktop/e2e/e2e.cjs` after `pnpm --filter @obs-config-loader/desktop build` (needs playwright and the Electron binary).
- Git flow driven end to end in real Electron (`apps/desktop/e2e/e2e-git.cjs`): create repo from OBS, save live edit, AI commit + live edit merged, uncommitted edit handled, push to bare remote, apply repo back to OBS.
- Not done: per-platform variants of one source, instances, release/updater wiring, Windows/macOS real-machine runs.

## Hard-won gotchas
- OBS rewrites its config on exit: importing while OBS runs is lost. Import is blocked when the caller says OBS runs.
- Source ids and config paths were checked against OBS's own source (`plugins/*`, `frontend/obs-main.cpp`, `libobs/util/platform-nix.c`) on 2026-10-29. obsproject.com is not reachable from cloud sessions; GitHub is.
- Linux OBS honours `XDG_CONFIG_HOME` and `--multi`, so a second instance with its own config is possible natively. Whether Flatpak passes `--env=XDG_CONFIG_HOME` through is UNTESTED (needs a real machine).
- Portable: Windows = `<root>/config/obs-studio`, switched on by `--portable` or `portable_mode.txt` in `<root>`; Linux only if OBS was built with `ENABLE_PORTABLE_CONFIG` (then `<root>/config/obs-studio`, started from `bin/`).
- Multi RTMP keeps its targets AND stream keys in `obs-multi-rtmp.json` inside the profile folder. All profile JSON is secret-scrubbed, not just `service.json`.
- PipeWire window/screen/desktop capture is built into OBS (ids `pipewire-*-capture-source`); the third-party plugin is PipeWire *audio* capture (`pipewire_audio_*_capture`).
- OBS appends `_vN` to versioned ids (`text_ft2_source_v2`); strip before matching.
- A substituted source loses its settings on purpose (devices/windows do not translate); a source with no equivalent keeps its id and settings and its scene items are hidden.

- Electron 39+/40+ could not be installed in the cloud sandbox (`@electron-internal/extract-zip` 404 on the npm mirror), so `electron` is pinned to 38. Revisit on a normal machine. Electron's binary needs `--no-sandbox` when run as root, and the postinstall is skipped by pnpm: run `node node_modules/electron/install.js` once.
- pnpm cannot fetch the `themes/` sub-folder of turboengine in the cloud sandbox (codeload 403), hence the vendored copy.
- The theme updater's network call fails with a certificate error inside the sandbox; harmless, the built-in themes are used.
- Secrets typed in the Import page are remembered only when `safeStorage` encryption is available; otherwise they are never written.

- Git design: live edits are committed in a scratch `git worktree` on the last-synced commit (local ref `refs/obs-config-loader/synced/<install>`), then merged into HEAD. Do not simplify this to "write OBS over the working tree": it silently drops repo-side edits. `revision`/`exportedAt` stay frozen in the directory form so merges never conflict on them. Git is the user's own `git` (no bundled libgit); prompts are disabled (`GIT_TERMINAL_PROMPT=0`), so credentials must already work non-interactively.
- Known limitation: a platform-specific source is owned by the platform that first saved it; edits to it on another OS are not captured (planned: per-platform variants).

## Session log
- 2026-10-29: repo created from TurboEngine templates; format spec drafted; core library built on branch `claude/obs-config-core` with tests.
- 2026-10-29: Desktop app (branch `claude/obs-config-desktop`, built on the core branch): installs list, import wizard with live dry-run report, export, appearance picker. Verified in a real Electron run.
- 2026-10-29: Git workflow: `repo.ts` in core, Git repositories page, import-time guard for unsaved live edits, remembered media locations per bundle.
