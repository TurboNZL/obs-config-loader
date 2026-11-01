# Getting started

OBS Config Loader moves your whole OBS setup between computers, and can keep it safely backed up. Your scenes, sources, stream and recording settings and pictures all travel together, and it works between Linux, Windows and Mac.

## Move your setup to another computer
1. On the computer that has your OBS set up, open **Save my setup**. Choose what to include and press **Save to a file…**.
2. Copy the file to the other computer (USB stick, cloud drive, anything).
3. On the other computer, open **Load a setup**, choose the file, and press **Load into OBS**.

Close OBS before loading: it saves over its own files when it closes and would undo the change. The app tells you if OBS is open.

Before you load, the app shows **what will happen** in plain words: what will be replaced (a backup copy is always kept first), which OBS plugins you still need to install, and anything you need to set up again.

## Stream keys
A stream key is the secret that lets OBS go live on your channel.

- **By default your stream keys are not in the file.** That makes the file safe to share. When you load it, the app asks for each key (or keeps the one OBS already has if you leave it empty).
- If the file is just for you, for example to move to your other computer in one step, you can tick **Include my stream keys in the file** when saving. Then:
  - the file's name says **(CONTAINS STREAM KEYS)**, and so does a note inside it;
  - the app shows a red warning every time it is opened;
  - it can never be put into an online backup.
  
  Anyone who has such a file can stream as you. Keep it private and delete it once you have loaded it.

## Online backup
Under **Online backup** you can keep your setup on GitHub (or any git server). Every change is kept as a version, you can use the same setup on all your computers, and edits you make in OBS are never lost when the setup changes somewhere else. Stream keys are never stored in it.

Everything is done in the app, you never need a terminal:
- **No Git yet?** The page offers to install it for you.
- **GitHub (optional).** Press *Open GitHub's token page*, press *Generate token* there, and paste the token into the app. Then you can create a backup on GitHub in one step, publish an existing one with one click, and pick your backups from a list. The token is kept in your system's keychain; it is never written into a file or an address.
- **Start one** from your OBS: tick *Also create it on GitHub* if you want it online.
- **Use a backup you already have:** choose it from your GitHub list, or paste any git address.
- **Save my OBS changes to the backup** keeps what is in OBS now. Do this before you (or an AI assistant) change the backup, so the next change starts from what you really have.
- If the backup changed in the meantime, your OBS edits are *combined* with those changes. If both changed the same part, nothing is changed until you choose whose version to keep for just that part.
- **Get updates** and **Upload** talk to the online copy. After getting updates, **Load into OBS** puts them into OBS.
- Big pictures, sounds and videos are not stored online. After getting updates, the app asks you to point to any that are missing.

## One setup, several operating systems
Capture sources (a window, a screen, a game, an audio device) only exist on some systems and never carry over. A setup keeps **one version of each per system**: set up your Windows game capture on Windows and your PipeWire capture on Linux, and saving on one never overwrites the other. When you load the setup, it uses that system's own version. If a system has none yet, the app says which captures need setting up again.

## A second OBS (a light one for everyday, a heavy one for plugins)
Under **OBS on this computer**, *Make a second OBS* creates another copy of OBS with its **own scenes, settings and plugins**. Put a heavy plugin (a multistream add-on, say) only in the second one and your everyday OBS starts as fast as before. Both can be open at the same time.

- Works for the Linux system package and for Flatpak. Windows and Mac give OBS no way to use another settings folder; use OBS in its own folder there (add it with *Add OBS from a folder*).
- After *Start OBS* the app checks that the second OBS really uses its own settings. If it did not (for example Flatpak ignored the setting), it tells you not to load anything into it.
- Its plugin folder is shown on its card (*Show plugins folder*). Plugins installed as Flatpak extensions are shared by every Flatpak OBS; put plugins you want kept separate in that folder instead.
- Loading a setup only waits for the OBS that uses the same settings, so a second OBS being open never blocks the first.

## Plugins
Plugins are not part of a setup file. When you save, the app lists the plugins your setup uses; when you load, it checks which are installed on this computer and shows where to get the missing ones. Install them, then restart OBS.

## If something goes wrong
- **Loaded the wrong thing?** Every load keeps a backup copy of what it replaced. The *Done* screen shows where it is.
- **OBS shows empty sources after loading?** A plugin or a big file is probably missing. The *what will happen* list names them.
- **Not sure which OBS is which?** *OBS on this computer* lists every one with where its settings live.
