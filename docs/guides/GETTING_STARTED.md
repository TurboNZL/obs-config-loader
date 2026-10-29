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

## Using git
Export as **A folder for git**. Scenes and profiles are plain files you can commit; big media are recorded as placeholders with checksums. Open that folder on another machine with **Open a folder** on the import page.
