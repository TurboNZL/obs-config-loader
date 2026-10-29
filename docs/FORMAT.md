# OBS Config Bundle format (`obs-config-bundle`, version 1)

An open, documented way to move a whole OBS Studio setup between machines and operating systems:
scenes, sources, profiles, stream settings, attached media, and the list of plugins it needs.
Anyone may read or write it; nothing here is specific to this app.

- File extension: **`.obsbundle`**. It is an ordinary **zip**, so a plain `.zip` with the same
  contents is accepted too.
- Everything text-based is UTF-8 JSON or INI, so the same content can live unzipped in a git
  repository (see "Directory form").
- Spec version: `1`. A reader must **refuse** a bundle whose `version` is newer than it knows,
  and must read older ones.

## Layout

```
manifest.json                 required, describes everything below
collections/<id>.json         OBS scene collections, with tokens instead of machine-specific values
profiles/<id>/basic.ini       OBS profile files (output, video, audio settings)
profiles/<id>/streamEncoder.json, recordEncoder.json, service.json, ...
media/<assetId>/<filename>    bundled assets (only those with "mode": "bundled")
```

## `manifest.json`

```jsonc
{
  "format": "obs-config-bundle",
  "version": 1,
  "id": "9b2f...",                       // stable id of this setup; re-importing the same id updates it
  "name": "Main stream",
  "description": "optional",
  "revision": 7,                          // optional, bumped by the tool on export
  "exportedAt": "2026-10-29T08:00:00Z",
  "generator": { "name": "obs-config-loader", "version": "2026.10.1" },
  "source": { "platform": "linux", "obsVersion": "31.0.0" },
  "obsMinVersion": "28.0.0",

  "collections": [{ "id": "main", "name": "Main", "file": "collections/main.json" }],
  "profiles":    [{ "id": "main", "name": "Main", "dir":  "profiles/main" }],
  "activeCollection": "main",
  "activeProfile": "main",

  "variables": [ ... ],
  "assets":    [ ... ],
  "plugins":   [ ... ],
  "platformMap": [ ... ]
}
```

### `variables`: values that differ per machine or must never be shared

Referenced from collection and profile files as `{{var:NAME}}`.

```json
{ "name": "STREAM_KEY", "kind": "secret", "label": "Twitch stream key",
  "target": "profiles/main/service.json#settings.key", "required": false }
{ "name": "RECORDING_DIR", "kind": "path", "label": "Where recordings go",
  "default": "{{home}}/Videos" }
{ "name": "CHAT_URL", "kind": "url", "label": "Chat browser source URL" }
```

| `kind`   | Meaning |
|----------|---------|
| `secret` | Never exported with a value. Asked for on import, kept in the OS credential store, never committed to git. |
| `path`   | A folder or file on this machine. Asked for on import; default may use the built-in tokens below. |
| `url`, `text`, `number`, `bool` | Plain values. A value in the bundle is used as the default. |

Built-in tokens (always available, never declared): `{{home}}`, `{{documents}}`, `{{videos}}`,
`{{music}}`, `{{pictures}}`, `{{desktop}}`, `{{bundle}}` (folder holding the imported media).
Path separators in values are normalised to the target OS on import.

### `assets`: media files that scenes point at

Referenced as `{{asset:ID}}` inside collection files.

```json
{ "id": "bg-1", "filename": "Focused BG 1.png", "role": "image",
  "mode": "bundled", "sha256": "ab12...", "size": 183422 }
{ "id": "music-mix", "filename": "background-mix.mp3", "role": "audio",
  "mode": "external", "sha256": "cd34...", "size": 91234567,
  "hint": "Your background music mix (about 90 MB), not stored in git" }
```

- `mode: "bundled"`: the file is in `media/<id>/<filename>`.
- `mode: "external"`: the file is **not** in the bundle (too big for git, or licensed). The importer
  asks the user to locate it (checking `sha256` when present) and remembers the choice. Until it is
  given, the source is imported with an empty path and flagged; nothing is lost, and the
  placeholder survives later exports.
- `role`: `image | video | audio | font | other`, used only for the UI.

### `plugins`: what the setup needs but does not bundle

Plugins are **never bundled**. The importer reports which are missing and shows install
instructions.

```json
{ "id": "multi-rtmp", "name": "Multiple RTMP outputs",
  "provides": [ { "kind": "output", "id": "multi_rtmp" }, { "kind": "module", "id": "obs-multi-rtmp" } ],
  "required": true,
  "homepage": "https://github.com/sorayuki/obs-multi-rtmp",
  "install": {
    "linux-flatpak": "Install the Flatpak extension, or copy the plugin into ~/.var/app/com.obsproject.Studio/config/obs-studio/plugins/",
    "linux-native": "Install the package from the release page into ~/.config/obs-studio/plugins/",
    "windows": "Run the installer from the release page",
    "macos": "Copy into ~/Library/Application Support/obs-studio/plugins/"
  } }
```

`provides` lists OBS identifiers the plugin supplies (source `id`, filter `id`, output `id`,
module name). The importer detects missing plugins by checking every `id` used in the collection
against what the target OBS has (module files present, or built-in ids).

### `platformMap`: sources that exist only on some platforms

Capture sources are platform-specific. A collection records the original; this table says what
may stand in for it elsewhere.

```json
{ "from": "xcomposite_input",
  "to": { "windows": "window_capture", "macos": "window_capture", "linux-pipewire": "pipewire-window-capture-source" },
  "settingsMap": { "capture_window": null },
  "note": "Window choice cannot be translated; pick the window again." }
```

On import, a source whose `id` does not exist on the target is:
1. replaced by its mapped equivalent if one is listed and available, with settings it cannot
   translate **cleared** (never guessed);
2. otherwise kept **disabled** with its original `id` and settings, so a later export or a move
   back to the original platform loses nothing.

Every substitution is listed in the import report.

## Collection and profile files

These are the files OBS writes (scene collection `*.json`, profile `basic.ini`, `service.json`, ...)
with machine-specific values replaced by tokens:

| Token | Replaces |
|-------|----------|
| `{{asset:ID}}` | path of a media file |
| `{{var:NAME}}` | declared variable |
| `{{home}}` etc. | built-in folder |

A token can be the whole value or part of a string (`"{{var:RECORDING_DIR}}/clips"`).
Tokens are written by the exporter; everything else in the file is OBS's own data, untouched, so
future OBS keys survive. On import the tokens are substituted for the target machine.

## Import rules

1. **Dry run first**: the importer can produce the full report (files written, variables needed,
   assets missing, plugins missing, sources substituted) without touching OBS.
2. **Idempotent by `id`**: importing the same bundle twice changes nothing the second time.
3. **Never overwrites silently**: existing collections/profiles with the same name are backed up
   (`<name>.before-import-<timestamp>`), and the user chooses replace, keep both or skip.
4. **Close OBS first** (OBS rewrites its files on exit); the tool warns when OBS is running.
5. **Looks only fill gaps** is *not* used here: a bundle is a full setup. To protect local edits use
   the git workflow below.

## Directory form (for git)

The same content unzipped, plus an `assets.lock.json`:

```
my-setup/
  manifest.json
  collections/  profiles/
  assets.lock.json          # id -> { sha256, size, hint }: every external asset, committed
  .gitignore                # media/ and anything marked external or secret
```

- Secrets are never in the repository (`secret` variables carry only their name).
- Large or private media are `external`: git stores the **placeholder** (`assets.lock.json`), and a
  pull asks for the files that are missing or whose hash changed.
- The tool keeps the user's chosen locations in its own local store, not in the repository.
- **Local edits are preserved:** before the repository is changed from the app (or from an AI
  tweak), the tool exports the live OBS state and commits it, so edits made in OBS between larger
  revisions are part of history and a later change starts from them, not from the last revision.

## Versioning and compatibility

- Additive changes (new optional fields) keep `version: 1`. Readers ignore unknown fields and
  must preserve them when re-writing.
- Breaking changes bump `version`. Writers should write the lowest version that can hold the content.
