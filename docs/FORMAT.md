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
profiles/<id>/platforms.json   this profile's encoders and audio devices, one copy per system (see "Per-platform variants")
scripts/<assetId>/<filename>  OBS scripts (.py, .lua): small, so kept even in the directory form
global/obs-websocket.json     OBS's remote-control (WebSocket) settings; the password is a secret variable
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
  "repository": { "url": "https://github.com/me/my-setup.git" },   // only in files: where the preset is kept online (never a password)
  "platformOverrides": { "xcomposite_input": { "win32": "monitor_capture", "linux": null } },  // the person's own translation choices; null = hide it
  "exclude": { "collections": ["Old"], "scripts": true },   // what a save from OBS leaves out
  "savedWithObs": "31.0.2",             // newest OBS version any computer saved this with; only ever goes up

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
| `secret` | Not exported with a value by default. Asked for on import, kept in the OS credential store, never committed to git. See "Files that carry secrets" for the one opt-in exception. |
| `path`   | A folder or file on this machine. Asked for on import; default may use the built-in tokens below. |
| `url`, `text`, `number`, `bool` | Plain values. A value in the bundle is used as the default. |

Built-in tokens (always available, never declared): `{{home}}`, `{{documents}}`, `{{videos}}`,
`{{music}}`, `{{pictures}}`, `{{desktop}}`, `{{bundle}}` (folder holding the imported media).
Path separators in values are normalised to the target OS on import.

### Files that carry secrets (opt-in)

A person may choose to put their stream keys inside the file (to move a setup to their own other computer in one step).
That is the **only** way a secret value is ever written, and such a file is marked so nobody opens it unaware:

- `manifest.json` has `"containsSecrets": true` and a plain-words `"warning"`;
- each secret variable then carries its `value` (a reader MUST ignore `value` in a file that does not say
  `containsSecrets: true`);
- the zip has a `READ-ME-FIRST-CONTAINS-STREAM-KEYS.txt` at its root, visible to anyone who unzips it;
- tools should add a marker to the file name (for example `(CONTAINS STREAM KEYS)`) and show a warning when opening it;
- it MUST NOT be written in the directory form (which is for git, where history is forever): writers refuse.

On import, a value typed by the user beats the one in the file, and the one in the file beats what is already in OBS.

### `global/obs-websocket.json`: remote control

OBS's built-in WebSocket server settings (`plugin_config/obs-websocket/config.json`): port, whether a password is
required, and the password itself. Stream decks, overlays and scripts depend on them. The password is a `secret` variable
(target `global/obs-websocket.json#server_password`) with the same rules as a stream key: never in the directory form, only
in a file that says `containsSecrets`, and on import what was typed beats the file, which beats what OBS already has.
Importers may offer to skip it.

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
- `role`: `image | video | audio | font | script | other`. A `script` asset (an OBS Python or Lua script listed under
  `modules.scripts-tool` in a collection) is stored under `scripts/<id>/<filename>` instead of `media/`, up to 1 MB, and
  stays bundled in the directory form. On import it is written next to the other imported files and the collection's
  script path points at it. OBS still needs Python (or Lua) set up for it to run; the importer says so.

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

`version` (optional) is the newest version any computer saved the setup with, and is only known when the plugin tells
OBS one (`obs_module_version`; some plugins, such as PipeWire Audio Capture, do not). The importer warns when this
computer's version is older, and when OBS has the plugin switched off. Where a plugin is installed is never recorded: it is
looked for in OBS's own module list (`<settings folder>/plugin_manager/modules.json`) and in the plugin folders
(settings folder, `~/.local/share/obs-studio/plugins` for OBS 33 and newer, Flatpak data folders and extensions).

`provides` lists OBS identifiers the plugin supplies (source `id`, filter `id`, output `id`,
module name). The importer detects missing plugins by checking every `id` used in the collection
against what the target OBS has (module files present, or built-in ids).

### `platformOverrides` and `exclude`

`platformOverrides` is `{ "<source id>": { "<win32|darwin|linux|linux-pipewire>": "<id>" | null } }`: how the person wants a
source translated on another system. It wins over `platformMap` and over the built-in table, and a save never rewrites it
(unlike `platformMap`, which is derived).

`sourceOverrides` is the same shape keyed by one particular source: `u:<uuid>` (or `n:<name>` when OBS gave the source no uuid).
A source's own entry beats the `platformOverrides` entry for its kind; an import screen choice beats both (it may be keyed by
either the source key or the kind).

`exclude` is `{ collections?: string[], profiles?: string[], remoteControl?: boolean, scripts?: boolean }`: what saving from
OBS into this setup leaves out (names as OBS has them). Everything else in OBS is kept, including things added later. A save
reads it from the setup's *current* files, not from the commit OBS last matched.

### `platformMap`: sources that exist only on some platforms

Audio and capture sources translate in both directions (application audio: `wasapi_process_output_capture` ↔
`pipewire_audio_application_capture`, input and output audio likewise). On Linux `to["linux-pipewire"]` is used when the person
prefers PipeWire; PipeWire audio ids are only used when the plugin is installed (application audio always, as it has no other
stand-in). Before OBS 30.2 the unified `pipewire-screen-capture-source` is replaced by the two older PipeWire sources.
A Windows `window_capture` / `game_capture` with `capture_audio: true` becomes the stand-in plus a separate application audio
source placed after it in each scene that has it.

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

## Per-platform variants

A capture source only exists on some operating systems, and what it points at (a window, a screen, an audio device)
never carries over. So a setup keeps one version of each such source per platform, in a file next to the collection:

```
collections/main.json             the OBS collection as OBS wrote it
collections/main.platforms.json   { "<source name>": { "win32": {...}, "linux": {...}, "darwin": {...} } }
```

```json
{ "Game": {
    "linux": { "id": "pipewire-window-capture-source", "settings": { "...": "..." } },
    "win32": { "id": "game_capture", "settings": { "window": "Fortnite:UnrealWindow:FortniteClient.exe" } } } }
```

- Only sources whose `id` is platform-specific appear (the list is in the reference implementation, `sources.ts`).
  Each entry is `{ id, versioned_id?, settings }`; everything else about the source (name, volume, filters, position
  in scenes) is shared and stays in the collection.
- **Saving** on a platform replaces that platform's entries with what OBS has, keeps every other platform's, and drops
  names that are no longer platform-specific sources in the collection. A stand-in that an import put there and the
  user never set up is not recorded.
- **Importing** on a platform uses its entry when there is one. With none, the source is replaced by the default
  stand-in for that platform (settings cleared, and listed in the report) or, if there is none, kept and hidden.
- The collection file keeps the first saver's version of the source, so a save from another OS never rewrites it.
- The file is optional: a setup without it behaves as in version 1 without variants. Writers sort names and use the
  platform order `darwin, linux, win32` so saving twice gives identical bytes.
- Fields derived from the setup (`plugins`, `platformMap`) are computed from the collection files and the variants,
  never from one machine's live state. `source` and `generator` in a repository's manifest are frozen after the
  first save.

### Exact OBS names, and scripts that need their folder

`collections[].fileName` and `profiles[].dirName` (optional) are the file and folder names OBS used when they differ from what OBS
would call them for the shown `name`. Other tools can depend on them, so importers put them back exactly (except under "keep both").

A `variables[]` entry of kind `path` may carry `mustContain` (files that should be in that folder); importers warn when they are not.
Exporters use this for **script folders**: when an OBS script (`modules.scripts-tool[].path`) sits in a folder with other files and
looks around itself (`__file__`, `script_path()`, `dirname`), the script is not copied as an asset; a `SCRIPT_FOLDER` variable is declared and every
path inside that folder is written as `{{var:SCRIPT_FOLDER}}/<relative path>`. A suggested folder (`default`) is the first saver's and is
never rewritten by a later save.

The files of such a folder are kept in the setup: `projects` (optional) is a list of `{ variable, files[] }`, and each file is stored at
`scripts/projects/<variable>/<relative path>`. Only plain code and its notes are kept (`.py .lua .sh .bat .cmd .ps1 .txt .md`, and web files `.html .css .js`), not hidden files or
environment/media folders, at most two folders deep, at most 1 MB per file, 200 files and 5 MB in all. Importers write a file into the
folder the variable resolved to **only if** that folder is new or empty or already holds one of the variable's `mustContain` files (so a
file can never put code into an unrelated folder), only for the same allowed extensions, never outside the folder (no `..`, no hidden
names), skip a file that is already identical, and back up one they replace.

### Profile settings per system

`profiles/<id>/platforms.json` is `{ "<win32|darwin|linux>": { "ini": { "<section>": { "<key>": "<value>" } }, "files": { "streamEncoder.json": "<text>", "recordEncoder.json": "<text>" } } }`:
the lines of `basic.ini` that only make sense on one system (`[AdvOut]` and `[SimpleOutput]` encoders, `[Audio]` `*Device*` ids)
and the two encoder settings files. A save replaces only its own system's entry and leaves every other system's as it was,
even if the computer saving never uses them; the profile's own `basic.ini` and encoder files keep the lines they already had,
so two systems saving never fight over them. Loading uses the entry for its system when there is one, then checks the
encoders against what that OBS has (OBS's `plugin_manager/modules.json` lists each module's `encoders`) and swaps any it does
not have for `obs_x264` / `ffmpeg_aac` (dropping the old encoder's settings file), telling the person. The file is the setup's
own bookkeeping and is never written into OBS's folders.

## Setup steps (`setup`)

A setup that needs more than OBS settings (an installer, a helper program) can carry steps that an app runs for the person when they press a button, so nobody opens a terminal. Optional; a manifest without it behaves as before. Unknown fields are kept, so older readers keep it.

```json
"setup": { "steps": [
  {
    "id": "install",
    "title": "Set up the voice switcher",
    "why": "Opens the installer. It downloads what it needs and asks a few questions.",
    "run": {
      "win32": { "program": "{{var:SCRIPT_FOLDER}}/install.bat" },
      "linux": { "program": "{{var:SCRIPT_FOLDER}}/install.sh" },
      "darwin": { "program": "{{var:SCRIPT_FOLDER}}/install.sh" }
    },
    "mode": "open",
    "optional": false
  }
] }
```

- `id`: lower case letters, digits and `-`. `title` is required; `why` is one plain sentence.
- `run`: per system (`win32`, `darwin`, `linux`), or `any`. A system with no entry has no such step. An entry is `{ "program": string, "args"?: string[] }`: a program and its arguments, never a shell line.
- `cwd` (optional, templated): the folder to run in. Default: the first script folder, else the preset's folder.
- `mode`: `wait` (default: run it and show what it prints) or `open` (start it and leave it, for a program with its own window).
- Templates use the same tokens as the rest of the format: `{{var:NAME}}` (a folder variable, as chosen on that computer when the setup was applied, else its suggested place), `{{home}}`, `{{bundle}}` (the preset's own folder), `{{python}}` as the program (a Python 3 on that computer), and, in arguments, `{{obs}}` (the folder of the portable OBS this preset is linked to, empty when it is linked to an installed OBS or to none) and `{{obskind}}` (`portable`, `installed` or empty), so an installer can use the OBS the person already chose in the app.
- **Safety:** a reader must never run a step by itself. Each step is shown in words first and run only when the person asks. A program must be `{{python}}` or an absolute path **inside** the preset's folder or one of its folder variables; a working folder must be inside them too. A reader should remember what the person ran (a fingerprint of the step and the program file) and ask again when it changes. A step that cannot run on this system says why in words.

See the guide "Setups that install themselves".

## Which profile OBS opens with

OBS 31 and newer keep `Basic/Profile`, `ProfileDir`, `SceneCollection` and `SceneCollectionFile` in `user.ini` (the old
`global.ini` is only copied from once, on upgrade). Readers prefer `user.ini`; writers update every one of the two that
exists, and only `user.ini` for an OBS that has never run (a `global.ini` without a version makes a new OBS try to migrate it).

## Directory form (for git)

The same content unzipped, plus an `assets.lock.json`:

```
my-setup/
  manifest.json
  collections/  profiles/  scripts/  global/
  media/                    # only files the person chose to upload (mode `bundled`)
  assets.lock.json          # id -> { sha256, size, hint }: every external asset, committed
  preset-settings.json      # this preset's own settings (what is uploaded, where big files are kept), tracked
  .gitignore                # local/
  local/                    # NEVER tracked: this computer's own part of a preset (see below)
```

- Secrets are never in the repository (`secret` variables carry only their name).
- **The local part (`local/`).** A preset made by the app also has a `local/` folder that git never sees (`.gitignore` and the
  repository's own `info/exclude`): `local/keys.json` (stream keys by variable name, file mode 0600), `local/media/<asset id>/<file>`
  (this computer's copy of each file the scenes use) and `local/settings.json` (this preset's own choices: whether to keep keys,
  which files not to copy, and which parts are **not uploaded**). Readers of the directory form ignore `local/`. It is not part of
  the bundle format and is never written into a bundle unless the person exports with keys / chosen files.
- **The preset's settings travel with it (`preset-settings.json`).** The shareable part of the settings (`keepKeys`,
  `skipLocalMedia`, `cloud` with `skip` / `media` / `stored`, and `storage`) is also written as a tracked file at the top of the
  preset, so a copy from GitHub or from a setup file behaves like the original. It never holds a key or a password. When the file
  changes from outside (an update from GitHub), it replaces this computer's choices; otherwise this computer's own
  `local/settings.json` wins (`mirrored` in it is the hash of the file as last written or taken over). A setup file made as an
  *independent* copy leaves it out. Who saves are by (`author`) stays in `local/settings.json` only.
- **Big-file storage.** `storage` is `{ endpoint, region, bucket, prefix?, label? }`: an S3-compatible bucket (Backblaze B2,
  Cloudflare R2, …). Files listed in `cloud.stored` are not in git and not in `local/` of another computer: each is kept at
  `<prefix><sha256>/<file name>` in the bucket and fetched by the hash the manifest records for that asset, then checked against it.
  Access keys are never in the preset; each computer keeps its own, encrypted by the system.
- **Parts kept off the upload.** Choices in `local/settings.json` (`cloud.skip`: scene layout ids, output setting ids, scripts,
  remote control; `cloud.media`: asset ids that **are** uploaded) are applied through the repository's `info/exclude` (this computer only),
  so such parts stay on disk and are saved from OBS as usual but are never committed. The manifest still lists them; a copy made from
  the upload lacks their files, and readers leave an entry out of the lists when its files are not there. Files that are uploaded are
  kept as `bundled` assets under `media/<id>/<file>`; all other assets are placeholders.
- Large or private media are `external`: git stores the **placeholder** (`assets.lock.json`), and a
  pull asks for the files that are missing or whose hash changed.
- The tool keeps the user's chosen locations in its own local store, not in the repository.
- **Local edits are preserved.** The tool never writes OBS's live state over the repository. Each clone keeps a local
  bookmark (a git ref under `refs/obs-config-loader/synced/`, never pushed) for the commit OBS last matched. Saving
  live edits commits them on top of **that** commit in a scratch checkout and then merges the result into the
  repository's current head (a fast-forward when nothing else changed). So a change made in the repository in between
  (by hand, pulled from another machine, or by an AI) and a change made in OBS both survive. A true conflict aborts
  the merge and is reported; nothing is left half-merged. After the repository is loaded into OBS the bookmark moves
  to the head.
- **Uncommitted edits in the repository** are never overwritten: saving refuses until they are committed.
- `revision` and `exportedAt` in `manifest.json` are left alone in the directory form (git history is the revision list),
  so two machines never conflict on them.
- **Platform-specific sources** (for example a Windows `window_capture`, a Linux `pipewire-window-capture-source`) are
  kept **per platform**, see "Per-platform variants" below. Saving on one OS only ever changes that OS's entries.

## Versioning and compatibility

- Additive changes (new optional fields) keep `version: 1`. Readers ignore unknown fields and
  must preserve them when re-writing.
- Breaking changes bump `version`. Writers should write the lowest version that can hold the content.

## Extras file (`.obsextras`)

A zip with `extras.json` at the top: the part of a preset that is **not** on its online copy, so it can be brought to another computer
that got the preset from there.

```
{ "format": "obs-config-extras", "version": 1, "presetId": "<the preset's manifest id>", "presetName": "...", "createdAt": "...",
  "files": ["collections/main.json", ...],          // tracked-path files that were kept off the upload, stored at files/<path>
  "cloudSkip": { "layouts": [...], "outputs": [...], "scripts": true, "remoteControl": true },
  "media": [{ "id": "...", "filename": "...", "size": 0 }],   // stored at media/<id>/<filename>
  "containsSecrets": true, "warning": "...", "keys": { "VARIABLE": "value" } }   // keys only when the person chose to include them
```

Importing refuses a preset with a different `presetId`, never overwrites a file the preset already has, only accepts safe relative
paths, puts files under `local/media/`, merges the keys into `local/keys.json`, and records `cloudSkip` so those parts stay out of git on
the receiving side too.
