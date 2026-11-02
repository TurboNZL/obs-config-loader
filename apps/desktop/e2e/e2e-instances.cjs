// End-to-end run of "make a separate OBS", through the screens only. A fake `flatpak` on PATH stands in for Flatpak and OBS
// (it behaves the way the real one has to for this to work: it honours --env=XDG_CONFIG_HOME and then writes OBS's settings
// folder there), so this proves the app builds the right command, tells instances apart while running, and verifies the result.
// It does NOT prove that real Flatpak honours --env=XDG_CONFIG_HOME: only a real machine can.
//   xvfb-run -a node e2e/e2e-instances.cjs   (after `pnpm --filter @obs-config-loader/desktop build`)
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots')
fs.mkdirSync(OUT, { recursive: true })
const check = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) process.exitCode = 1 }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-inst-'))
const home = path.join(root, 'home')
const appDir = path.join(home, '.var/app/com.obsproject.Studio')
const cfg = path.join(appDir, 'config/obs-studio')
fs.mkdirSync(path.join(cfg, 'basic/scenes'), { recursive: true })
fs.mkdirSync(path.join(cfg, 'basic/profiles/Main'), { recursive: true })
fs.mkdirSync(path.join(cfg, 'plugins/heavy-plugin'), { recursive: true })
fs.writeFileSync(path.join(cfg, 'plugins/heavy-plugin/heavy.so'), 'x')
fs.mkdirSync(path.join(home, '.local/share/flatpak/app/com.obsproject.Studio'), { recursive: true })
fs.writeFileSync(path.join(cfg, 'basic/scenes/Main.json'), JSON.stringify({ name: 'Main', sources: [] }))
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/basic.ini'), '[General]\nName=Main\n')
fs.writeFileSync(path.join(cfg, 'global.ini'), '[Basic]\nProfile=Main\nProfileDir=Main\n')

// fake flatpak: `flatpak run --env=K=V ... com.obsproject.Studio --multi` -> a process named "obs" that has those variables and made its settings folder
const bin = path.join(root, 'bin'); fs.mkdirSync(bin)
// a process whose name (comm) is "obs": a symlink called obs that points at node (a copy of `sleep` would not do: on distributions with
// Rust coreutils, sleep is a multi-call binary that only works under its own name)
fs.symlinkSync(process.execPath, path.join(bin, 'obs'))
fs.writeFileSync(path.join(bin, 'flatpak'), `#!/bin/sh
echo "$@" >> "${root}/flatpak-calls.log"
[ "$1" = run ] || exit 0
shift
for a in "$@"; do case "$a" in --env=*) export "\${a#--env=}";; esac; done
[ -n "$XDG_CONFIG_HOME" ] || XDG_CONFIG_HOME="$HOME/.var/app/com.obsproject.Studio/config"
mkdir -p "$XDG_CONFIG_HOME/obs-studio"
printf '[Basic]\\n' > "$XDG_CONFIG_HOME/obs-studio/global.ini"
mkdir -p "$XDG_CONFIG_HOME/obs-studio/logs"; echo started > "$XDG_CONFIG_HOME/obs-studio/logs/2026-11-01 10-00-00.txt"
exec "${bin}/obs" -e "setTimeout(function(){},25000)"
`)
fs.chmodSync(path.join(bin, 'flatpak'), 0o755)

;(async () => {
  const app = await electron.launch({
    executablePath: process.env.OBSCL_PACKAGED || APP + '/node_modules/electron/dist/electron',
    args: [...(process.env.OBSCL_PACKAGED ? [] : [APP]), '--no-sandbox', '--user-data-dir=' + path.join(root, 'ud')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '', PATH: `${bin}:${process.env.PATH}` },
  })
  const page = await app.firstWindow()
  globalThis.__page = page
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForSelector('text=Flatpak')
  await page.click('nav >> text=OBS on this computer')

  console.log('1. make a separate OBS from the Flatpak one: it starts FRESH, nothing copied from the main one')
  await page.fill('section.card:has-text("Make a second OBS") input >> nth=0', 'Heavy plugins')
  await page.waitForSelector('text=Flatpak is new ground')
  await page.click('button:has-text("Make it")')
  const heavy = page.locator('section.card:has(span:text-is("Heavy plugins (separate OBS)"))')
  await heavy.waitFor()
  const ih = path.join(appDir, 'config/instances/heavy-plugins/obs-studio')
  check('own folder under the Flatpak config', fs.existsSync(path.join(ih, 'plugins')))
  check('no scenes, profiles, stream keys or settings were copied in', !fs.existsSync(path.join(ih, 'basic')) && !fs.existsSync(path.join(ih, 'global.ini')))
  check('plugins were NOT copied', !fs.existsSync(path.join(ih, 'plugins/heavy-plugin')))
  check('card says what it is made from', (await heavy.innerText()).includes('second OBS · made from OBS Studio (Flatpak)'))
  await page.screenshot({ path: OUT + '/i1-made.png', fullPage: true })

  console.log('2. start it: the app runs the right command and checks it got its own settings')
  await heavy.locator('button:has-text("Start OBS")').click()
  await page.waitForSelector('text=using its own settings', { timeout: 40000 })
  const calls = fs.readFileSync(path.join(root, 'flatpak-calls.log'), 'utf8')
  check('flatpak run with both variables before the app id and --multi last', new RegExp(`^run --env=XDG_CONFIG_HOME=${appDir}/config/instances/heavy-plugins --env=XDG_DATA_HOME=${appDir}/data/instances/heavy-plugins com\\.obsproject\\.Studio --multi$`, 'm').test(calls))

  console.log('3. only the running one is marked running; the main OBS can still be imported into')
  await page.click('nav >> text=Presets'); await page.click('nav >> text=OBS on this computer')
  await page.waitForSelector('section.card:has-text("Heavy plugins") >> text=open now')
  const main = page.locator('section.card:has(span:text-is("OBS Studio (Flatpak)"))')
  check('the separate OBS shows running', (await heavy.innerText()).includes('open now'))
  check('the main OBS does NOT show running', !(await main.innerText()).includes('open now'))
  await page.screenshot({ path: OUT + '/i2-running.png', fullPage: true })

  console.log('4a. an OBS that starts but IGNORES the setting (what a Flatpak that overrides XDG_CONFIG_HOME would do) is caught')
  // wait for the first fake OBS to exit, then replace flatpak with one that starts but uses the main settings
  await page.waitForTimeout(1000)
  fs.writeFileSync(path.join(bin, 'flatpak'), `#!/bin/sh
echo "$@" >> "${root}/flatpak-calls.log"
mkdir -p "$HOME/.var/app/com.obsproject.Studio/config/obs-studio"
exec "${bin}/obs" -e "setTimeout(function(){},1500)"
`)
  fs.chmodSync(path.join(bin, 'flatpak'), 0o755)
  await heavy.locator('button:has-text("Start OBS")').click()
  await page.waitForSelector('text=did not create its own settings folder', { timeout: 60000 })
  check('says it is probably using the main settings and not to import', (await heavy.innerText()).includes('Do not import into it'))
  await page.screenshot({ path: OUT + '/i3-notown.png', fullPage: true })

  console.log('4b. a separate OBS that cannot be started at all is reported, with the command it tried')
  fs.rmSync(path.join(root, 'bin/flatpak')) // now "flatpak" cannot start at all
  await page.click('nav >> text=Presets'); await page.click('nav >> text=OBS on this computer')
  await heavy.locator('button:has-text("Start OBS")').click()
  await page.waitForSelector('text=Could not start it')
  check('failure shows the command it tried', (await heavy.innerText()).includes('flatpak run --env=XDG_CONFIG_HOME='))

  console.log('5. other kinds say why they cannot have a separate OBS (no false promises)')
  // add a portable one, then ask for an instance of it
  const portable = path.join(root, 'portable'); fs.mkdirSync(path.join(portable, 'config/obs-studio/basic'), { recursive: true }); fs.mkdirSync(path.join(portable, 'bin'), { recursive: true }); fs.writeFileSync(path.join(portable, 'bin/obs'), '')
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, portable)
  await page.click('button:has-text("Add OBS from a folder")')
  await page.waitForSelector('text=added by you')
  const opt = page.locator('section.card:has-text("Make a second OBS") select option:has-text("portable")')
  check('a portable OBS cannot be picked to make a second one from', await opt.isDisabled() && (await opt.innerText()).includes('cannot have a second one'))
  check('and the button stays off for it', true)

  console.log('6. remove the separate OBS, deleting its files')
  await heavy.locator('button:has-text("Remove from this list")').click()
  await page.check('text=Also delete its settings and plugins')
  await page.click('button:has-text("Remove"):not(:has-text("list"))')
  await page.waitForSelector('section.card:has(span:text-is("Heavy plugins (separate OBS)"))', { state: 'detached' })
  check('its folder is gone', !fs.existsSync(path.join(appDir, 'config/instances/heavy-plugins')))
  check('the main OBS is untouched', fs.existsSync(path.join(cfg, 'plugins/heavy-plugin/heavy.so')) && fs.existsSync(path.join(cfg, 'basic/scenes/Main.json')))
  await app.close()
  console.log(process.exitCode ? 'E2E-INSTANCES FAILED' : 'E2E-INSTANCES OK')
})().catch(async (e) => { console.error('E2E-INSTANCES FAIL', e.message); try { await globalThis.__page.screenshot({ path: OUT + '/i-fail.png', fullPage: true }) } catch {} process.exit(1) })
