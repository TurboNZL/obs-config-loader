import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import {
  applyImport, assetNeeds, captureLive, cloneRepo, detectInstalls, exportBundle, gitAvailable, initRepo, planImport, portableInstall,
  markSynced, pullRepo, pushRepo, readBundle, readBundleDir, realHost, repoLog, repoStatus, writeBundleDir, writeBundleZip,
  type Bundle, type ObsInstall,
} from '@obs-config-loader/core'
import type { BundleSummary, ExportRequest, ExportResult, ImportRequest, InstallInfo, Locations, RepoInfo } from './api'

const host = realHost()
const bundles = new Map<string, Bundle & { source: string }>()
let nextHandle = 1

// ── settings (user-added installs) ───────────────────────────────────────────
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
interface RepoEntry { path: string; installId?: string }
interface Settings { customInstalls: ObsInstall[]; repos: RepoEntry[] }
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

/** Is any OBS process running? OBS rewrites its files on exit, so import must wait. */
function obsRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], (e, out) => resolve(!e && /obs64\.exe/i.test(out)))
    } else {
      const name = process.platform === 'darwin' ? 'OBS' : 'obs'
      execFile('pgrep', ['-x', name], (e) => resolve(!e))
    }
  })
}

function listDirs(p: string, ext?: string): string[] {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => (ext ? d.isFile() && d.name.endsWith(ext) : d.isDirectory()))
      .map((d) => (ext ? d.name.slice(0, -ext.length) : d.name)).sort()
  } catch { return [] }
}

async function describe(i: ObsInstall, running: boolean): Promise<InstallInfo> {
  return {
    ...i, running,
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
  const status = await repoStatus(e.path)
  return { path: e.path, name: status.manifest?.name ?? path.basename(e.path), installId: e.installId, status }
}
function rememberRepo(p: string, installId?: string) {
  const s = loadSettings()
  const hit = s.repos.find((r) => r.path === p)
  if (hit) { if (installId) hit.installId = installId } else s.repos.push({ path: p, installId })
  saveSettings(s)
}
const gitMissing = 'Git was not found. Install git (https://git-scm.com) and try again.'

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

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('installs:list', async () => {
    const running = await obsRunning()
    return Promise.all(allInstalls().map((i) => describe(i, running)))
  })
  ipcMain.handle('installs:addPortable', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose the portable OBS folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    const got = portableInstall(host, r.filePaths[0])
    if ('error' in got) return { error: got.error }
    const s = loadSettings()
    if (!s.customInstalls.some((c) => c.id === got.id)) { s.customInstalls.push(got); saveSettings(s) }
    return { added: await describe(got, await obsRunning()) }
  })
  ipcMain.handle('installs:remove', (_e, id: string) => {
    const s = loadSettings()
    s.customInstalls = s.customInstalls.filter((c) => c.id !== id)
    saveSettings(s)
  })
  ipcMain.handle('installs:openFolder', async (_e, id: string) => { await shell.openPath(findInstall(id).configDir) })

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
      conflict: r.conflict, activate: r.activate, preferPipewire: r.preferPipewire, obsRunning: await obsRunning(),
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
        host, install, name: r.name, collections: r.collections, profiles: r.profiles, appVersion: app.getVersion(),
        bundleBelowBytes: r.media === 'all' ? Infinity : r.media === 'none' ? 0 : undefined,
      })
      let out: string
      if (r.format === 'file') {
        const d = await dialog.showSaveDialog({
          title: 'Save the bundle', defaultPath: `${r.name.replace(/[\\/:*?"<>|]/g, '_')}.obsbundle`,
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
        assets: { bundled: m.assets.filter((a) => a.mode === 'bundled').length, external: m.assets.filter((a) => a.mode === 'external').length },
        secrets: m.variables.filter((v) => v.kind === 'secret').map((v) => v.name),
        plugins: m.plugins.map((p) => p.name),
        warnings: [],
      }
    } catch (e) { return { error: (e as Error).message } }
  })

  ipcMain.handle('repos:list', async () => Promise.all(loadSettings().repos.filter((r) => fs.existsSync(r.path)).map(repoInfo)))
  ipcMain.handle('repos:remove', (_e, p: string) => {
    const s = loadSettings(); s.repos = s.repos.filter((r) => r.path !== p); saveSettings(s)
  })
  ipcMain.handle('repos:setInstall', (_e, p: string, installId: string) => rememberRepo(p, installId))
  ipcMain.handle('repos:addExisting', async () => {
    if (!(await gitAvailable())) return { error: gitMissing }
    const r = await dialog.showOpenDialog({ title: 'Choose a config repository folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    const st = await repoStatus(r.filePaths[0])
    if (!st.isRepo) return { error: 'That folder is not a git repository (it must be the top folder of one).' }
    if (!st.hasManifest) return { error: 'That repository has no manifest.json, so it is not an OBS config bundle.' }
    rememberRepo(r.filePaths[0])
    return { added: await repoInfo({ path: r.filePaths[0] }) }
  })
  ipcMain.handle('repos:clone', async (_e, url: string) => {
    if (!(await gitAvailable())) return { error: gitMissing }
    const r = await dialog.showOpenDialog({ title: 'Choose an empty folder to clone into', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    try { await cloneRepo(url.trim(), r.filePaths[0]) } catch (e) { return { error: (e as Error).message } }
    if (!fs.existsSync(path.join(r.filePaths[0], 'manifest.json'))) return { error: 'Cloned, but it has no manifest.json: it is not an OBS config bundle.' }
    rememberRepo(r.filePaths[0])
    return { added: await repoInfo({ path: r.filePaths[0] }) }
  })
  ipcMain.handle('repos:create', async (_e, installId: string, name: string) => {
    if (!(await gitAvailable())) return { error: gitMissing }
    const r = await dialog.showOpenDialog({ title: 'Choose an empty folder for the new repository', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    if (fs.readdirSync(r.filePaths[0]).length) return { error: 'That folder is not empty.' }
    try {
      await initRepo(r.filePaths[0])
      const res = await captureLive({ host, install: findInstall(installId), dir: r.filePaths[0], name, appVersion: app.getVersion() })
      if (res.status === 'error') return { error: res.message }
    } catch (e) { return { error: (e as Error).message } }
    rememberRepo(r.filePaths[0], installId)
    return { added: await repoInfo({ path: r.filePaths[0], installId }) }
  })
  ipcMain.handle('repos:live', async (_e, p: string, installId: string) => {
    const r = await captureLive({ host, install: findInstall(installId), dir: p, dryRun: true })
    if (r.status === 'error') return { error: r.message }
    return { changed: r.status === 'changes' ? r.files : [] }
  })
  ipcMain.handle('repos:save', async (_e, p: string, installId: string, commitDirtyFirst: boolean) => {
    const r = await captureLive({
      host, install: findInstall(installId), dir: p, onDirty: commitDirtyFirst ? 'commit-first' : 'refuse', appVersion: app.getVersion(),
    })
    if (r.status === 'changes') return { status: 'unchanged' }
    return r
  })
  ipcMain.handle('repos:pull', (_e, p: string) => pullRepo(p))
  ipcMain.handle('repos:push', (_e, p: string) => pushRepo(p))
  ipcMain.handle('repos:log', (_e, p: string) => repoLog(p, 15))
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

  ipcMain.handle('secrets:load', (_e, id: string) => readSecrets()[id] ?? {})
  ipcMain.handle('secrets:save', (_e, id: string, values: Record<string, string>) => {
    if (!safeStorage.isEncryptionAvailable()) return false // never write secrets in the clear
    const all = readSecrets()
    all[id] = values
    fs.writeFileSync(secretsPath(), safeStorage.encryptString(JSON.stringify(all)))
    return true
  })

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url) // only web links, never file: or custom schemes
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 560, title: 'OBS Config Loader',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
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
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
