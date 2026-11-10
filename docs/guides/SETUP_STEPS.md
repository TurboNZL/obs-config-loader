# Setups that install themselves

Some setups need more than OBS settings: a helper program, an installer, a script that has to be set up before it works. A preset can carry **setup steps** for that. Each step is a button. The person who uses your preset presses it, watches it work in plain words, and **never opens a terminal**.

Use this when a friend, a team or a stream crew who are not technical need to get a complicated setup running.

## What a person sees
After they apply the preset, a card called **Finish setting up** lists the steps:

- the name of the step and one sentence about what it does
- **Run** (or **Open it** for a program with its own window)
- **What exactly will run**, folded away, for anyone who wants to look
- while it runs: "Working… this can take a few minutes", and afterwards **Finished.** or a plain sentence saying it did not finish, with what it printed one click away

Nothing runs by itself. A preset can come from anyone, so every step waits for a button press. If a step (or the file it runs) changes after the person last ran it, the app says so and asks again.

## Adding a step to your preset
Open the preset on the **Presets** page, press the small arrow to show its details, then **Add a setup step…**

1. **Name of the step**, for example "Set up the voice switcher".
2. **What it does**, one sentence.
3. **What to run on Windows**, and **What to run on Linux and Mac**: the file to run. Leave one empty if the step is not needed there.
4. **Extra words to give it** (optional), one per line.
5. Tick **It opens its own window** if the program is a window of its own (an installer with buttons). Leave it unticked for a program that prints and finishes.

The step is saved inside the preset, so it travels with it: in a setup file, on GitHub, anywhere.

### Writing "what to run"
A step runs **a file that is part of the preset**, written with a folder in double curly brackets:

| Write | Means |
|---|---|
| `{{var:SCRIPT_FOLDER}}/install.bat` | a file inside the script folder the preset keeps (the folder name is shown in the form) |
| `{{bundle}}/scripts/tool/setup.py` | a file inside the preset's own folder |
| `{{obs}}` / `{{obskind}}` | In arguments only: the portable OBS folder this preset is linked to (empty if none), and `portable` / `installed` / empty |
| `{{python}}` | Python 3, whichever one that computer has (the app finds it) |
| `{{home}}` | the person's home folder |

So the same step works on every computer, wherever each person put the folder when they applied the preset.

**Safety rules the app enforces:** a step may only run Python or a file inside the preset's own folders. It cannot name some other program on the computer, and it cannot run outside those folders. Anything else is shown as "not part of this setup, so it is not allowed" and has no button. Nothing is ever run through a shell, so a step cannot sneak a second command in.

## Example: a setup with its own installer
A stream setup keeps a script in a folder with its own installer (`install.bat` for Windows, `install.sh` for Linux). The installer downloads what it needs, asks for a few details in a window, and sets everything up. Add one step:

- **Name:** Set up the voice switcher
- **What it does:** Opens the installer. It downloads what it needs and asks a few questions.
- **Windows:** `{{var:SCRIPT_FOLDER}}/install.bat`
- **Linux and Mac:** `{{var:SCRIPT_FOLDER}}/install.sh`
- tick **It opens its own window**

A friend then does three things: install OBS Config Loader, open the file you sent, press **Apply**, then press **Open it** on the card that appears. That is all.

## When a step does not work
- **"Not ready yet: the folder … is not set"**: the person has not applied the preset yet, so the folder does not exist. Apply first.
- **"The program this step runs is not on this computer yet"**: same thing, apply first so the files are put there.
- **"needs Python 3"**: the step uses `{{python}}` and the computer has none. Put the Python install in an earlier step, or make your own installer fetch it.
- **It did not finish**: open "Show what it said". Fix what it says and press **Run** again; steps are meant to be safe to repeat.

## Tips for a good step
- Make it **safe to run twice**. People will press it again after a failure.
- Make the program **talk in plain words** (what it is doing, not just file names); that is what the person sees.
- Keep secrets out of the steps and out of the files next to them. A preset can go online, and the app leaves out any text file next to a script that looks like it holds a password or key.
- Put several small steps rather than one giant one if parts are optional: mark those **optional**.

## For people writing a preset by hand
Steps are the `setup` field of `manifest.json`; see "Setup steps" in `docs/FORMAT.md`.
