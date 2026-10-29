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
Open **Git repositories**. Start a repository from an OBS install, open a folder you already have, or clone one (your own git credentials are used; the app never asks for a password).

- **Save OBS changes to the repo** commits what is in OBS now. Do this before you (or an AI) change the repository, so the next change starts from what you actually have.
- If the repository changed in the meantime, your OBS edits are *merged* with those changes rather than replacing them. If both changed the same lines, nothing is changed and you are told.
- Files you edited in the repository by hand must be committed first; the app asks and never overwrites them.
- **Pull** and **Push** talk to your remote. After a pull, **Apply to OBS** loads the new state.
- Big media files are not in git. The repository lists them with checksums, and after a pull the app asks you to locate any that are missing or newer.
- **Apply to OBS** warns when OBS has edits the repository does not have yet, and offers to save them first.

## Using git (the plain way)
Export as **A folder for git**. Scenes and profiles are plain files you can commit; big media are recorded as placeholders with checksums. Open that folder on another machine with **Open a folder** on the import page.
