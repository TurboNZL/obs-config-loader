# Script screens: how an installer or manager draws its window in the app

A preset can carry a setup step with `"mode": "tab"` (see FORMAT.md, "Setup steps"). The app starts the step's program and shows it in a **tab of its own** at the top of the app (the tab bar is hidden until a script is open). The script never draws anything: it **describes screens**, and the app draws them with its own theme. Because nothing opens a terminal or a second window, there is nothing that looks suspicious on Windows.

## The conversation

The app sets `OBSCL_UI=1` in the program's environment. The program prints **one JSON object per line** that starts with `@@obscl ` and reads the answers the same way on standard input. Any other line it prints is ordinary output (shown under "technical details"). Closing the tab sends `{"t":"closed"}` and then stops the program.

### Script to app

| message | meaning |
|---|---|
| `{"t":"hello","title":"…"}` | first thing a script says |
| `{"t":"screen","id":"s1","title":"…","sub":"…","blocks":[…],"buttons":[{"id":"next","label":"Next","primary":true}],"wait":true}` | show this screen. `wait:true`: the script waits for a button. `wait:false`: a progress screen the script keeps updating |
| `{"t":"update","id":"s1","item":{"id":"copy","state":"ok","text":"Done."},"say":"…","log":"line","buttons":[…]}` | change the current screen: one step's state (`wait run ok warn fail`), the live sentence, a log line, or the buttons |
| `{"t":"open","url":"https://…"}` | open a web address (only `https://`) |
| `{"t":"copy","text":"…"}` | put text on the clipboard |
| `{"t":"save","name":"file.txt","text":"…"}` | ask where to save a text file, then write it |
| `{"t":"exit","code":0}` | done |

### App to script

`{"t":"submit","id":"s1","button":"next","values":{"name":"Ada","agree":true}}`: a button was pressed. `values` holds every field of the screen as it stands. `{"t":"closed"}`: the tab was closed.

### Blocks

`text` (`style`: body, sub, hint), `message` (`tone`: good, warn, bad), `field` (`name`, `label`, `value`, `secret`, `help`, `browse`: `folder` or `file`, `multiline`), `choice` (`name`, `options`: `{value,label,help}`), `check`, `steps` (`items`: `{id,title,text,state}`), `log`, `link`, `actions` (extra buttons inside the page; they answer the screen like any button), `group` (`title`, `blocks`).

## For script authors

A Python toolkit that speaks this (and draws the same screens with tkinter, or in the terminal, when the script runs without the app) is a single file with no dependencies. The one used by the example setup lives in its `tools/obscl_ui.py`: copy it next to your script.

```python
from obscl_ui import open_ui, field, text, button
ui = open_ui("My installer")
r = ui.screen("Welcome", [text("Hello"), field("name", "Your name")], buttons=[button("next", "Next", primary=True)])
```

Run inside the app, `open_ui` talks to the app. Run on its own, it opens a tkinter window, or asks in the terminal when there is no tkinter.
