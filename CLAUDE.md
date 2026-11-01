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
| GUI first | Anything a user would otherwise do on the command line (git init/clone/remote, creating a repo on GitHub, resolving a conflict, installing git) is done in the app. A command is only ever shown as a copyable last-resort fallback. |
| GitHub | Sign-in is a personal access token pasted in the app (a link opens GitHub's token page with the permission pre-ticked); stored with `safeStorage`, memory-only when there is no keychain; handed to git through `GIT_CONFIG_*` env (never argv, `.git/config` or the remote URL). Other hosts use the user's own git credentials. |

## Repo layout
- `docs/FORMAT.md`: the open bundle format spec (source of truth for the core)
- `packages/core/src`: `types` (manifest), `detect` (OBS installs per OS, injectable `Host`), `export` / `import` (plan, then apply), `bundleIO` (zip + directory form), `repo` (git: status/clone/pull/push/log, `captureLive` = 3-way merge of live OBS edits into the repo, `markSynced`, `assetNeeds`, conflict choices), `remote` (set remote, GitHub REST: whoami/list/create/publish, token-in-env git runner, bundle-to-repo, git install help), `tokens`, `secrets`, `plugins`, `sources` (platform-specific source ids and the default platform map), `ini`
- `apps/desktop`: Electron app. `electron/` (main, preload, `api.ts` = the typed IPC contract), `src/renderer` (React + turbothemes + Tailwind 3: pages Installs, Import, Export, Git repositories, Appearance, About), `scripts/build.mjs` (esbuild for main/preload with core bundled in, Vite for the renderer)
- `vendor/turbothemes`: copy of the engine's themes package (see `scripts/sync-themes.mjs`)
- `scripts/ci-local.sh`: runs what CI runs from a **fresh clone of the committed state**. Run it before every push.
- `.github/workflows`: `check.yml` (core on Linux/Windows/macOS + desktop build; also `workflow_dispatch`), `auto-pr.yml`

## What exists and is tested
- Core (`pnpm --filter @obs-config-loader/core test`, 51 tests, real git in temp dirs): detection with fake machines for Linux native/Flatpak/Snap/portable, Windows, macOS; export (secrets scrubbed, small media bundled, big media external with hash, plugin report); import (Linux round trip, idempotent, backup/keep-both/skip, OBS-running block, Linux to Windows substitution and path conversion, unmappable sources hidden); zip and directory forms; git: first capture, unchanged capture makes no commit, live edit commits, dry run, dirty tree refused / committed first, AI-edit + live-edit merge keeps both, pending repo change is not a live change, true conflict aborts cleanly (scratch worktree removed), other platform's source kept, bare-remote push/pull/conflict, placeholders for big media (missing / located / changed).
- Desktop app: typechecks and builds; driven end to end in a real Electron under Xvfb (Playwright `_electron`, stubbed file dialogs): detect a Flatpak install, export a bundle, add a portable install, open the bundle, fill secrets, dry-run report, import, verify the files written. Re-run it with `xvfb-run -a node apps/desktop/e2e/e2e.cjs` after `pnpm --filter @obs-config-loader/desktop build` (needs playwright and the Electron binary).
- Git flow driven end to end in real Electron through the screens only (`apps/desktop/e2e/e2e-git.cjs`, with a local stand-in for GitHub's API via `OBSCL_GITHUB_API`): sign in (wrong token, then right), create a repo and publish it in one step, save/push, pull conflict -> "take the online version", save conflict -> "keep OBS's version", publish a second repo later, download from the GitHub list, apply to OBS, and the "git is not installed" screen (`OBSCL_FAKE_NO_GIT=1`).
- Not run anywhere real: the git install button (winget / xcode-select / pkexec), the GitHub sign-in against the real api.github.com, safeStorage on a desktop with a keychain.
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

- **CI lessons (2026-11-01, all four jobs were red on `main`):** (1) `pnpm/action-setup` must not get `version:` when `package.json` has `packageManager` (it is in the engine's release-pipeline notes; read them). (2) `.gitignore` had `dist/`, which silently excluded `vendor/turbothemes/dist`: it worked on the dev machine and failed on every fresh clone. Always run `scripts/ci-local.sh` (fresh clone) before pushing. (3) Git prints repo paths as `C:/Users/RUNNER~1/...`; compare folders with `samePath()`, never string equality (it made every repo look like "not a repo" on Windows).
- **Windows CI**: the core tests run on a real Windows runner; fake-Linux tests with real files must not assert on path separators.
- Importing without typing a secret keeps the value already in OBS (`keptSecrets`); it must never blank a stream key.
- Workflow runs on PRs opened by the Actions bot wait for approval (`action_required`); `workflow_dispatch` on check.yml lets a run be started without that.

## Session log
- 2026-10-29: repo created from TurboEngine templates; format spec drafted; core library built on branch `claude/obs-config-core` with tests.
- 2026-10-29: Desktop app (branch `claude/obs-config-desktop`, built on the core branch): installs list, import wizard with live dry-run report, export, appearance picker. Verified in a real Electron run.
- 2026-10-29: Git workflow: `repo.ts` in core, Git repositories page, import-time guard for unsaved live edits, remembered media locations per bundle.
- 2026-11-01: Fixed CI (see lessons). Moved every git step into the app: GitHub sign-in, create+publish, clone from your list, set/change the online address, conflict choices, install-git helper, bundle-to-repo, default folders. Secrets are kept on import.
