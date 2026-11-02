# Getting started

OBS Config Loader moves your whole OBS setup between computers, and can keep it safely backed up. Your scenes, sources, stream and recording settings and pictures all travel together, and it works between Linux, Windows and Mac.

## Presets
A **preset** is a saved copy of your OBS setup: your scenes, output settings, plugin list, scripts and OBS's remote-control settings. Everything lives under **Presets**.

- **New preset from my OBS** saves what is in OBS now. Each preset gets its own folder inside the app's presets folder (change it under **Settings**).
- **Save OBS to this preset** updates it after you change things in OBS.
- **Load into OBS…** puts a preset into the OBS on this computer. Close OBS first: it saves over its own files when it closes and would undo the change. Before you load, the app shows **what will happen** in plain words: what will be replaced (a backup copy is always kept first), which plugins you still need, and anything you need to set up again.
- **Export to a file…** makes one file you can copy to another computer (USB stick, cloud drive, anything). On that computer press **Open a setup file…** on the Presets page.
- **Back up online** keeps a copy on GitHub that is updated every time you save. Switch it on per preset; you can use the same preset on all your computers.

## Renaming
Open **Show details** on a preset to rename the preset, a scene layout, output settings, a scene, or any source. The new name is used everywhere it appears, and if your OBS has the same thing, it is renamed there too (close OBS first). Nothing is left behind under the old name.

## Stream keys
A stream key is the secret that lets OBS go live on your channel.

- **They are never stored in a preset folder or online.** That keeps presets safe to share.
- **Remembered on this computer.** When you save a preset, your stream keys are kept encrypted by your system's keychain, only on this computer, so you can load the preset again without typing them. Turn this off under **Settings**. Without a system keychain nothing is remembered.
- **In a file, if you choose.** When exporting you can tick **Include my stream keys**. Then the file's name says **(CONTAINS STREAM KEYS)**, there is a note inside, and the app shows a red warning every time it is opened. Anyone who has such a file can stream as you. Keep it private and delete it once you have loaded it.
- When you load something without keys, the key OBS already has is kept.

## What a preset needs
**Show details** lists the OBS version the preset was saved with, the plugins it uses (with their version when the plugin reports one), its scripts, and whether it includes OBS's remote-control settings. When you load a preset onto a computer with an older OBS or plugin, or a plugin switched off in OBS, the app tells you first. Scripts are put back with their paths fixed, but OBS still needs Python set up (Tools, Scripts) for them to run.

## Online backup
Presets use Git (a free tool) and, optionally, GitHub. Everything is done in the app, you never need a terminal. Go to **Settings** to set up the account:
- **No Git yet?** Settings offers to install it for you.
- **GitHub.** Press *Open GitHub's token page*, press *Generate token* there, and paste the token into the app. The token is kept in your system's keychain; it is never written into a file or an address.
- Then switch on **Back up online** on a preset, or tick it when making a new one. **Get one from GitHub…** downloads a preset you already have there (or paste any git address).
- If the preset changed online in the meantime, your OBS edits are *combined* with those changes. If both changed the same part, nothing is changed until you choose whose version to keep for just that part.
- **Get updates** and **Upload now** talk to the online copy. After getting updates, **Load into OBS…** puts them into OBS.
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
Plugins are not part of a preset. When you save, the app lists the plugins your setup uses; when you load, it checks which are installed on this computer (asking OBS itself, so it does not matter where the plugin's files are) and shows where to get the missing ones. Install them, then restart OBS.

OBS 33 and newer look for plugins you add yourself in `~/.local/share/obs-studio/plugins` on Linux; older versions use the plugins folder in the settings folder (File, Show Settings Folder). The app knows both.

## If something goes wrong
- **Loaded the wrong thing?** Every load keeps a backup copy of what it replaced. The *Done* screen shows where it is.
- **OBS shows empty sources after loading?** A plugin or a big file is probably missing. The *what will happen* list names them.
- **Not sure which OBS is which?** *OBS on this computer* lists every one with where its settings live.
