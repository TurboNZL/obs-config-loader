# Getting started

## Move a setup between machines
1. On the machine that has your OBS set up: **Export a setup**, pick the install, and save the `.obsbundle`.
2. On the other machine (any OS): **Import a setup**, open the file, pick the OBS to load it into.
3. Fill in your details. Stream keys are never inside a bundle, so you type them once (and can let the app remember them, encrypted with the system keychain).
4. Point the app at any big media files it left out.
5. Read the report. It lists missing plugins (with install steps), sources that had to change for this OS, and every file that will be written. Then press **Import**.
6. Start OBS.

Close OBS before importing: it rewrites its files when it quits and would undo the import. The app tells you if it is running.

## Portable installs
Portable OBS is a folder, so it cannot be found automatically. **OBS installs > Add a portable install** and choose that folder.

## Plugins
Plugins are not part of a bundle. The report says which ones the setup uses and whether they look installed; install the missing ones yourself.

## Keeping a setup in git
Open **Git repositories**. Everything is done in the app; you never need a terminal.

- **No git installed?** The page offers to install it for you (or shows the one command to copy).
- **GitHub (optional).** Press *Open GitHub's token page*, press *Generate token* there, and paste the token into the app. Then you can create a repository on GitHub in the same step as creating it here, publish an existing one with one click, and pick your repositories from a list. The token is kept in your system keychain; the app never writes it into a file or an address.
- **Start one** from an OBS install: tick *Also create it on GitHub* if you want it online.
- **Get one** that already exists: choose it from your GitHub list, or paste any git address.
- **Not on GitHub?** Paste any git address under *Online copy*; your own git setup provides the credentials.

- **Save OBS changes to the repo** commits what is in OBS now. Do this before you (or an AI) change the repository, so the next change starts from what you actually have.
- If the repository changed in the meantime, your OBS edits are *merged* with those changes rather than replacing them. If both changed the same lines, nothing is changed until you choose whose version wins for just those lines.
- Files you edited in the repository by hand must be committed first; the app asks and never overwrites them.
- **Pull** and **Push** talk to your remote. After a pull, **Apply to OBS** loads the new state.
- Big media files are not in git. The repository lists them with checksums, and after a pull the app asks you to locate any that are missing or newer.
- **Apply to OBS** warns when OBS has edits the repository does not have yet, and offers to save them first.

## Using git (the plain way)
Export as **A folder for git**. Scenes and profiles are plain files you can commit; big media are recorded as placeholders with checksums. Open that folder on another machine with **Open a folder** on the import page.

## One setup, several operating systems
Capture sources (a window, a screen, a game, an audio device) only exist on some systems and never carry over. A setup keeps **one version of each per system**: set up your Windows game capture on Windows and your PipeWire capture on Linux, and saving on one never overwrites the other. When you load the setup on a system, it uses that system's own version. If a system has none yet, the report says which sources got a stand-in that you need to set up again.

## A separate OBS (light one for everyday, heavy one for plugins)
Under **OBS installs**, *Make a separate OBS* creates a second OBS that uses the same program but has its **own scenes, settings and plugins**. Put a heavy plugin (a multistream add-on, say) only in the separate one and your everyday OBS starts as fast as before. Both can run at the same time.

- Works for the Linux system package and for Flatpak. Windows and macOS give OBS no way to be pointed at another settings folder; use a portable copy of OBS there (each portable folder is its own OBS, add it with *Add a portable install*).
- After *Start OBS* the app checks that the separate OBS really made its own settings. If it did not (for example Flatpak ignored the setting), it tells you not to import into it.
- Its plugin folder is shown on its card (*Open plugins folder*). Plugins installed as Flatpak extensions are shared by every Flatpak OBS; put plugins you want separate in its folder instead.
- An import only waits for the OBS that uses the same settings folder, so a running separate OBS never blocks the main one.
