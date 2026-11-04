// End-to-end through the screens: who saves are by (from the GitHub sign-in, an app-wide name, a preset's own name, and changing
// every earlier save), the preset's settings travelling inside it, a single source's translation, and big-file storage
// (an S3-style stand-in on this computer). The computer's own git settings say "Windows Person" and must never be used or changed.
//   xvfb-run -a node e2e/e2e-identity-storage.cjs     (after `pnpm --filter @obs-config-loader/desktop build`)
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto')
const { execFileSync } = require('child_process')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots'); fs.mkdirSync(OUT, { recursive: true })
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
const check = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) process.exitCode = 1 }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-idst-'))
const home = path.join(root, 'home')
const gitconfig = '[user]\n\tname = Windows Person\n\temail = private@example.com\n'
fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, '.gitconfig'), gitconfig)
const cfg = path.join(home, '.var/app/com.obsproject.Studio/config/obs-studio')
fs.mkdirSync(path.join(cfg, 'basic/scenes'), { recursive: true }); fs.mkdirSync(path.join(cfg, 'basic/profiles/Main'), { recursive: true })
fs.mkdirSync(path.join(home, '.local/share/flatpak/app/com.obsproject.Studio'), { recursive: true })
const bigFile = path.join(home, 'Videos/intro.mp4'); fs.mkdirSync(path.dirname(bigFile), { recursive: true }); fs.writeFileSync(bigFile, crypto.randomBytes(6 * 1024 * 1024))
const scene = path.join(cfg, 'basic/scenes/Main.json')
const writeScene = (extra = []) => fs.writeFileSync(scene, JSON.stringify({ name: 'Main', current_scene: 'Scene', sources: [
  { id: 'scene', name: 'Scene', uuid: 'u-s', settings: { items: [{ name: 'Intro video', visible: true }] } },
  { id: 'ffmpeg_source', name: 'Intro video', uuid: 'u-v', settings: { local_file: bigFile } },
  { id: 'xcomposite_input', name: 'Game window', uuid: 'u-g', settings: { capture_window: '0x1' } },
  { id: 'xcomposite_input', name: 'Browser window', uuid: 'u-b', settings: { capture_window: '0x2' } },
  ...extra ] }))
writeScene()
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/basic.ini'), '[General]\nName=Main\n')
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_SECRET' } }))
fs.writeFileSync(path.join(cfg, 'global.ini'), '[General]\nLastVersion=520093697\n')
fs.writeFileSync(path.join(cfg, 'user.ini'), '[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')

// ── stand-ins: GitHub's API (a user with a display name and an id) and an S3-style storage ──
const remotes = path.join(root, 'github'); fs.mkdirSync(remotes)
const TOKEN = 'ghp_E2ETOKEN'
const api = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' })
    const row = (n) => ({ name: n, full_name: `streamer/${n}`, clone_url: path.join(remotes, n + '.git'), html_url: `https://github.com/streamer/${n}`, private: true })
    if (req.url === '/user') return send(200, { login: 'streamer', id: 4242, name: 'Stream Er' })
    if (req.url.startsWith('/user/repos') && req.method === 'POST') { const n = JSON.parse(body).name; git(remotes, 'init', '-q', '--bare', '--initial-branch=main', n + '.git'); return send(201, row(n)) }
    send(404, { message: 'Not Found' })
  })
})
const objects = new Map(); const s3calls = []
const s3 = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    s3calls.push(`${req.method} ${req.url}`)
    if (!String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256 Credential=KEY123/')) { res.statusCode = 403; return res.end('<Error><Code>InvalidAccessKeyId</Code></Error>') }
    const m = /^\/([^/]+)(?:\/(.+))?$/.exec(req.url); const key = m[2] ? decodeURIComponent(m[2]) : ''
    if (m[1] !== 'my-obs-files') { res.statusCode = 404; return res.end('<Error><Code>NoSuchBucket</Code></Error>') }
    const body = Buffer.concat(chunks)
    if (!key) { res.statusCode = 200; return res.end() }
    if (req.method === 'PUT') { objects.set(key, body); res.statusCode = 200; return res.end() }
    if (req.method === 'DELETE') { objects.delete(key); res.statusCode = 204; return res.end() }
    const v = objects.get(key); if (!v) { res.statusCode = 404; return res.end('<Error><Code>NoSuchKey</Code></Error>') }
    res.setHeader('content-length', v.length); res.statusCode = 200; res.end(req.method === 'HEAD' ? undefined : v)
  })
})

;(async () => {
  await new Promise((r) => api.listen(0, '127.0.0.1', r)); await new Promise((r) => s3.listen(0, '127.0.0.1', r))
  const app = await electron.launch({
    executablePath: process.env.OBSCL_PACKAGED || APP + '/node_modules/electron/dist/electron',
    args: [...(process.env.OBSCL_PACKAGED ? [] : [APP]), '--no-sandbox', '--user-data-dir=' + path.join(root, 'ud')],
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), XDG_CONFIG_HOME: '', XDG_DOCUMENTS_DIR: path.join(home, 'Documents'), OBSCL_GITHUB_API: `http://127.0.0.1:${api.address().port}` },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 1200 })
  await page.waitForSelector('text=Flatpak')
  const card = (name) => page.locator(`section.card:has(h2:text-is("${name}"))`)
  const docs = path.join(home, '.local/share/obs-config-loader/presets')
  const dir = path.join(docs, 'Show')
  const bare = path.join(remotes, 'OBS-Config-Show.git')
  const authors = (cwd, ...ref) => git(cwd, 'log', ...(ref.length ? ref : ['--all']), '--format=%an <%ae>').split('\n').filter(Boolean)

  console.log('1. saves are by the GitHub account, not by the computer\'s own git name')
  await page.click('nav >> text=Settings')
  await page.fill('input[aria-label="GitHub token"]', TOKEN)
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('text=signed in as streamer')
  const idCard = page.locator('section.card:has-text("Who your saves are by")')
  check('the settings say new saves are by the GitHub name and its private address', (await idCard.innerText()).includes('Stream Er <4242+streamer@users.noreply.github.com>'))
  await page.screenshot({ path: OUT + '/i1-settings.png', fullPage: true })
  await page.click('nav >> text=Presets')
  await page.click('button:has-text("Make a preset from my OBS")')
  await page.fill('section.card:has-text("Make a preset from my OBS") input >> nth=0', 'Show')
  await page.check('label:has-text("Back the preset up online") input')
  await page.click('button:has-text("Save preset")')
  await page.waitForSelector('text=and backed it up at')
  await card('Show').waitFor()
  check('the first save is by the GitHub account', authors(dir).join('|') === 'Stream Er <4242+streamer@users.noreply.github.com>')
  check('GitHub has the same name', authors(bare).join('|') === 'Stream Er <4242+streamer@users.noreply.github.com>')
  check('this computer\'s own git settings were not touched', fs.readFileSync(path.join(home, '.gitconfig'), 'utf8') === gitconfig && !/user/.test(fs.readFileSync(path.join(dir, '.git/config'), 'utf8')))
  check('the preset has no settings file until something is chosen', !fs.existsSync(path.join(dir, 'preset-settings.json')))

  console.log('2. a name chosen in Settings is used for the next save')
  await page.click('nav >> text=Settings')
  await page.click('section.card:has-text("Who your saves are by") input[name="who"] >> nth=1')
  await page.fill('input[aria-label="Name for saves"]', 'Stage Name')
  await page.fill('input[aria-label="Email address for saves"]', 'stage@example.com')
  await page.click('section.card:has-text("Who your saves are by") button:text-is("Save")')
  await page.waitForSelector('text=Saved. New saves use this name.')
  writeScene([{ id: 'color_source', name: 'Backdrop', uuid: 'u-c', settings: { color: 3 } }])
  await page.click('nav >> text=Presets')
  const show = card('Show')
  await show.locator('button:has-text("Update preset from OBS")').click()
  await show.locator('[role="status"]:has-text("backed up online")').waitFor()
  check('the new save is by the chosen name', authors(dir, '-1', 'HEAD').join('|') === 'Stage Name <stage@example.com>')
  check('and the earlier one kept its name', authors(dir).includes('Stream Er <4242+streamer@users.noreply.github.com>'))

  console.log('3. change the name on every earlier save, here and on GitHub')
  await show.locator('button[aria-label="Show details"]').click()
  await show.locator('text=Saves in this preset are by').waitFor()
  check('the details list who the saves are by', (await show.innerText()).includes('Saves in this preset are by'))
  await show.locator('input[aria-label="Name for this preset\'s saves"]').fill('Public Name')
  await show.locator('input[aria-label="Email address for this preset\'s saves"]').fill('public@example.com')
  await show.locator('button:has-text("Change the name on all earlier saves")').click()
  await page.screenshot({ path: OUT + '/i3-rewrite.png', fullPage: true })
  await show.locator('button:text-is("Change every save")').click()
  await page.waitForSelector('text=/Changed 2 saves here and on GitHub/')
  check('every save here says the new name', authors(dir).every((a) => a === 'Public Name <public@example.com>'))
  check('GitHub says the new name too, with nothing left of the old ones', authors(bare).every((a) => a === 'Public Name <public@example.com>'))
  check('the old names are gone from this folder as well', !git(dir, 'log', '--all', '--format=%an%ae').includes('Stage') && !git(dir, 'log', '--all', '--format=%an%ae').includes('Stream Er'))
  check('the preset is not shown as out of step with GitHub', !(await show.innerText()).includes('Both this computer and GitHub have changed'))
  check('the files did not change', git(dir, 'status', '--porcelain') === '')

  console.log('4. a single source can be translated on its own')
  await show.locator('summary:has-text("Choose for one source at a time")').click()
  const sel = show.locator('select[aria-label="Browser window on Windows"]')
  await sel.waitFor()
  await sel.selectOption('__hide__')
  await page.waitForSelector('text=Saved for that source')
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  check('the choice is saved in the preset, for that source only', JSON.stringify(mf.sourceOverrides) === JSON.stringify({ 'u:u-b': { win32: null } }) && !mf.platformOverrides)
  check('the other source of the same kind has no choice', await show.locator('select[aria-label="Game window on Windows"]').inputValue() === '')
  check('it is saved as a step in the preset', git(dir, 'log', '-1', '--format=%s') === 'Changed how single sources are translated between computers')

  console.log('5. big-file storage: set it up, see wrong keys explained, put a file in it')
  await page.click('nav >> text=Settings')
  const stCard = page.locator('section.card:has-text("Big-file storage")').first()
  await stCard.locator('select').selectOption('other')
  await stCard.locator('input[aria-label="Storage address"]').fill(`http://127.0.0.1:${s3.address().port}`)
  await stCard.locator('input[aria-label="Storage region"]').fill('test-1')
  await stCard.locator('input[aria-label="Storage space name"]').fill('my-obs-files')
  await stCard.locator('input[aria-label="Storage key ID"]').fill('WRONG')
  await stCard.locator('input[aria-label="Storage secret key"]').fill('s3cr3t-value')
  await stCard.locator('button:has-text("Test and save")').click()
  await page.waitForSelector('text=did not accept those keys')
  check('wrong keys are explained, and the secret is never shown', !(await stCard.innerText()).includes('s3cr3t-value'))
  await stCard.locator('input[aria-label="Storage key ID"]').fill('KEY123')
  await stCard.locator('button:has-text("Test and save")').click()
  await page.waitForSelector('text=Connected to')
  check('the test file was removed again', [...objects.keys()].length === 0)
  check('the keys are not in the app\'s settings file', !fs.readFileSync(path.join(root, 'ud/settings.json'), 'utf8').includes('s3cr3t-value'))
  await page.screenshot({ path: OUT + '/i5-storage.png', fullPage: true })

  await page.click('nav >> text=Presets')
  await show.locator('button[aria-label="Show details"]').waitFor()
  if (await show.locator('button[aria-label="Hide details"]').count() === 0) await show.locator('button[aria-label="Show details"]').click()
  await show.locator('input[aria-label="Keep intro.mp4 in the big-file storage"]').click()
  await page.waitForSelector('text=The file is in your storage')
  const stored = [...objects.keys()]
  check('the file is in the storage, kept by its fingerprint', stored.length === 1 && stored[0].includes(crypto.createHash('sha256').update(fs.readFileSync(bigFile)).digest('hex')) && stored[0].endsWith('/intro.mp4'))
  const shared = JSON.parse(fs.readFileSync(path.join(dir, 'preset-settings.json'), 'utf8'))
  check('the preset saved its own setting inside itself, with where the storage is and no keys', shared.cloud.stored[0] === 'intro' && shared.storage.bucket === 'my-obs-files' && !JSON.stringify(shared).includes('KEY123') && !JSON.stringify(shared).includes('s3cr3t'))
  check('that setting went to GitHub with the preset', git(bare, 'show', 'main:preset-settings.json').includes('"stored"'))
  check('but the video did not', !git(bare, 'ls-tree', '-r', '--name-only', 'main').includes('intro.mp4') && !git(bare, 'ls-tree', '-r', '--name-only', 'main').includes('media/'))
  check('GitHub still holds nothing with the old names after that step', authors(bare).every((a) => a === 'Public Name <public@example.com>'))

  console.log('6. on another computer (here: after losing the local copies) the file comes back from the storage, checked')
  fs.rmSync(path.join(dir, 'local/media'), { recursive: true, force: true }); fs.rmSync(bigFile)
  await page.evaluate(() => window.obsLoader.settings.setRememberKeys(true)) // the app keeps quick answers for a few seconds; any change (even this one) makes it look again
  await page.click('nav >> text=Settings'); await page.click('nav >> text=Presets')
  if (await show.locator('button[aria-label="Hide details"]').count() === 0) await show.locator('button[aria-label="Show details"]').click()
  await show.locator('button:has-text("Download from storage")').click()
  await page.waitForSelector('text=Downloaded.')
  check('the file is back, byte for byte', fs.existsSync(path.join(dir, 'local/media/intro/intro.mp4')) && fs.statSync(path.join(dir, 'local/media/intro/intro.mp4')).size === 6 * 1024 * 1024)
  await page.screenshot({ path: OUT + '/i6-storage-preset.png', fullPage: true })

  await app.close()
  console.log(process.exitCode ? '\nE2E-IDENTITY-STORAGE FAILED' : '\nE2E-IDENTITY-STORAGE OK')
  api.close(); s3.close()
})().catch((e) => { console.error(e); process.exit(1) })
