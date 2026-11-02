import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import {
  applyImport, assetNeeds, buildInstance, describeLaunch, findObsProcessesLinux, instancePaths, isInstallRunning, seedInstance, captureLive, cloneRepo, createRepoFromBundle, detectInstalls, detectLinuxPackageManager, exportBundle, getRemoteUrl,
  gitAvailable, gitInstallHelp, githubAuthGit, githubListRepos, githubWhoAmI, initRepo, markSynced, planImport, portableInstall, publishToGithub,
  pullRepo, pushRepo, readBundle, readBundleDir, realHost, redact, repoLog, repoNameFromUrl, repoStatus, setRemote, validateRemoteUrl,
  writeBundleDir, writeBundleZip, GithubError, defaultGit, type Bundle, type GitRunner, type ObsInstall,
  assetBundlePath, attachSecrets, commitAll, detectVersions, listNames, obsHasLayout, obsHasOutput, renameLayoutInObs, renameOutputInObs,
  renamePreset, renameSceneLayout, renameOutputSetting, renameSceneOrSource, renameSourceInObs, RenameError,
} from '@obs-config-loader/core'
import { Updates } from './updater'
import type { BundleSummary, ExportRequest, ExportResult, GithubState, ImportRequest, InstallInfo, Locations, RepoInfo } from './api'

const host = realHost()
const bundles = new Map<string, Bundle & { source: string }>()
let nextHandle = 1

// ── settings (user-added installs) ───────────────────────────────────────────
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
interface RepoEntry { path: string; installId?: string }
interface Settings {
  customInstalls: ObsInstall[]; repos: RepoEntry[]; customFrame?: boolean
  /** Where new presets are kept. Unset = the app's own folder under Documents. */
  presetsRoot?: string
  /** Remember stream keys on this computer (encrypted by the system keychain, never in a preset or online). Default on. */
  rememberKeys?: boolean
}
function loadSettings(): Settings {
  try { return { customInstalls: [], repos: [], ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) } } catch { return { customInstalls: [], repos: [] } }
}
function saveSettings(s: Settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
}

function allInstalls(): ObsInstall[] {
  const found = detectInstalls(host)
  const custom = loadSettings().customInstalls.filter((c) => !found.some((f) => f.id === c.id))
  // configExists can change while the app runs (OBS started for the first time)
  return [...found, ...custom].map((i) => ({ ...i, configExists: host.exists(i.configDir) }))
}

function findInstall(id: string): ObsInstall {
  const i = allInstalls().find((x) => x.id === id)
  if (!i) throw new Error('That OBS install is no longer there. Refresh the list.')
  return i
}

/** Is any OBS process running? (Windows and macOS: OBS cannot be told apart per settings folder there.) */
function anyObsRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], (e, out) => resolve(!e && /obs64\.exe/i.test(out)))
    } else {
      const name = process.platform === 'darwin' ? 'OBS' : 'obs'
      execFile('pgrep', ['-x', name], (e) => resolve(!e))
    }
  })
}

/**
 * Which installs have a running OBS. OBS rewrites the files of the folder it uses when it quits, so an import must wait
 * for exactly that OBS: on Linux each process's own settings folder is read, so a separate OBS running does not block the
 * main one (and the other way round). Elsewhere any OBS counts.
 */
async function runningMap(installs: ObsInstall[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  if (process.platform === 'linux') {
    const procs = findObsProcessesLinux()
    for (const i of installs) out.set(i.id, isInstallRunning(i, procs, host))
  } else {
    const any = await anyObsRunning()
    for (const i of installs) out.set(i.id, any)
  }
  return out
}
const obsRunningFor = async (i: ObsInstall) => (await runningMap([i])).get(i.id) ?? false

function listDirs(p: string, ext?: string): string[] {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => (ext ? d.isFile() && d.name.endsWith(ext) : d.isDirectory()))
      .map((d) => (ext ? d.name.slice(0, -ext.length) : d.name)).sort()
  } catch { return [] }
}

async function describe(i: ObsInstall, running: boolean): Promise<InstallInfo> {
  const base = i.instance ? allInstalls().find((x) => x.id === i.instance!.of) : undefined
  return {
    ...i, running, baseLabel: base?.label ?? (i.instance ? 'an OBS install that is no longer there' : undefined),
    collections: listDirs(path.join(i.configDir, 'basic', 'scenes'), '.json'),
    profiles: listDirs(path.join(i.configDir, 'basic', 'profiles')),
  }
}

function summarise(b: Bundle, source: string): BundleSummary {
  const handle = String(nextHandle++)
  bundles.set(handle, { ...b, source })
  const isRepo = fs.existsSync(source) && fs.statSync(source).isDirectory() && fs.existsSync(path.join(source, '.git'))
  return {
    handle, manifest: b.manifest, source, mediaFiles: [...b.files.keys()].filter((k) => k.startsWith('media/')).length,
    ...(isRepo ? { repoDir: source } : {}),
  }
}

// ── machine-specific answers for a bundle: where its big media are, folder choices (never secrets) ──
const locationsPath = () => path.join(app.getPath('userData'), 'locations.json')
function readLocations(): Record<string, Locations> {
  try { return JSON.parse(fs.readFileSync(locationsPath(), 'utf8')) } catch { return {} }
}
function writeLocations(all: Record<string, Locations>) {
  fs.mkdirSync(path.dirname(locationsPath()), { recursive: true })
  fs.writeFileSync(locationsPath(), JSON.stringify(all, null, 2))
}

// ── config repositories ──────────────────────────────────────────────────────
async function repoInfo(e: RepoEntry): Promise<RepoInfo> {
  const git = gitRunner()
  const status = await repoStatus(e.path, git)
  return { path: e.path, name: status.manifest?.name ?? path.basename(e.path), installId: e.installId, status, remoteUrl: status.remote ? await getRemoteUrl(e.path, git) : undefined }
}
function rememberRepo(p: string, installId?: string) {
  const s = loadSettings()
  const hit = s.repos.find((r) => r.path === p)
  if (hit) { if (installId) hit.installId = installId } else s.repos.push({ path: p, installId })
  saveSettings(s)
}

async function cloneRepoWith(url: string, folder: string) { await cloneRepo(url, folder, gitRunner()) }

// ── git itself, and the GitHub sign-in ───────────────────────────────────────
// A token is kept encrypted with the OS keychain when there is one; otherwise only in memory for this session.
let githubTokenMem: string | undefined
let githubLogin: string | undefined
let githubSessionOnly = false
const githubPath = () => path.join(app.getPath('userData'), 'github.bin')
function loadGithubToken(): string | undefined {
  if (githubTokenMem) return githubTokenMem
  try { githubTokenMem = safeStorage.decryptString(fs.readFileSync(githubPath())) } catch { /* none saved */ }
  return githubTokenMem
}
/** The git every repository operation runs through: the user's own git, signed in to github.com when connected. */
function gitRunner(): GitRunner { return githubAuthGit(loadGithubToken(), defaultGit) }
const noGit = () => !!process.env.OBSCL_FAKE_NO_GIT // lets tests show the "install git" screen
const hasGit = async () => !noGit() && (await gitAvailable())
const gitMissing = 'Git is not installed. Open the Git repositories page: it can install it for you.'
const errText = (e: unknown) => redact((e as Error).message, loadGithubToken())

/** A folder name for a new repository under Documents, never one that already has something in it. */
/** The app's own folder for presets: ~/Documents/OBS Config Loader/Presets unless the person chose another. */
function defaultPresetsRoot(): string {
  // Some systems report the home folder itself as "Documents" (no desktop folder settings): use ~/Documents then.
  let docs = app.getPath('documents')
  if (path.resolve(docs) === path.resolve(app.getPath('home'))) docs = path.join(docs, 'Documents')
  return path.join(docs, 'OBS Config Loader', 'Presets')
}
const presetsRoot = () => loadSettings().presetsRoot || defaultPresetsRoot()

function suggestFolder(name: string): string {
  const root = presetsRoot()
  const base = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'obs-setup'
  let p = path.join(root, base)
  for (let n = 2; fs.existsSync(p) && fs.readdirSync(p).length; n++) p = path.join(root, `${base}-${n}`)
  return p
}
const emptyOrMissing = (p: string) => !fs.existsSync(p) || fs.readdirSync(p).length === 0

async function openBundlePath(p: string): Promise<BundleSummary | { error: string }> {
  try { return summarise(await readBundle(p), p) } catch (e) { return { error: (e as Error).message } }
}

// ── secrets: remembered answers, encrypted with the OS keychain when there is one ──
const secretsPath = () => path.join(app.getPath('userData'), 'secrets.bin')
function readSecrets(): Record<string, Record<string, string>> {
  try {
    const raw = fs.readFileSync(secretsPath())
    return JSON.parse(safeStorage.decryptString(raw))
  } catch { return {} }
}

function writeSecretsClear() { try { fs.rmSync(secretsPath(), { force: true }) } catch { /* nothing there */ } }
function writeSecrets(all: Record<string, Record<string, string>>): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false // never write secrets in the clear
  fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
  fs.writeFileSync(secretsPath(), safeStorage.encryptString(JSON.stringify(all)))
  return true
}

/** After a save: keep this OBS's stream keys on this computer (encrypted), so a preset can be loaded or exported with them later. */
function rememberKeysFrom(install: ObsInstall, presetPath: string): number {
  if (loadSettings().rememberKeys === false || !safeStorage.isEncryptionAvailable()) return 0
  try {
    const live = exportBundle({ host, install, name: 'keys', includeSecrets: true, bundleBelowBytes: 0 })
    const values = Object.fromEntries(live.manifest.variables.filter((v) => v.kind === 'secret' && v.value).map((v) => [v.name, v.value!]))
    if (!Object.keys(values).length) return 0
    const id = readBundleDir(presetPath).manifest.id
    const all = readSecrets()
    all[id] = { ...(all[id] ?? {}), ...values }
    return writeSecrets(all) ? Object.keys(values).length : 0
  } catch { return 0 }
}

// ── updates (electron-updater from the project's GitHub releases) ──
const updates = new Updates(app.isPackaged, (st) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('updates:state', st)
})

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('installs:list', async () => {
    const all = allInstalls()
    const running = await runningMap(all)
    return Promise.all(all.map((i) => describe(i, running.get(i.id) ?? false)))
  })
  ipcMain.handle('installs:addPortable', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose the portable OBS folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    const got = portableInstall(host, r.filePaths[0])
    if ('error' in got) return { error: got.error }
    const s = loadSettings()
    if (!s.customInstalls.some((c) => c.id === got.id)) { s.customInstalls.push(got); saveSettings(s) }
    return { added: await describe(got, await obsRunningFor(got)) }
  })
  ipcMain.handle('installs:remove', (_e, id: string) => {
    const s = loadSettings()
    s.customInstalls = s.customInstalls.filter((c) => c.id !== id)
    saveSettings(s)
  })
  ipcMain.handle('installs:openFolder', async (_e, id: string) => { await shell.openPath(findInstall(id).configDir) })

  // ── starting OBS, and separate OBS instances ──
  ipcMain.handle('installs:launch', async (_e, id: string) => {
    const i = findInstall(id)
    if (!i.launch) return { ok: false, message: 'This app does not know how to start that OBS. Start it the usual way.' }
    const { command, args, env } = i.launch
    // a portable OBS must be started from its own folder (its settings are found relative to it)
    const cwd = path.isAbsolute(command) ? path.dirname(command) : undefined
    try {
      const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: 'ignore' })
      const failed = await new Promise<string | null>((resolve) => {
        child.once('error', (e) => resolve((e as Error).message))
        setTimeout(() => resolve(null), 400) // an immediate "not found" arrives well before this
      })
      if (failed) return { ok: false, message: `Could not start it (${failed}).`, command: describeLaunch(i) }
      child.unref()
      return { ok: true, message: 'Starting OBS…', command: describeLaunch(i) }
    } catch (e) { return { ok: false, message: `Could not start it (${(e as Error).message}).`, command: describeLaunch(i) } }
  })
  ipcMain.handle('installs:verify', (_e, id: string, since: number) => {
    const i = findInstall(id)
    // Copied settings are there before OBS ever runs, so "the folder exists" proves nothing. OBS writes a new log file into
    // the folder it really uses every time it starts, and rewrites global.ini: look for something newer than the start.
    const fresh = (p: string) => { try { return fs.statSync(p).mtimeMs >= since - 2000 } catch { return false } }
    const logs = path.join(i.configDir, 'logs')
    let newLog = false
    try { newLog = fs.readdirSync(logs).some((f) => fresh(path.join(logs, f))) } catch { /* no logs folder yet */ }
    return { usesOwnSettings: newLog || fresh(path.join(i.configDir, 'global.ini')) }
  })

  ipcMain.handle('instances:support', (_e, baseId: string, name?: string) => instancePaths(findInstall(baseId), host, name || 'new'))
  ipcMain.handle('instances:create', async (_e, r: { baseId: string; name: string; copySettings: boolean }) => {
    const name = r.name.trim()
    if (!name) return { ok: false, error: 'Give it a name.' }
    const base = findInstall(r.baseId)
    const sup = instancePaths(base, host, name)
    if (!sup.ok) return { ok: false, error: sup.reason }
    const inst = buildInstance(base, host, name, sup.paths)
    if (allInstalls().some((x) => x.id === inst.id)) return { ok: false, error: 'There is already a separate OBS with that name.' }
    try {
      fs.mkdirSync(sup.paths.pluginsDir, { recursive: true })
      fs.mkdirSync(sup.paths.dataHome, { recursive: true })
      if (r.copySettings) seedInstance(base.configDir, sup.paths.configDir)
    } catch (e) { return { ok: false, error: `Could not create its folders: ${(e as Error).message}` } }
    const s = loadSettings()
    s.customInstalls.push({ ...inst, configExists: fs.existsSync(inst.configDir) })
    saveSettings(s)
    return { ok: true, install: await describe(inst, false) }
  })
  ipcMain.handle('instances:remove', (_e, id: string, deleteFiles: boolean) => {
    const s = loadSettings()
    const hit = s.customInstalls.find((c) => c.id === id)
    s.customInstalls = s.customInstalls.filter((c) => c.id !== id)
    saveSettings(s)
    // only ever delete inside the folders the app itself made for the instance
    if (deleteFiles && hit?.instance && hit.instance.configHome.includes(`${path.sep}instances${path.sep}`)) {
      fs.rmSync(hit.instance.configHome, { recursive: true, force: true })
      fs.rmSync(hit.instance.dataHome, { recursive: true, force: true })
    }
  })
  ipcMain.handle('instances:openPlugins', async (_e, id: string) => {
    const i = findInstall(id)
    const dir = i.pluginDirs[0]
    if (dir) { fs.mkdirSync(dir, { recursive: true }); await shell.openPath(dir) }
  })

  ipcMain.handle('bundle:open', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Open an OBS config bundle',
      properties: ['openFile'],
      filters: [{ name: 'OBS config bundle', extensions: ['obsbundle', 'zip'] }],
    })
    return r.canceled || !r.filePaths[0] ? null : openBundlePath(r.filePaths[0])
  })
  ipcMain.handle('bundle:openFolder', async () => {
    const r = await dialog.showOpenDialog({ title: 'Open a config bundle folder', properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : openBundlePath(r.filePaths[0])
  })
  ipcMain.handle('bundle:openPath', (_e, p: string) => openBundlePath(p))

  const importOpts = async (r: ImportRequest) => {
    const b = bundles.get(r.handle)
    if (!b) throw new Error('That bundle is no longer open. Open it again.')
    return {
      bundle: b, install: findInstall(r.installId), host,
      collections: r.collections, profiles: r.profiles, variables: r.variables, assetFiles: r.assetFiles,
      conflict: r.conflict, activate: r.activate, preferPipewire: r.preferPipewire, obsRunning: await obsRunningFor(findInstall(r.installId)),
      installed: detectVersions(findInstall(r.installId), host), websocket: r.websocket,
    }
  }
  ipcMain.handle('import:plan', async (_e, r: ImportRequest) => planImport(await importOpts(r)).report)
  ipcMain.handle('import:apply', async (_e, r: ImportRequest) => {
    const opts = await importOpts(r)
    const res = applyImport(planImport(opts))
    // Loaded from a repository: OBS now matches its current state, so later live edits are measured from here.
    if (fs.existsSync(path.join(opts.bundle.source, '.git'))) await markSynced(opts.bundle.source, opts.install)
    return { written: res.written.length, backedUp: res.backedUp.length, backupDir: res.backupDir }
  })

  ipcMain.handle('export:run', async (_e, r: ExportRequest): Promise<ExportResult | { error: string } | null> => {
    try {
      const install = findInstall(r.installId)
      const bundle = exportBundle({
        host, install, name: r.name, collections: r.collections, profiles: r.profiles, appVersion: app.getVersion(), versions: detectVersions(install, host), includeSecrets: r.includeKeys === true && (r.format ?? 'file') === 'file',
        bundleBelowBytes: r.media === 'all' ? Infinity : r.media === 'none' ? 0 : undefined,
      })
      let out: string
      if ((r.format ?? 'file') === 'file') {
        // a file that carries keys says so in its name, so it is obvious in a downloads folder or an email
        const mark = bundle.manifest.containsSecrets ? ' (CONTAINS STREAM KEYS)' : ''
        const d = await dialog.showSaveDialog({
          title: 'Save your setup', defaultPath: `${r.name.replace(/[\\/:*?"<>|]/g, '_')}${mark}.obsbundle`,
          filters: [{ name: 'OBS config bundle', extensions: ['obsbundle'] }],
        })
        if (d.canceled || !d.filePath) return null
        fs.writeFileSync(d.filePath, await writeBundleZip(bundle))
        out = d.filePath
      } else {
        const d = await dialog.showOpenDialog({ title: 'Choose the folder for the bundle (a git checkout works)', properties: ['openDirectory', 'createDirectory'] })
        if (d.canceled || !d.filePaths[0]) return null
        writeBundleDir(bundle, d.filePaths[0], { withMedia: false })
        out = d.filePaths[0]
      }
      const m = bundle.manifest
      return {
        path: out, collections: m.collections.length, profiles: m.profiles.length,
        sizeBytes: (() => { try { return fs.statSync(out).isFile() ? fs.statSync(out).size : 0 } catch { return 0 } })(),
        assets: { bundled: m.assets.filter((a) => a.mode === 'bundled').length, external: m.assets.filter((a) => a.mode === 'external').length },
        containsSecrets: m.containsSecrets === true,
        secrets: m.containsSecrets ? [] : m.variables.filter((v) => v.kind === 'secret').map((v) => v.label ?? v.name),
        plugins: m.plugins.map((p) => p.name),
        warnings: [],
      }
    } catch (e) { return { error: (e as Error).message } }
  })

  ipcMain.handle('git:state', async () => ({
    available: await hasGit(), platform: process.platform,
    help: gitInstallHelp(host.platform, host.platform === 'linux' ? detectLinuxPackageManager() : undefined),
  }))
  ipcMain.handle('git:install', async () => {
    const help = gitInstallHelp(host.platform, host.platform === 'linux' ? detectLinuxPackageManager() : undefined)
    if (!help.auto) return { ok: false, message: help.manual }
    const { command, args } = help.auto
    return new Promise((resolve) => {
      execFile(command, args, { timeout: 15 * 60 * 1000 }, (err, _out, stderr) => {
        if (err) resolve({ ok: false, message: `The installer did not finish (${(stderr || err.message).toString().trim().split('\n').slice(-2).join(' ')}). ${help.manual}` })
        else resolve({ ok: true, message: 'Installer finished.' })
      })
    })
  })

  ipcMain.handle('github:state', (): GithubState => ({ connected: !!loadGithubToken(), login: githubLogin, sessionOnly: githubSessionOnly || undefined }))
  ipcMain.handle('github:connect', async (_e, token: string) => {
    const t = token.trim()
    if (!t) return { ok: false, error: 'Paste the token first.' }
    try {
      const who = await githubWhoAmI(t)
      githubTokenMem = t; githubLogin = who.login
      if (safeStorage.isEncryptionAvailable()) { fs.writeFileSync(githubPath(), safeStorage.encryptString(t)); githubSessionOnly = false }
      else githubSessionOnly = true // no keychain: never write it in the clear
      return { ok: true, login: who.login, sessionOnly: githubSessionOnly }
    } catch (e) { return { ok: false, error: errText(e) } }
  })
  ipcMain.handle('github:disconnect', () => {
    githubTokenMem = undefined; githubLogin = undefined; githubSessionOnly = false
    try { fs.rmSync(githubPath()) } catch { /* nothing saved */ }
  })
  ipcMain.handle('github:repos', async () => {
    const t = loadGithubToken()
    if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
    try { return { ok: true, repos: await githubListRepos(t) } } catch (e) { return { ok: false, error: errText(e) } }
  })

  ipcMain.handle('repos:list', async () => Promise.all(loadSettings().repos.filter((r) => fs.existsSync(r.path)).map(repoInfo)))
  ipcMain.handle('repos:suggestFolder', (_e, name: string) => suggestFolder(name))
  ipcMain.handle('repos:remove', (_e, p: string) => {
    const s = loadSettings(); s.repos = s.repos.filter((r) => r.path !== p); saveSettings(s)
  })
  ipcMain.handle('repos:openFolder', async (_e, p: string) => { await shell.openPath(p) })
  ipcMain.handle('repos:setInstall', (_e, p: string, installId: string) => rememberRepo(p, installId))

  ipcMain.handle('repos:addExisting', async () => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const r = await dialog.showOpenDialog({ title: 'Choose a config repository folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true, error: '' }
    const st = await repoStatus(r.filePaths[0], gitRunner())
    if (!st.isRepo) return { ok: false, error: 'That folder is not a git repository (it must be the top folder of one).' }
    if (!st.hasManifest) return { ok: false, error: 'That repository has no manifest.json, so it is not an OBS config bundle.' }
    rememberRepo(r.filePaths[0])
    return { ok: true, repo: await repoInfo({ path: r.filePaths[0] }) }
  })

  ipcMain.handle('repos:clone', async (_e, url: string, folder: string) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const v = validateRemoteUrl(url)
    if (!v.ok) return { ok: false, error: v.message }
    if (!emptyOrMissing(folder)) return { ok: false, error: 'That folder is not empty. Choose another one.' }
    try { await cloneRepoWith(v.url, folder) } catch (e) { return { ok: false, error: errText(e) } }
    if (!fs.existsSync(path.join(folder, 'manifest.json'))) return { ok: false, error: 'It was downloaded, but it has no manifest.json: it is not an OBS config repository.' }
    rememberRepo(folder)
    return { ok: true, repo: await repoInfo({ path: folder }) }
  })

  ipcMain.handle('repos:create', async (_e, r: { installId: string; name: string; folder: string; github?: { private: boolean } }) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    if (!emptyOrMissing(r.folder)) return { ok: false, error: 'That folder is not empty. Choose another one.' }
    try {
      const git = gitRunner()
      await initRepo(r.folder, git)
      const inst = findInstall(r.installId)
      const res = await captureLive({ host, install: inst, dir: r.folder, name: r.name, appVersion: app.getVersion(), versions: detectVersions(inst, host), git })
      if (res.status === 'error') return { ok: false, error: res.message }
      rememberKeysFrom(inst, r.folder)
      rememberRepo(r.folder, r.installId)
      let published: string | undefined
      if (r.github) {
        const t = loadGithubToken()
        if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
        try {
          const out = await publishToGithub(r.folder, t, r.name, { private: r.github.private })
          published = out.repo.htmlUrl
          if (out.push.status === 'error') return { ok: false, error: `Created on GitHub, but pushing failed: ${out.push.message}` }
        } catch (e) { return { ok: false, error: `The repository was created on this computer, but not on GitHub: ${errText(e)}` } }
      }
      return { ok: true, repo: await repoInfo({ path: r.folder, installId: r.installId }), published }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  ipcMain.handle('repos:fromBundle', async (_e, handle: string, folder: string) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const b = bundles.get(handle)
    if (!b) return { ok: false, error: 'That bundle is no longer open. Open it again.' }
    try { await createRepoFromBundle(folder, b, gitRunner()) } catch (e) { return { ok: false, error: errText(e) } }
    rememberRepo(folder)
    return { ok: true, repo: await repoInfo({ path: folder }) }
  })

  ipcMain.handle('repos:setRemote', async (_e, p: string, url: string) => {
    const r = await setRemote(p, url, gitRunner())
    return r.ok ? { ok: true } : { ok: false, error: r.message }
  })
  ipcMain.handle('repos:publish', async (_e, p: string, name: string, priv: boolean) => {
    const t = loadGithubToken()
    if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
    try {
      const out = await publishToGithub(p, t, name, { private: priv })
      if (out.push.status === 'error') return { ok: false, error: `Created on GitHub, but pushing failed: ${out.push.message}` }
      return { ok: true, url: out.repo.htmlUrl, pushed: out.push.status === 'pushed' }
    } catch (e) { return { ok: false, error: e instanceof GithubError ? errText(e) : errText(e) } }
  })

  ipcMain.handle('repos:live', async (_e, p: string, installId: string) => {
    const r = await captureLive({ host, install: findInstall(installId), dir: p, dryRun: true, git: gitRunner() })
    if (r.status === 'error') return { error: r.message }
    return { changed: r.status === 'changes' ? r.files : [] }
  })
  ipcMain.handle('repos:save', async (_e, p: string, installId: string, commitDirtyFirst: boolean, onConflict?: 'abort' | 'keep-repo' | 'keep-obs') => {
    const inst = findInstall(installId)
    const r = await captureLive({
      host, install: inst, dir: p, onDirty: commitDirtyFirst ? 'commit-first' : 'refuse', onConflict,
      appVersion: app.getVersion(), versions: detectVersions(inst, host), git: gitRunner(),
    })
    if (r.status === 'changes') return { status: 'unchanged' }
    if (r.status === 'committed' || r.status === 'unchanged') {
      const keys = rememberKeysFrom(inst, p)
      // a preset that is backed up online is kept up to date: upload right after saving (a failure is reported, not hidden)
      let upload: 'uploaded' | 'failed' | undefined
      let uploadError: string | undefined
      if (r.status === 'committed' && (await repoStatus(p, gitRunner())).remote) {
        const pr = await pushRepo(p, gitRunner())
        if (pr.status === 'pushed') upload = 'uploaded'
        else if (pr.status === 'error') {
          upload = 'failed'
          uploadError = /rejected|non-fast-forward|fetch first|behind|fast-forward|git pull/i.test(pr.message) ? 'The online copy has newer changes. Press “Get updates” first, then “Upload now”.' : pr.message
        }
      }
      return { ...r, keysRemembered: keys, upload, uploadError }
    }
    return r
  })
  ipcMain.handle('repos:pull', (_e, p: string, onConflict?: 'abort' | 'keep-mine' | 'keep-theirs') => pullRepo(p, gitRunner(), onConflict))
  ipcMain.handle('repos:push', (_e, p: string) => pushRepo(p, gitRunner()))
  ipcMain.handle('repos:log', (_e, p: string) => repoLog(p, 15, gitRunner()))
  ipcMain.handle('repos:needs', async (_e, p: string) => {
    const m = readBundleDir(p).manifest
    return assetNeeds(m, readLocations()[m.id]?.assets ?? {})
  })
  ipcMain.handle('repos:setAsset', (_e, p: string, assetId: string, file: string) => {
    const m = readBundleDir(p).manifest
    const all = readLocations()
    const cur = all[m.id] ?? { assets: {}, variables: {} }
    cur.assets[assetId] = file
    all[m.id] = cur
    writeLocations(all)
  })
  ipcMain.handle('locations:load', (_e, id: string) => readLocations()[id] ?? { assets: {}, variables: {} })
  ipcMain.handle('locations:save', (_e, id: string, l: Locations) => {
    const all = readLocations(); all[id] = l; writeLocations(all)
  })

  ipcMain.handle('files:pick', async (_e, title: string, folder?: boolean) => {
    const r = await dialog.showOpenDialog({ title, properties: [folder ? 'openDirectory' : 'openFile'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('files:reveal', (_e, p: string) => { shell.showItemInFolder(p) })

  ipcMain.handle('secrets:load', (_e, id: string) => readSecrets()[id] ?? {})
  ipcMain.handle('secrets:save', (_e, id: string, values: Record<string, string>) => {
    const all = readSecrets()
    all[id] = values
    return writeSecrets(all)
  })

  // ── settings ──
  ipcMain.handle('settings:get', () => {
    const s = loadSettings()
    return {
      presetsRoot: presetsRoot(), defaultPresetsRoot: defaultPresetsRoot(), isDefault: !s.presetsRoot,
      rememberKeys: s.rememberKeys !== false, canStoreKeys: safeStorage.isEncryptionAvailable(),
    }
  })
  ipcMain.handle('settings:setPresetsRoot', (_e, p: string | null) => {
    const s = loadSettings()
    if (p) s.presetsRoot = p; else delete s.presetsRoot
    saveSettings(s)
  })
  ipcMain.handle('settings:setRememberKeys', (_e, on: boolean) => {
    const s = loadSettings(); s.rememberKeys = on === true; saveSettings(s)
    if (!on) writeSecretsClear()
  })

  // ── presets (a preset is one of the saved setup folders) ──
  ipcMain.handle('presets:keys', (_e, p: string) => {
    try { return { count: Object.keys(readSecrets()[readBundleDir(p).manifest.id] ?? {}).length, canStore: safeStorage.isEncryptionAvailable() } } catch { return { count: 0, canStore: safeStorage.isEncryptionAvailable() } }
  })
  ipcMain.handle('presets:details', (_e, p: string) => {
    const m = readBundleDir(p).manifest
    return {
      savedWithObs: m.savedWithObs as string | undefined,
      plugins: m.plugins.map((x) => ({ name: x.name, version: x.version, known: !x.id.startsWith('unknown:') })),
      scripts: m.assets.filter((a) => a.role === 'script').map((a) => a.filename),
      remoteControl: readBundleDir(p).files.has('global/obs-websocket.json'),
      layouts: m.collections.map((c) => ({ id: c.id, name: c.name, ...listNames(p, c.id) })),
      outputs: m.profiles.map((x) => ({ id: x.id, name: x.name })),
    }
  })
  ipcMain.handle('presets:exportFile', async (_e, p: string, includeKeys: boolean) => {
    try {
      const b = readBundleDir(p)
      // bring back the big files this computer knows about, so the file is complete
      const locs = readLocations()[b.manifest.id]?.assets ?? {}
      for (const a of b.manifest.assets) {
        const f = locs[a.id]
        if (a.mode === 'external' && f && fs.existsSync(f) && fs.statSync(f).size <= 5 * 1024 * 1024) {
          a.mode = 'bundled'; b.files.set(assetBundlePath(a), fs.readFileSync(f))
        }
      }
      const kept = includeKeys ? attachSecrets(b, readSecrets()[b.manifest.id] ?? {}) : 0
      const mark = b.manifest.containsSecrets ? ' (CONTAINS STREAM KEYS)' : ''
      const d = await dialog.showSaveDialog({
        title: 'Save your setup to a file', defaultPath: `${b.manifest.name.replace(/[\\/:*?"<>|]/g, '_')}${mark}.obsbundle`,
        filters: [{ name: 'OBS config bundle', extensions: ['obsbundle'] }],
      })
      if (d.canceled || !d.filePath) return { ok: false, cancelled: true, error: '' }
      fs.writeFileSync(d.filePath, await writeBundleZip(b))
      return { ok: true, path: d.filePath, keys: kept, missingMedia: b.manifest.assets.filter((a) => a.mode === 'external').map((a) => a.filename) }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('presets:rename', async (_e, r: { path: string; installId?: string; kind: 'preset' | 'layout' | 'output' | 'scene'; id?: string; layoutId?: string; from?: string; to: string }) => {
    const git = gitRunner()
    try {
      const st = await repoStatus(r.path, git)
      if (st.dirtyFiles.length) return { ok: false, error: 'This preset has changes that are not saved yet. Save them first, then rename.' }
      const m = readBundleDir(r.path).manifest
      const inst = r.installId ? allInstalls().find((i) => i.id === r.installId && i.configExists) : undefined
      const layout = m.collections.find((c) => c.id === (r.kind === 'layout' ? r.id : r.layoutId))
      const output = m.profiles.find((x) => x.id === r.id)
      // is the same thing in the linked OBS too?
      const inObs = !!inst && (r.kind === 'layout' ? !!layout && obsHasLayout(inst.configDir, layout.name)
        : r.kind === 'output' ? !!output && obsHasOutput(inst.configDir, output.name)
        : r.kind === 'scene' ? !!layout && obsHasLayout(inst.configDir, layout.name) : false)
      if (inObs && (await obsRunningFor(inst!))) return { ok: false, error: 'OBS is open. Close it first, so the new name can be changed in OBS as well.' }
      if (inObs) {
        // make sure nothing done in OBS since the last save is lost
        const cap = await captureLive({ host, install: inst!, dir: r.path, appVersion: app.getVersion(), versions: detectVersions(inst!, host), git })
        if (cap.status === 'conflict') return { ok: false, error: 'OBS and this preset changed the same part. Save OBS to the preset first and settle that, then rename.' }
        if (cap.status === 'error' || cap.status === 'dirty') return { ok: false, error: cap.status === 'error' ? cap.message : 'This preset has changes that are not saved yet.' }
      }
      const fresh = readBundleDir(r.path).manifest // the save above may have changed the ids
      const layoutNow = fresh.collections.find((c) => c.name === layout?.name) ?? layout
      const outputNow = fresh.profiles.find((x) => x.name === output?.name) ?? output
      const label = r.kind === 'preset' ? 'preset' : r.kind === 'layout' ? 'scene layout' : r.kind === 'output' ? 'output settings' : 'scene'
      try {
        if (r.kind === 'preset') renamePreset(r.path, r.to)
        else if (r.kind === 'layout') renameSceneLayout(r.path, layoutNow!.id, r.to)
        else if (r.kind === 'output') renameOutputSetting(r.path, outputNow!.id, r.to)
        else renameSceneOrSource(r.path, layoutNow!.id, r.from!, r.to)
        if (inObs) {
          if (r.kind === 'layout') renameLayoutInObs(inst!.configDir, layoutNow!.name, r.to)
          else if (r.kind === 'output') renameOutputInObs(inst!.configDir, outputNow!.name, r.to)
          else renameSourceInObs(inst!.configDir, layoutNow!.name, r.from!, r.to)
        }
      } catch (e) {
        // leave the preset exactly as it was
        await git(['checkout', '--', '.'], r.path); await git(['clean', '-fdq'], r.path)
        throw e
      }
      await commitAll(r.path, `Renamed ${label}${r.from ? ` “${r.from}”` : ''} to “${r.to.trim()}”`, git)
      if (inObs) await markSynced(r.path, inst!, git)
      if (st.remote) await pushRepo(r.path, git) // best effort: a failure shows as "to upload" on the preset
      return { ok: true, alsoInObs: inObs }
    } catch (e) {
      return { ok: false, error: e instanceof RenameError ? e.message : errText(e) }
    }
  })

  ipcMain.handle('presets:setOnline', async (_e, p: string, on: boolean, name: string, priv: boolean) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const git = gitRunner()
    try {
      const st = await repoStatus(p, git)
      if (!on) {
        if (st.remote) await git(['remote', 'remove', 'origin'], p)
        return { ok: true }
      }
      if (!st.remote) {
        const t = loadGithubToken()
        if (!t) return { ok: false, needsAccount: true, error: 'Sign in to GitHub first (under Settings), then switch this on.' }
        const out = await publishToGithub(p, t, name, { private: priv })
        if (out.push.status === 'error') return { ok: false, error: `Created on GitHub, but uploading failed: ${out.push.message}` }
        return { ok: true, url: out.repo.htmlUrl }
      }
      const pr = await pushRepo(p, git)
      return pr.status === 'error' ? { ok: false, error: pr.message } : { ok: true }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  ipcMain.handle('updates:state', () => updates.state)
  ipcMain.handle('updates:check', () => updates.check())
  ipcMain.handle('updates:install', () => { updates.install() })
  // the theme-drawn title bar (the engine's window-frame module): off by default, applies after a restart
  ipcMain.handle('window:frame', () => ({ custom: !!loadSettings().customFrame, platform: process.platform }))
  ipcMain.handle('window:setCustomFrame', (_e, on: boolean) => { const s = loadSettings(); s.customFrame = on === true; saveSettings(s) })
  ipcMain.handle('window:control', (e, action: 'minimize' | 'maximize' | 'close') => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (action === 'minimize') w.minimize()
    else if (action === 'close') w.close()
    else if (w.isMaximized()) w.unmaximize(); else w.maximize()
  })
  ipcMain.handle('window:restart', () => { app.relaunch(); app.exit(0) })
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url) // only web links, never file: or custom schemes
  })
}

function createWindow() {
  const custom = loadSettings().customFrame === true
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 560, title: 'OBS Config Loader',
    frame: !custom, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  const tell = () => { if (!win.isDestroyed()) win.webContents.send('window:state', win.isMaximized()) }
  win.on('maximize', tell); win.on('unmaximize', tell)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault() })
  void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  ;(app as unknown as { setDesktopName?(n: string): void }).setDesktopName?.('obs-config-loader.desktop')
  void app.whenReady().then(() => {
    registerIpc()
    createWindow()
    updates.start()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
