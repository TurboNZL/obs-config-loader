// End-to-end run of the real app: export from a fake Flatpak OBS, import into a fake portable one, with stubbed file dialogs.
// Needs: pnpm build, a display (xvfb-run -a node e2e/e2e.cjs on a headless box), and playwright. The Electron binary must be installed.
// (As root add nothing: --no-sandbox is already passed.) Screenshots go to the OS temp folder.
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots')
fs.mkdirSync(OUT, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const home = path.join(root, 'home')
// a Flatpak OBS with a small setup
const cfg = path.join(home, '.var/app/com.obsproject.Studio/config/obs-studio')
fs.mkdirSync(path.join(cfg, 'basic/scenes'), { recursive: true })
fs.mkdirSync(path.join(cfg, 'basic/profiles/Main'), { recursive: true })
fs.mkdirSync(path.join(home, '.local/share/flatpak/app/com.obsproject.Studio'), { recursive: true })
const img = path.join(home, 'Pictures/overlay.png'); fs.mkdirSync(path.dirname(img), { recursive: true }); fs.writeFileSync(img, 'PNG')
fs.writeFileSync(path.join(cfg, 'basic/scenes/Main.json'), JSON.stringify({ name: 'Main', sources: [
  { id: 'scene', name: 'Scene', settings: { items: [{ name: 'Win', visible: true }] } },
  { id: 'xcomposite_input', name: 'Win', settings: { capture_window: '1' } },
  { id: 'image_source', name: 'Overlay', settings: { file: img } },
  { id: 'pipewire_audio_application_capture', name: 'Game audio', settings: {} } ] }))
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/basic.ini'), '[General]\nName=Main\n[SimpleOutput]\nFilePath=' + path.join(home, 'Videos') + '\n')
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_SECRET' } }))
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/obs-multi-rtmp.json'), JSON.stringify({ targets: [{ 'service-param': { key: 'yt_SECRET' } }] }))
// a portable target OBS (empty config)
const portable = path.join(root, 'portable'); fs.mkdirSync(path.join(portable, 'config/obs-studio/basic'), { recursive: true }); fs.mkdirSync(path.join(portable, 'bin'), { recursive: true }); fs.writeFileSync(path.join(portable, 'bin/obs'), '')
const bundlePath = path.join(root, 'test.obsbundle')

;(async () => {
  const app = await electron.launch({
    executablePath: APP + '/node_modules/electron/dist/electron',
    args: [APP, '--no-sandbox', '--user-data-dir=' + path.join(root, 'ud')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '' },
  })
  const page = await app.firstWindow()
  page.on('console', (m) => console.log('[renderer]', m.type(), m.text()))
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.waitForSelector('text=Flatpak')
  await page.screenshot({ path: OUT + '/1-installs.png' })

  // Export from the flatpak install (stub the save dialog)
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }) }, bundlePath)
  await page.click('text=Export this setup')
  await page.waitForSelector('text=Name of the setup')
  await page.screenshot({ path: OUT + '/2-export.png' })
  await page.click('button:has-text("Export…")')
  await page.waitForSelector('text=Left out on purpose')
  await page.screenshot({ path: OUT + '/3-exported.png' })
  console.log('bundle exists:', fs.existsSync(bundlePath), fs.statSync(bundlePath).size)

  // Add the portable install
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, portable)
  await page.click('nav >> text=OBS installs')
  await page.click('text=Add a portable install')
  await page.waitForSelector('text=added by you')
  await page.screenshot({ path: OUT + '/4-installs-portable.png' })

  // Import into the portable one
  await page.click('section.card:has-text("added by you") >> text=Import a setup here')
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, bundlePath)
  await page.click('button:has-text("Open a file")')
  await page.waitForSelector('text=Your details')
  await page.waitForSelector('text=files will be written')
  await page.screenshot({ path: OUT + '/5-import-review.png', fullPage: true })
  const inputs = await page.$$('input[type=password]')
  for (const i of inputs) await i.fill('live_NEWKEY')
  await page.evaluate(() => document.querySelector('main').scrollTo(0, 99999))
  await page.screenshot({ path: OUT + '/5b-report.png' })
  await page.waitForTimeout(500)
  await page.click('button:has-text("Import"):not(:has-text("a setup"))')
  await page.waitForSelector('text=Imported')
  await page.screenshot({ path: OUT + '/6-imported.png' })
  await page.evaluate(() => document.querySelector('main').scrollTo(0, 99999))
  await page.screenshot({ path: OUT + '/6b-bottom.png' })
  const written = path.join(portable, 'config/obs-studio/basic/profiles/Main/service.json')
  console.log('service.json key:', JSON.parse(fs.readFileSync(written, 'utf8')).settings.key)
  console.log('scene exists:', fs.existsSync(path.join(portable, 'config/obs-studio/basic/scenes/Main.json')))
  const col = JSON.parse(fs.readFileSync(path.join(portable, 'config/obs-studio/basic/scenes/Main.json'), 'utf8'))
  console.log('overlay path:', col.sources.find((s) => s.name === 'Overlay').settings.file)

  await page.click('nav >> text=Appearance')
  await page.waitForTimeout(800)
  await page.screenshot({ path: OUT + '/7-appearance.png' })
  await app.close()
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAIL', e); process.exit(1) })
