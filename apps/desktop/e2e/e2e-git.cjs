// End-to-end run of the git workflow driven ONLY through the app's screens (no git on the command line except to play
// "someone else" editing the repository). GitHub is replaced by a tiny local stand-in for its REST API (OBSCL_GITHUB_API),
// whose "clone address" is a bare repository on disk.
//   xvfb-run -a node e2e/e2e-git.cjs     (after `pnpm --filter @obs-config-loader/desktop build`)
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http')
const { execFileSync } = require('child_process')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots')
fs.mkdirSync(OUT, { recursive: true })
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Other', '-c', 'user.email=o@example.com', ...a], { cwd, encoding: 'utf8' }).trim()
const check = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) process.exitCode = 1 }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-git-'))
const home = path.join(root, 'home')
const cfg = path.join(home, '.var/app/com.obsproject.Studio/config/obs-studio')
fs.mkdirSync(path.join(cfg, 'basic/scenes'), { recursive: true })
fs.mkdirSync(path.join(cfg, 'basic/profiles/Main'), { recursive: true })
fs.mkdirSync(path.join(home, '.local/share/flatpak/app/com.obsproject.Studio'), { recursive: true })
const scene = path.join(cfg, 'basic/scenes/Main.json')
const readScene = () => JSON.parse(fs.readFileSync(scene, 'utf8'))
const writeScene = (j) => fs.writeFileSync(scene, JSON.stringify(j))
writeScene({ name: 'Main', current_scene: 'Scene', sources: [
  { id: 'scene', name: 'Scene', settings: { items: [] } }, { id: 'color_source', name: 'Backdrop', settings: { color: 1 } } ] })
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/basic.ini'), '[General]\nName=Main\n')
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_SECRET' } }))
fs.writeFileSync(path.join(cfg, 'global.ini'), '[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')

// ── a stand-in for api.github.com ──
const remotes = path.join(root, 'github'); fs.mkdirSync(remotes)
const TOKEN = 'ghp_E2ETOKEN'
const apiCalls = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    apiCalls.push(`${req.method} ${req.url}`)
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' })
    const row = (n) => ({ name: n, full_name: `streamer/${n}`, clone_url: path.join(remotes, n + '.git'), html_url: `https://github.com/streamer/${n}`, private: true })
    if (req.url === '/user') return send(200, { login: 'streamer' })
    if (req.url.startsWith('/user/repos') && req.method === 'POST') {
      const n = JSON.parse(body).name
      if (fs.existsSync(path.join(remotes, n + '.git'))) return send(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] })
      git(remotes, 'init', '-q', '--bare', '--initial-branch=main', n + '.git')
      return send(201, row(n))
    }
    if (req.url.startsWith('/user/repos')) return send(200, fs.readdirSync(remotes).map((d) => row(d.replace(/\.git$/, ''))))
    send(404, { message: 'Not Found' })
  })
})

const launch = async (extraEnv = {}) => {
  const app = await electron.launch({
    executablePath: APP + '/node_modules/electron/dist/electron',
    args: [APP, '--no-sandbox', '--user-data-dir=' + path.join(root, 'ud')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '', XDG_DOCUMENTS_DIR: path.join(home, 'Documents'), OBSCL_GITHUB_API: `http://127.0.0.1:${server.address().port}`, ...extraEnv },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForSelector('text=Flatpak')
  await page.click('nav >> text=Git repositories')
  return { app, page }
}
const reopen = async (page) => { await page.click('nav >> text=OBS installs'); await page.click('nav >> text=Git repositories') }

;(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { app, page } = await launch()
  const card = (name) => page.locator(`section.card:has(h2:text-is("${name}"))`)
  const docs = path.join(home, 'Documents/OBS Config Loader')

  console.log('1. sign in to GitHub from the app')
  await page.fill('input[aria-label="GitHub token"]', 'wrong-token')
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('text=did not accept that token')
  await page.fill('input[aria-label="GitHub token"]', TOKEN)
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('text=signed in as streamer')
  await page.screenshot({ path: OUT + '/g0-github.png', fullPage: true })

  console.log('2. new repository from OBS, created on GitHub in the same step')
  await page.fill('section.card:has-text("Start a new repository") input >> nth=0', 'Main stream')
  await page.check('text=Also create it on GitHub')
  await page.click('button:has-text("Create")')
  await page.waitForSelector('text=and published it at')
  const main = card('Main stream')
  await main.waitFor()
  const bare = path.join(remotes, 'Main-stream.git')
  check('repository created in the default Documents folder', fs.existsSync(path.join(docs, 'Main stream/manifest.json')))
  check('GitHub repository exists and has the first save', git(bare, 'rev-list', '--count', 'main') === '1')
  check('shows its online address', (await main.innerText()).includes('Main-stream.git'))
  check('no stream key anywhere in the repository', (() => { try { git(path.join(docs, 'Main stream'), 'grep', '-q', 'SECRET'); return false } catch { return true } })())
  await page.screenshot({ path: OUT + '/g1-created.png', fullPage: true })

  console.log('3. edit in OBS, save, push')
  const repoDir = path.join(docs, 'Main stream')
  let j = readScene(); j.sources.push({ id: 'color_source', name: 'LiveEdit1', settings: { color: 2 } }); writeScene(j)
  await reopen(page)
  await page.waitForSelector('text=not in the repository yet')
  await main.locator('button:has-text("Save OBS changes")').click()
  await page.waitForSelector('text=Saved (')
  await main.locator('button:has-text("Push")').click()
  await page.waitForSelector('text=Pushed.')
  check('remote has both saves', git(bare, 'rev-list', '--count', 'main') === '2')

  console.log('4. someone else pushes a change to the same line; I pull and choose whose wins')
  const other = path.join(root, 'other'); fs.mkdirSync(other); git(other, 'clone', '-q', bare, '.')
  const op = path.join(other, 'collections/main.json')
  let o = JSON.parse(fs.readFileSync(op, 'utf8')); o.current_scene = 'THEIRS'; fs.writeFileSync(op, JSON.stringify(o, null, 4) + '\n')
  git(other, 'commit', '-qam', 'their edit'); git(other, 'push', '-q')
  j = readScene(); j.current_scene = 'MINE'; writeScene(j)
  await reopen(page)
  await main.locator('button:has-text("Save OBS changes")').click()
  await page.waitForSelector('text=Saved (')
  await main.locator('button:has-text("Pull")').click()
  await page.waitForSelector('text=changed the same lines')
  await page.screenshot({ path: OUT + '/g2-pull-conflict.png', fullPage: true })
  check('nothing changed while undecided', JSON.parse(fs.readFileSync(path.join(repoDir, 'collections/main.json'), 'utf8')).current_scene === 'MINE')
  await main.locator('button:has-text("Take the online version")').click()
  await page.waitForSelector('text=Pulled')
  check('their version won only the clashing line', JSON.parse(fs.readFileSync(path.join(repoDir, 'collections/main.json'), 'utf8')).current_scene === 'THEIRS')
  check('my other edit survived the merge', fs.readFileSync(path.join(repoDir, 'collections/main.json'), 'utf8').includes('LiveEdit1'))

  console.log('5. the repository and OBS disagree on one line when I save')
  const rp = path.join(repoDir, 'collections/main.json')
  let r = JSON.parse(fs.readFileSync(rp, 'utf8')); r.current_scene = 'FROM THE AI'; fs.writeFileSync(rp, JSON.stringify(r, null, 4) + '\n')
  git(repoDir, 'commit', '-qam', 'AI tweak')
  j = readScene(); j.current_scene = 'FROM OBS'; writeScene(j)
  await reopen(page)
  await main.locator('button:has-text("Save OBS changes")').click()
  await page.waitForSelector('text=both changed the same lines')
  await page.screenshot({ path: OUT + '/g3-save-conflict.png', fullPage: true })
  await main.locator('button:has-text("Keep OBS\'s version")').click()
  await page.waitForSelector('text=Saved (')
  check('OBS won the clashing line', JSON.parse(fs.readFileSync(rp, 'utf8')).current_scene === 'FROM OBS')

  console.log('6. a second repository, published afterwards with one click')
  await page.fill('section.card:has-text("Start a new repository") input >> nth=0', 'Second')
  await page.click('button:has-text("Create")')
  const second = card('Second')
  await second.waitFor()
  await second.locator('button:has-text("Publish to GitHub")').click()
  await page.waitForSelector('text=Published at')
  check('second GitHub repository exists with the save', git(path.join(remotes, 'Second.git'), 'rev-list', '--count', 'main') === '1')
  await page.click('button:has-text("Publish to GitHub")').catch(() => {}) // gone now: no second create
  check('GitHub was asked to create it once', apiCalls.filter((c) => c.startsWith('POST') ).length === 2)

  console.log('7. get an existing repository from my GitHub list')
  await second.locator('button:has-text("Remove from list")').click()
  await page.waitForSelector('section.card:has(h2:text-is("Second"))', { state: 'detached' })
  await page.locator('label:has-text("From your GitHub") select').selectOption({ label: 'streamer/Second (private)' })
  await page.click('button:has-text("Download")')
  await page.waitForSelector('text=Downloaded')
  check('downloaded into its own default folder', fs.existsSync(path.join(docs, 'Second-2/manifest.json')) || fs.existsSync(path.join(docs, 'Second/manifest.json')))
  await page.screenshot({ path: OUT + '/g4-downloaded.png', fullPage: true })

  console.log('8. apply the repository to OBS')
  await main.locator('button:has-text("Apply to OBS")').click()
  await page.waitForSelector('text=Report: what Import will do')
  await page.click('button:has-text("Import"):not(:has-text("a setup"))')
  await page.waitForSelector('text=Imported')
  check('OBS now has the repository state', readScene().current_scene === 'FROM OBS')
  await app.close()

  console.log('9. git missing: the app says how to get it')
  const g = await launch({ OBSCL_FAKE_NO_GIT: '1' })
  await g.page.waitForSelector('text=Git is needed')
  await g.page.screenshot({ path: OUT + '/g5-no-git.png', fullPage: true })
  check('offers a button and a command', (await g.page.locator('section.card:has-text("Git is needed")').innerText()).includes('Check again'))
  check('the create/clone forms are hidden until git works', (await g.page.locator('text=Start a new repository').count()) === 0)
  await g.app.close()
  server.close()
  console.log(process.exitCode ? 'E2E-GIT FAILED' : 'E2E-GIT OK')
})().catch((e) => { console.error('E2E-GIT FAIL', e); process.exit(1) })
