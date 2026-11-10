# Getting started

OBS Config Loader moves your whole OBS setup between computers, and can keep it safely backed up. Your scenes, sources, stream and recording settings and pictures all travel together, and it works between Linux, Windows and Mac.

## The words used in the app
- **Save**: from OBS into a preset.
- **Apply**: from a preset into OBS.
- **Import / Export**: a setup file or an extras file, into the presets folder or out of a preset.
- **Upload / Get updates**: between a preset and GitHub.
- **Link**: the chain button on a preset. A linked preset is kept in step with one OBS on this computer.

## Setups that need more than OBS settings
If a setup comes with a helper program or an installer, applying it shows a **Finish setting up** card with a button for each step. Press it; nothing needs a terminal. See the guide "Setups that install themselves" to make one.

## Presets
A **preset** is a complete copy of your OBS setup, kept on this computer: scene layouts, output settings, scripts (with the code files next to them), OBS's remote-control settings, your stream keys and the pictures, sounds and videos your scenes use. Everything lives under **Presets**, shown as tiles side by side.

- **Make a preset from my OBS** makes a preset from an OBS on this computer. Pick what to include and where it goes.
- **Import a file…** turns a setup file (.obsbundle) into a preset in the app's presets folder, or puts an extras file (.obsextras) into the preset it belongs with. Its stream keys and files go inside the preset, on this computer only.
- **Get one from GitHub…** downloads a preset you already have there (or paste any git address).
- The presets folder is in the place your system keeps an app's own data (on Linux `~/.local/share/obs-config-loader/presets`). You can change it under **Settings**.

## Three ways a preset is saved
Each tile shows them in their own colour:
- **On this computer** (green): the preset itself. It holds everything: all your scenes and settings, your stream keys, and a copy of every file the scenes use.
- **On GitHub** (blue): a copy that is uploaded every time you save, when **Back up online** is on. **You choose per preset what goes up.** Under **Show details**, **Where each part is kept** has a GitHub column: untick a scene layout, output settings, scripts or a file to keep it only on this computer. The tile says plainly what is **not on GitHub**. Stream keys can never go up (see below).
- **As a file** (orange): the **export** button on the tile makes a setup file, or only the extras (see below).

## Linking a preset to an OBS
The **chain button** on a tile links the preset to one of the OBS installs on this computer. A linked preset shows how it stands against *that* OBS by name (“OBS Studio (Flatpak) has 3 changes this preset does not have yet”), and gives you **Update preset from OBS** and **Apply to OBS…**. Press the chain again to **unlink**: the preset stays exactly as it is and keeps working on its own (you can still apply it to any OBS). Link it again any time. Applying a preset offers to link it afterwards.

## What changed
When a linked OBS has changes the preset does not, **See what changed** lists each changed part in plain words, with the lines added in green and removed in red. Changes that only affect this computer's own part (a stream key, a file) are listed too.

## Where this preset stands
Every tile shows where it stands:
- **On this computer**: whether the linked OBS has changes the preset does not (press **Update preset from OBS**), or the preset has changes OBS does not (press **Apply to OBS…**), or they match. After **Get updates** the preset is newer than OBS, so this line tells you to apply it: getting updates only updates the preset, not OBS.
- **On GitHub** (with the name it has there): whether they match, how many saves are not uploaded yet (**Upload**), or how many newer changes GitHub has (**Get updates**).
- **Home** shows the same things for all your presets at once, plus how much space they take and what needs a look.

## Export: a file, or only the extras
The **export** button on a tile offers two things:
- **The whole preset in one file** (.obsbundle), for another computer or another person. You pick which big files go in (small ones, under 5 MB, always do), and whether the stream keys go in (off by default; a file with keys is marked in its name and warns whenever it is opened). **Give whoever opens it a preset of their own** (on by default) gives the file its own identity and no link to your GitHub copy, so the person who opens it makes their own GitHub backup and your histories never meet. Turn it off to keep the file linked to this preset, which suits moving it between your own computers.
- **Only the extras** (.obsextras): just what GitHub does not have: the parts you kept off GitHub, the files, and optionally the stream keys. Use it together with the GitHub copy: get the preset from GitHub on the other computer, then **Import a file…** the extras file into it. (Extras files over 2 GB cannot be opened by the app: copy such files by hand.)

## Names on GitHub
Every repository this app makes is called `OBS-Config-<name>`, so they are easy to find among your others. You can pick the part after the dash when you switch backup on, and change it later under **Show details**, **Name on GitHub**. The preset follows the rename, and GitHub forwards the old name for other computers.

## When this computer and GitHub disagree
If you saved on this computer while the online copy was changed somewhere else, the preset shows a red box saying **both have changed**, with when each was last saved and by whom, so you can tell which is really newer. You choose:
- **Combine them** merges the two (if they changed the same part, you are asked whose version to keep for just that part).
- **Keep mine (replace the online copy)** makes GitHub match this computer. It only works if nobody saved online since the app last looked, so it can never silently erase someone's newer work.
- **Use the online one (replace mine)** makes this computer match GitHub. Your version is kept (see History, a branch named “before-online-…”), so nothing is lost.

## Big files
A preset keeps its own copy of every file the scenes use (a fast copy-on-write copy where your disk supports it), so it is complete by itself. Untick a file's **This computer** box under **Where each part is kept** to not keep a copy. The app still remembers where each file is on this computer, and a copy of the preset that came from GitHub (which does not hold big files unless you chose to upload them) asks for any it cannot find: point to them, or import the extras file. GitHub refuses files over 100 MB, so those can only stay on your computer or go in a file.

## Big-file storage (not GitHub)
Under **Settings**, **Big-file storage** connects a space of your own for videos and other big files: any S3-style storage, such as Backblaze B2 or Cloudflare R2 (both list about 10 GB free; check their pages for today's terms and whether they ask for a payment card). You enter the address, the space's name and an access key; the app writes a small test file, reads it back and removes it before it keeps anything. The keys stay on this computer, encrypted by your system, and are never put in a preset or on GitHub.

Then, in a preset's **Where each part is kept**, tick **Big-file storage** next to a file. The file is uploaded once, and the preset keeps only a note of it, so the GitHub copy stays small. On another computer, connect to the same space (a preset that uses one tells you which, and only asks for the keys), then press **Download from storage**. Every download is checked against the file's fingerprint, so a broken file is thrown away rather than used. Un-ticking a file does not delete it from your storage space.

## Who your saves are by
Every save in a preset carries a name and an email address, and anyone who can see a preset on GitHub sees them. By default the app uses your **GitHub account's** name and GitHub's private "no-reply" address; under **Settings**, **Who your saves are by**, you can choose any name instead (a stage name, say). Your computer's own git settings are never read for this and never changed. A single preset can have its own name under **Show details**.

To fix the saves a preset already has, open **Show details**, **Who the saves are by**, type the name and press **Change the name on all earlier saves…**. Every save, from the first, then says that name; the files, messages and dates stay the same, and the GitHub copy is replaced. Copies other people already have, and old links to GitHub, can still show the old name, so for a preset that must never reveal it, make a fresh GitHub copy (switch online backup off, then on).

## Windows, Linux and Mac settings in one setup
Screen, window and sound capture only exist on some systems, so each is swapped for the closest one on another system. Under **Show details**, **How sources change on other computers**, you can change that for every source of a kind, or open **Choose for one source at a time** to treat one source differently from the others of its kind (the Apply screen offers the same choice per source, for one use only). These choices, and the choices under **Where each part is kept**, are saved inside the preset (a small file called preset-settings.json plus the preset's own settings), so they come along to GitHub and to a setup file.

A setup keeps each system's own encoders and audio devices (and capture sources) side by side. Saving from Windows never overwrites what Linux saved, even if the Windows computer never uses it, and each computer loads its own. If an encoder does not exist in the OBS you load into (a hardware encoder the graphics card does not have, say), it is swapped for the standard software one and you are told, so the Settings window never opens with empty boxes.

## Choosing what goes where
Under **Show details**, **Where each part is kept** has two columns. **This computer** untick leaves a part out of the preset altogether (anything new you add in OBS is kept unless you leave it out). **GitHub** untick keeps a part on this computer only: it is taken out of what is uploaded right away (what is already in GitHub's history stays there).

Stream keys have a row too, with **never** in the GitHub column. GitHub's own "secrets" feature cannot hold them for this app: it is write-only. A program can put a secret in, and only GitHub's own automation can use it; nothing, not even you, can read it back to your computer. A key stored there could never come back to another computer. To move keys, export the preset to a file with **Include my stream keys** ticked and keep that file private.

## Moving a preset
**Show details**, then **Move to another folder…** moves a preset (its history comes with it). Under **Settings** you can change where new presets go, and move your existing ones there too.

## When a setup moves between Windows, Linux and Mac
Sources that only exist on one system are swapped for the closest one. Examples: Windows window capture becomes PipeWire screen capture on Linux; Windows application audio capture and PipeWire application audio swap with each other; a Windows window capture with **capture audio** switched on becomes a PipeWire capture plus its own application audio source. You pick the window or program again either way. If the app guessed wrong, open **Show details** on the preset and change **How sources change on other computers**. PipeWire audio needs the PipeWire Audio Capture plugin; the app says so when it is missing.

## Renaming
Open **Show details** on a preset to rename the preset, a scene layout, output settings, a scene, or any source. The new name is used everywhere it appears, and if your OBS has the same thing, it is renamed there too (close OBS first). Nothing is left behind under the old name.

## Stream keys
A stream key is the secret that lets OBS go live on your channel.

- **They are kept inside the preset, on this computer.** When you save a preset, your stream keys go into the preset's own private part (the `local` folder inside it), so applying the preset puts them back without typing. They are stored as a plain file, the same way OBS itself keeps them, so protect your presets folder like OBS's own folder.
- **They never go online and never into the history.** That part of the preset is never uploaded and git never sees it. Turn keeping them off under **Settings**, or for one preset under **Where each part is kept**.
- **In a file, if you choose.** When exporting you can tick **Include my stream keys**. Then the file's name says **(CONTAINS STREAM KEYS)**, there is a note inside, and the app shows a red warning every time it is opened. Anyone who has such a file can stream as you. Keep it private and delete it once you have used it.
- A setup file that has keys inside, when imported, keeps them inside the new preset only.
- When you apply something without keys, the key OBS already has is kept.

## What a preset needs
**Show details** lists the OBS version the preset was saved with, the plugins it uses (with their version when the plugin reports one), its scripts, and whether it includes OBS's remote-control settings. When you load a preset onto a computer with an older OBS or plugin, or a plugin switched off in OBS, the app tells you first. Scripts are put back with their paths fixed, but OBS still needs Python set up (Tools, Scripts) for them to run.

## Online backup
Presets use Git (a free tool) and, optionally, GitHub. Everything is done in the app, you never need a terminal. Go to **Settings** to set up the account:
- **No Git yet?** Settings offers to install it for you.
- **GitHub.** Press *Open GitHub's token page*, press *Generate token* there, and paste the token into the app. The token is kept in your system's keychain; it is never written into a file or an address.
- Then switch on **Back up online** on a preset (it is in the GitHub block of the tile), or tick it when making a new one. **Get one from GitHub…** downloads a preset you already have there (or paste any git address).
- If the preset changed online in the meantime, your OBS edits are *combined* with those changes. If both changed the same part, nothing is changed until you choose whose version to keep for just that part.
- **Get updates** and **Upload now** talk to the online copy. After getting updates, **Apply to OBS…** puts them into OBS.
- Stream keys and any part you kept off GitHub are not stored online. After getting updates, the app asks you to point to any big file that is missing, or you import the extras file.

## One setup, several operating systems
Capture sources (a window, a screen, a game, an audio device) only exist on some systems and never carry over. A setup keeps **one version of each per system**: set up your Windows game capture on Windows and your PipeWire capture on Linux, and saving on one never overwrites the other. When you load the setup, it uses that system's own version. If a system has none yet, the app says which captures need setting up again.

## A second OBS (a light one for everyday, a heavy one for plugins)
Under **OBS on this computer**, *Make a second OBS* runs the same OBS program with its **own scenes, settings and plugins**. It starts completely fresh, as if OBS had just been installed: nothing from your other OBS is copied unless you tick the option to start from a copy (that copies stream keys too). It never copies a portable OBS folder. Put a heavy plugin (a multistream add-on, say) only in the second one and your everyday OBS starts as fast as before. Both can be open at the same time.

- Works for the Linux system package and for Flatpak. Windows and Mac give OBS no way to use another settings folder; use OBS in its own folder there (add it with *Add OBS from a folder*).
- After *Start OBS* the app checks that the second OBS really uses its own settings. If it did not (for example Flatpak ignored the setting), it tells you not to apply anything to it.
- Its plugin folder is shown on its card (*Show plugins folder*). Plugins installed as Flatpak extensions are shared by every Flatpak OBS; put plugins you want kept separate in that folder instead.
- Applying a setup only waits for the OBS that uses the same settings, so a second OBS being open never blocks the first.

## Choosing what swapped sources become
When you apply a setup made on another kind of computer, the **Here is what will happen** step lists every source that had to be swapped or hidden, each with a **Use instead** menu. Pick another stand-in, or **Hide it**, and the summary updates straight away. To make a choice stick for a preset, set it under **How sources change on other computers** in the preset's details.

## Tools that live next to your OBS script
Some OBS scripts find other files by where they are (a helper script, images, an audio pipe). Moving only the script would break them, so when a script's folder holds other files it uses, the setup asks, once per computer, **where that folder is**, and everything inside it (the script, its images, its pipes) is kept relative to that folder.

The script itself and the code files beside it (`.py`, `.lua`, `.sh`, `.bat`, `.cmd`, `.ps1`, `.txt`, up to two folders deep, each under 1 MB) are **kept in the preset**, so they have a history and travel with it. Hidden files (such as `.env`), environments (`venv`), pictures and everything else in that folder are not kept. When you apply the preset, the files are put into the folder you chose if it is new, empty, or already is that project; any other folder is left alone. A file that differs is replaced, with a backup copy first. A script that stands on its own is copied with the setup.

OBS file and folder names are kept exactly as OBS had them (a profile folder called `MyTool_Profile` stays that, even if the profile is shown under another name), because other tools may look for them by name.

## Plugins
A missing plugin never stops you applying a setup: its sources stay empty until you install it and restart OBS. A plugin that does not exist for your kind of computer (the PipeWire audio plugin on Windows, say) is marked **not needed on this computer**; its sources are swapped for Windows ones instead.

Plugins are not part of a preset. When you save, the app lists the plugins your setup uses; when you apply, it checks which are installed on this computer (asking OBS itself, so it does not matter where the plugin's files are) and shows where to get the missing ones. Install them, then restart OBS.

OBS 33 and newer look for plugins you add yourself in `~/.local/share/obs-studio/plugins` on Linux; older versions use the plugins folder in the settings folder (File, Show Settings Folder). The app knows both.

## If something goes wrong
- **Applied the wrong thing?** Every apply keeps a backup copy of what it replaced. The *Done* screen shows where it is.
- **OBS shows empty sources after applying?** A plugin or a big file is probably missing. The *what will happen* list names them.
- **Not sure which OBS is which?** *OBS on this computer* lists every one with where its settings live.
