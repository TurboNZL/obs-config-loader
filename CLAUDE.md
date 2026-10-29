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

## What exists and is tested
- Spec only.

## Hard-won gotchas
- OBS rewrites its config on exit: importing while OBS runs is lost. Warn, and prefer refusing.

## Session log
- 2026-10-29: repo created from TurboEngine templates; format spec drafted.
