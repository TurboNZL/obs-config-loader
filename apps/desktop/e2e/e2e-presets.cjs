// End-to-end run of presets through the screens: the app's own folder, the Settings folder choice, what a preset says it
// needs (OBS version, plugins, scripts, remote control), renaming a preset / scene layout / output settings / scene
// (in the preset AND in OBS), and exporting a preset to a file.
//   xvfb-run -a node e2e/e2e-presets.cjs     (after `pnpm --filter @obs-config-loader/desktop build`)
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots')
fs.mkdirSync(OUT, { recursive: true })
const check = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) process.exitCode = 1 }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-presets-'))
const home = path.join(root, 'home')
const appDir = path.join(home, '.var/app/com.obsproject.Studio')
const cfg = path.join(appDir, 'config/obs-studio')
fs.mkdirSync(path.join(cfg, 'basic/scenes'), { recursive: true })
fs.mkdirSync(path.join(cfg, 'basic/profiles/Main'), { recursive: true })
fs.mkdirSync(path.join(home, '.local/share/flatpak/app/com.obsproject.Studio'), { recursive: true })
const script = path.join(home, 'tools/switcher.py')
fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, 'print("hi")\n')
fs.writeFileSync(path.join(cfg, 'basic/scenes/Main.json'), JSON.stringify({
  name: 'Main', current_scene: 'Scene', current_program_scene: 'Scene', scene_order: [{ name: 'Scene' }],
  modules: { 'scripts-tool': [{ path: script, settings: {} }] },
  sources: [
    { id: 'scene', name: 'Scene', uuid: 'u-s', settings: { items: [{ name: 'Backdrop', visible: true }, { name: 'Desktop audio', visible: true }] } },
    { id: 'color_source', name: 'Backdrop', uuid: 'u-b', settings: { color: 1 } },
    { id: 'pipewire_audio_output_capture', name: 'Desktop audio', uuid: 'u-a', settings: {} },
  ],
}))
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/basic.ini'), '[General]\nName=Main\n')
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_SECRET' } }))
fs.writeFileSync(path.join(cfg, 'global.ini'), '[General]\nLastVersion=520093697\n\n[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')
fs.mkdirSync(path.join(cfg, 'plugin_config/obs-websocket'), { recursive: true })
fs.writeFileSync(path.join(cfg, 'plugin_config/obs-websocket/config.json'), JSON.stringify({ server_enabled: true, server_port: 4455, auth_required: true, server_password: 'ws-SECRET' }))
// the PipeWire audio plugin as OBS 33 expects it, and OBS's own record of it (it reports no version)
const pw = path.join(appDir, 'data/obs-studio/plugins/linux-pipewire-audio'); fs.mkdirSync(pw, { recursive: true }); fs.writeFileSync(path.join(pw, 'linux-pipewire-audio.so'), '')
fs.mkdirSync(path.join(cfg, 'plugin_manager'), { recursive: true })
fs.writeFileSync(path.join(cfg, 'plugin_manager/modules.json'), JSON.stringify([{ display_name: '', enabled: true, encoders: [], id: '', module_name: 'linux-pipewire-audio', outputs: [], services: [], sources: ['pipewire_audio_output_capture'], version: '' }]))

;(async () => {
  const app = await electron.launch({
    executablePath: process.env.OBSCL_PACKAGED || APP + '/node_modules/electron/dist/electron',
    args: [...(process.env.OBSCL_PACKAGED ? [] : [APP]), '--no-sandbox', '--user-data-dir=' + path.join(root, 'ud')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '', XDG_DOCUMENTS_DIR: path.join(home, 'Documents') },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForSelector('text=Flatpak')
  const card = (name) => page.locator(`section.card:has(h2:text-is("${name}"))`)
  const defaultRoot = path.join(home, 'Documents/OBS Config Loader/Presets')

  console.log('1. a new preset goes into the app\'s own folder by itself')
  await page.click('nav >> text=Presets')
  await page.click('button:has-text("New preset from my OBS")')
  await page.fill('section.card:has-text("New preset from my OBS") input >> nth=0', 'Show')
  await page.click('button:has-text("Save preset")')
  await card('Show').waitFor()
  check('made in Documents/OBS Config Loader/Presets/Show', fs.existsSync(path.join(defaultRoot, 'Show/manifest.json')))
  check('the script travelled with the preset (also in a git folder)', fs.existsSync(path.join(defaultRoot, 'Show/scripts')))
  check('the remote-control settings are in it, without the password', fs.existsSync(path.join(defaultRoot, 'Show/global/obs-websocket.json')) && !fs.readFileSync(path.join(defaultRoot, 'Show/global/obs-websocket.json'), 'utf8').includes('ws-SECRET'))
  check('the presets screen does not talk about repositories or commits', !/repositor|commit|merge/i.test(await page.locator('main').innerText()))
  await page.screenshot({ path: OUT + '/p1-presets.png', fullPage: true })

  console.log('2. what the preset needs is shown in its details')
  const show = card('Show')
  await show.locator('button:has-text("Show details")').click()
  const txt = await show.innerText()
  check('the OBS version it was saved with (31.0.1)', txt.includes('Saved with OBS 31.0.1'))
  check('the PipeWire audio plugin is named', txt.includes('PipeWire Audio Capture'))
  check('says plugins only show a version when they report one', txt.includes('only show a version when they tell OBS one'))
  check('the script is listed', txt.includes('switcher.py'))
  check('remote control is mentioned', txt.includes('remote-control'))
  await page.screenshot({ path: OUT + '/p2-details.png', fullPage: true })

  console.log('3. rename a scene layout, output settings and a scene: in the preset and in OBS')
  const rename = async (label, value, to) => {
    await show.locator(`.bt-row:has(span:text-is("${label}")):has(span:text-is("${value}")) button:has-text("Rename")`).first().click()
    await show.locator(`input[aria-label="New name for ${value}"]`).fill(to)
    await show.locator(`input[aria-label="New name for ${value}"] >> xpath=.. >> button:has-text("Rename")`).click()
  }
  await rename('Scene layout', 'Main', 'Gameplay')
  await show.locator('.bt-row:has-text("Scene layout"):has-text("Gameplay")').waitFor()
  check('preset has the new layout file', fs.existsSync(path.join(defaultRoot, 'Show/collections/gameplay.json')) && !fs.existsSync(path.join(defaultRoot, 'Show/collections/main.json')))
  check('OBS has it too, and the old one is gone', fs.existsSync(path.join(cfg, 'basic/scenes/Gameplay.json')) && !fs.existsSync(path.join(cfg, 'basic/scenes/Main.json')))
  check('OBS opens the renamed layout next time', fs.readFileSync(path.join(cfg, 'global.ini'), 'utf8').includes('SceneCollection=Gameplay'))

  await rename('Output settings', 'Main', 'High quality')
  await show.locator('.bt-row:has-text("Output settings"):has-text("High quality")').waitFor()
  check('output settings renamed in the preset and in OBS', fs.existsSync(path.join(defaultRoot, 'Show/profiles/high-quality/basic.ini')) && fs.existsSync(path.join(cfg, 'basic/profiles/High quality/basic.ini')))
  check('the stream key stayed in OBS\'s output settings', fs.readFileSync(path.join(cfg, 'basic/profiles/High quality/service.json'), 'utf8').includes('live_SECRET'))

  await rename('Scene', 'Scene', 'Starting')
  await show.locator('.bt-row:has(span:text-is("Starting"))').first().waitFor()
  const obsScene = fs.readFileSync(path.join(cfg, 'basic/scenes/Gameplay.json'), 'utf8')
  check('scene renamed everywhere it is used in OBS', obsScene.includes('"current_scene": "Starting"') || obsScene.includes('"current_scene":"Starting"'))
  check('and in the preset', fs.readFileSync(path.join(defaultRoot, 'Show/collections/gameplay.json'), 'utf8').includes('Starting'))

  // a name that is already taken is refused, and nothing changes
  await show.locator('details summary').first().click()
  await show.locator('.bt-row:has(span:text-is("Source")):has(span:text-is("Desktop audio")) button:has-text("Rename")').click()
  await show.locator('input[aria-label="New name for Desktop audio"]').fill('Backdrop')
  await show.locator('input[aria-label="New name for Desktop audio"] >> xpath=.. >> button:has-text("Rename")').click()
  await show.locator('text=already something called').waitFor()
  check('a clashing name is refused with a plain message', true)
  check('the preset still matches OBS after all the renames (nothing re-added)', !(await page.locator('text=OBS has changes that are not in this preset').count()))
  await page.screenshot({ path: OUT + '/p3-renamed.png', fullPage: true })

  console.log('4. export the preset to a file')
  const bundle = path.join(root, 'out.obsbundle')
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }) }, bundle)
  await show.locator('button:has-text("Export to a file")').click()
  await page.waitForSelector('text=This makes one file')
  check('stream keys cannot be ticked when none are remembered', await show.locator('label:has-text("Include my stream keys") input').isDisabled())
  await show.locator('button:has-text("Choose where to save")').click()
  await page.waitForSelector('text=Saved the file')
  const JSZip = require(require.resolve('jszip', { paths: [path.join(APP, '../../packages/core')] }))
  const zip = await JSZip.loadAsync(fs.readFileSync(bundle))
  const names = Object.keys(zip.files)
  const all = (await Promise.all(names.filter((n) => !zip.files[n].dir).map((n) => zip.files[n].async('string')))).join('\n')
  check('the file has the scene layout, output settings, script and remote-control settings', names.some((n) => n.startsWith('collections/gameplay')) && names.some((n) => n.startsWith('profiles/high-quality')) && names.some((n) => n.startsWith('scripts/')) && names.includes('global/obs-websocket.json'))
  check('no stream key or password inside', !all.includes('live_SECRET') && !all.includes('ws-SECRET'))

  console.log('5. Settings: change where presets are kept')
  await page.click('nav >> text=Settings')
  await page.waitForSelector('text=Where presets are kept')
  check('shows the app\'s own folder', (await page.locator('[aria-label="Presets folder"]').innerText()) === defaultRoot)
  const mine = path.join(root, 'MyPresets'); fs.mkdirSync(mine)
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, mine)
  await page.click('button:has-text("Change folder")')
  await page.waitForFunction((p) => document.querySelector('[aria-label="Presets folder"]')?.textContent === p, mine)
  check('stream keys card says whether they can be kept', (await page.locator('section.card:has(h2:text-is("Stream keys"))').count()) === 1)
  await page.screenshot({ path: OUT + '/p4-settings.png', fullPage: true })
  await page.click('nav >> text=Presets')
  await page.click('button:has-text("New preset from my OBS")')
  await page.fill('section.card:has-text("New preset from my OBS") input >> nth=0', 'Other')
  await page.click('button:has-text("Save preset")')
  await card('Other').waitFor()
  check('the next preset goes to the new folder', fs.existsSync(path.join(mine, 'Other/manifest.json')))
  check('the first one stayed where it was', fs.existsSync(path.join(defaultRoot, 'Show/manifest.json')))

  await app.close()
  console.log(process.exitCode ? 'E2E-PRESETS FAILED' : 'E2E-PRESETS OK')
})().catch((e) => { console.error('E2E-PRESETS FAIL', e); process.exit(1) })
