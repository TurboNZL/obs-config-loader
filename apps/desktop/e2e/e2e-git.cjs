// End-to-end run of the git workflow in the real app (fake Flatpak OBS, bare remote, stubbed dialogs).
// xvfb-run -a node e2e/e2e-git.cjs   (after `pnpm --filter @obs-config-loader/desktop build`)
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os')
const { execFileSync } = require('child_process')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots')
fs.mkdirSync(OUT, { recursive: true })
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...a], { cwd, encoding: 'utf8' }).trim()

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
  { id: 'scene', name: 'Scene', settings: { items: [] } },
  { id: 'color_source', name: 'Backdrop', settings: { color: 1 } } ] })
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/basic.ini'), '[General]\nName=Main\n')
fs.writeFileSync(path.join(cfg, 'basic/profiles/Main/service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_SECRET' } }))
fs.writeFileSync(path.join(cfg, 'global.ini'), '[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')
const repoDir = path.join(root, 'repo'); fs.mkdirSync(repoDir)
const bare = path.join(root, 'remote.git'); git(root, 'init', '--bare', '--initial-branch=main', bare)

;(async () => {
  const app = await electron.launch({
    executablePath: APP + '/node_modules/electron/dist/electron',
    args: [APP, '--no-sandbox', '--user-data-dir=' + path.join(root, 'ud')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '' },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 860 })
  await page.waitForSelector('text=Flatpak')
  const pick = (p) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }) }, p)
  const card = () => page.locator('section.card:has-text("My OBS setup")')

  // 1. new repo from the Flatpak install
  await page.click('nav >> text=Git repositories')
  await pick(repoDir)
  await page.click('button:has-text("Create…")')
  await card().waitFor()
  await page.waitForSelector('text=The repository matches OBS')
  console.log('1 created; commits:', git(repoDir, 'rev-list', '--count', 'HEAD'))
  console.log('  secrets in repo:', (() => { try { git(repoDir, 'grep', '-q', 'SECRET'); return 'FOUND (bad)' } catch { return 'none' } })())

  // 2. edit in OBS, the app notices, save
  const j = readScene(); j.sources.push({ id: 'color_source', name: 'LiveEdit1', settings: { color: 2 } }); writeScene(j)
  await page.click('nav >> text=OBS installs'); await page.click('nav >> text=Git repositories')
  await page.waitForSelector('text=not in the repository yet')
  await page.screenshot({ path: OUT + '/g1-live-changes.png' })
  await page.click('button:has-text("Save OBS changes to the repo")')
  await page.waitForSelector('text=Saved (')
  console.log('2 saved; commits:', git(repoDir, 'rev-list', '--count', 'HEAD'))

  // 3. an "AI" edits the repo and commits; the user also edits OBS
  const rp = path.join(repoDir, 'collections/main.json')
  const r = JSON.parse(fs.readFileSync(rp, 'utf8')); r.current_scene = 'AI renamed scene'; fs.writeFileSync(rp, JSON.stringify(r, null, 4) + '\n')
  git(repoDir, 'commit', '-qam', 'AI tweak')
  const j2 = readScene(); j2.sources.push({ id: 'color_source', name: 'LiveEdit2', settings: { color: 3 } }); writeScene(j2)
  await page.click('nav >> text=OBS installs'); await page.click('nav >> text=Git repositories')
  await page.waitForSelector('text=not in the repository yet')
  await page.click('button:has-text("Save OBS changes to the repo")')
  await page.waitForSelector('text=merged with newer changes')
  const merged = fs.readFileSync(rp, 'utf8')
  console.log('3 merged; has AI edit:', merged.includes('AI renamed scene'), '| live edits:', merged.includes('LiveEdit1'), merged.includes('LiveEdit2'))
  await page.screenshot({ path: OUT + '/g2-merged.png' })

  // 4. edited-outside warning: uncommitted change in the repo, then save
  fs.writeFileSync(path.join(repoDir, 'notes.txt'), 'hand edit')
  const j3 = readScene(); j3.sources.push({ id: 'color_source', name: 'LiveEdit3', settings: { color: 4 } }); writeScene(j3)
  await page.click('nav >> text=OBS installs'); await page.click('nav >> text=Git repositories')
  await page.waitForSelector('text=edited outside the app')
  await page.click('button:has-text("Save OBS changes to the repo")')
  await page.waitForSelector('text=must be committed first')
  await page.screenshot({ path: OUT + '/g3-dirty.png' })
  await page.click('button:has-text("Commit them, then save OBS")')
  await page.waitForSelector('text=Saved (')
  console.log('4 dirty handled; notes.txt tracked:', git(repoDir, 'ls-files').includes('notes.txt'))

  // 5. push to a remote
  git(repoDir, 'remote', 'add', 'origin', bare)
  await page.click('nav >> text=OBS installs'); await page.click('nav >> text=Git repositories')
  await page.click('button:has-text("Push")')
  await page.waitForSelector('text=Pushed.')
  console.log('5 pushed; remote commits:', git(bare, 'rev-list', '--count', 'main'))

  // 6. apply the repo back to OBS
  await page.click('button:has-text("Apply to OBS")')
  await page.waitForSelector('text=Report: what Import will do')
  await page.click('button:has-text("Import"):not(:has-text("a setup"))')
  await page.waitForSelector('text=Imported')
  console.log('6 applied; OBS scene has AI edit:', readScene().current_scene)
  await page.screenshot({ path: OUT + '/g4-applied.png' })
  await app.close()
  console.log('E2E-GIT OK')
})().catch((e) => { console.error('E2E-GIT FAIL', e); process.exit(1) })
