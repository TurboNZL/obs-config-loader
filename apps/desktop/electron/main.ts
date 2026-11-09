import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import {
  applyImport, assetNeeds, buildInstance, describeLaunch, findObsProcessesLinux, instancePaths, isInstallRunning, seedInstance, captureLive, cloneRepo, createRepoFromBundle, detectInstalls, detectLinuxPackageManager, exportBundle, getRemoteUrl,
  gitAvailable, gitInstallHelp, githubAuthGit, githubListRepos, githubOrgs, githubWhoAmI, initRepo, markSynced, planImport, portableInstall, publishToGithub,
  pullRepo, pushRepo, readBundle, readBundleDir, realHost, redact, repoLog, repoNameFromUrl, repoStatus, setRemote, validateRemoteUrl,
  writeBundleDir, writeBundleZip, GithubError, defaultGit, type Bundle, type GitRunner, type ObsInstall,
  assetBundlePath, attachSecrets, commitAll, fetchRepo, githubRenameRepo, githubRepoName, parseGithubUrl, pendingForObs, locateExtracted, onlineComparison, publicRemoteUrl, useOnlineVersion, serializeManifest, SOURCE_PLATFORMS, WEBSOCKET_FILE, standInOptions, sourceName, availableOn, detectVersions, listNames, obsHasLayout, obsHasOutput, renameLayoutInObs, renameOutputInObs,
  renamePreset, renameSceneLayout, renameOutputSetting, renameSceneOrSource, renameSourceInObs, RenameError,
  findRenamedAssets, missingFilesInObs, replacePathInObs, applyCloudSettings, applyExtras, buildPresetFile, extrasContent, keepBundleLocals, localMediaLocations, presetFiles, readExtras, stripSecrets, writeExtras, slug, MAX_UPLOAD_FILE,
  readLocalKeys, readLocalSettings, writeLocalKeys, writeLocalSettings, cloudSkippedPaths, writeExclude, LOCAL_DIR, EXTRAS_EXT, type LocalSettings,
  listPlatformSources, DEFAULT_PLATFORM_MAP, withIdentity, listAuthors, rewriteAuthor, discardNameChangeBackup, putFile, getFile, testStorage, objectKey, validateTarget, regionFromEndpoint, sha256OfFile, localMediaPath,
  type GitIdentity, type StorageTarget, type StorageKeys,
} from '@obs-config-loader/core'
import { Updates } from './updater'
import type { BundleSummary, ExportRequest, ExportResult, GithubState, ImportRequest, InstallInfo, Locations, PresetOverview, RepoInfo } from './api'

const host = realHost()
/** "12 MB", for words shown to a person. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}
/** The scripts that live in a folder with their other files, named by what they are and how many files come with them. */
function scriptFolderNames(m: Bundle['manifest']): string[] {
  return (m.projects ?? []).map((pr) => {
    const v = m.variables.find((x) => x.name === pr.variable)
    return `${v?.mustContain?.[0] ?? pr.files[0]}${pr.files.length > 1 ? ` (+${pr.files.length - 1} file${pr.files.length === 2 ? '' : 's'} beside it)` : ''}`
  })
}
/** Versions are asked for on every refresh of a summary; reading them once a minute per OBS is plenty. */
const versionsCache = new Map<string, { at: number; v: ReturnType<typeof detectVersions> }>()
function versionsOf(i: ObsInstall) {
  const hit = versionsCache.get(i.id)
  if (hit && Date.now() - hit.at < 60_000) return hit.v
  const v = detectVersions(i, host)
  versionsCache.set(i.id, { at: Date.now(), v })
  return v
}
/** Pictures, sounds and videos up to this size travel inside a file by themselves; bigger ones only when chosen. */
const SMALL_FILE = 5 * 1024 * 1024
const bundles = new Map<string, Bundle & { source: string }>()
let nextHandle = 1

// ── settings (user-added installs) ───────────────────────────────────────────
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
interface RepoEntry { path: string; installId?: string; /** `owner/name` on GitHub, when this preset was published or renamed from here. */ github?: string }
interface Settings {
  customInstalls: ObsInstall[]; repos: RepoEntry[]; customFrame?: boolean
  /** Where new presets are kept. Unset = the app's own folder under Documents. */
  presetsRoot?: string
  /** Remember stream keys on this computer (encrypted by the system keychain, never in a preset or online). Default on. */
  rememberKeys?: boolean
  /** Who saves are by. `github` (default): the signed-in GitHub account's name and private address. `custom`: what the person typed. Never written to anyone's git config. */
  identity?: { mode: 'github' | 'custom'; name?: string; email?: string }
  /** The signed-in GitHub account, remembered so it shows at once on the next start. No secret in it. */
  github?: { login: string; name: string; email: string }
  /** Where big files are kept (an S3-compatible bucket). The access keys are not here: they are in storage.bin, encrypted. */
  storage?: StorageTarget
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

/** Remember where this computer keeps each file a preset's scenes use (only those the preset knows, and that really exist). */
function rememberAssets(presetPath: string, found: { id: string; filename: string; path: string }[]) {
  try {
    const m = readBundleDir(presetPath).manifest
    const all = readLocations()
    const cur = all[m.id] ?? { assets: {}, variables: {} }
    for (const f of found) if (m.assets.some((a) => a.id === f.id && a.filename === f.filename) && fs.existsSync(f.path)) cur.assets[f.id] = f.path
    all[m.id] = cur
    writeLocations(all)
  } catch { /* the preset still works; the files are asked for instead */ }
}

/** Files renamed outside the app, found by their contents in the folder they were in. Uses where this computer REMEMBERS having each file (not the preset's own copy). */
async function renamedFiles(presetPath: string) {
  try {
    const m = readBundleDir(presetPath).manifest
    // also what the linked OBS's scenes point at that is not there any more: that works even when only the preset's own copy was remembered
    const linked = loadSettings().repos.find((r) => r.path === presetPath)?.installId
    const inst = linked ? allInstalls().find((i) => i.id === linked) : undefined
    return await findRenamedAssets(m, readLocations()[m.id]?.assets ?? {}, inst?.configExists ? missingFilesInObs(inst.configDir) : [])
  } catch { return [] }
}
/** A file that was renamed is still the same file: saving under its new name must keep its identity in the preset. */
async function assetHintsFor(presetPath: string): Promise<Record<string, string>> {
  const hints: Record<string, string> = {}
  try {
    const m = readBundleDir(presetPath).manifest
    for (const [id, p] of Object.entries(readLocations()[m.id]?.assets ?? {})) if (m.assets.some((a) => a.id === id)) hints[p] = id
    for (const r of await renamedFiles(presetPath)) hints[r.to] = r.id
  } catch { /* no hints: files are named by their names, as before */ }
  return hints
}

// ── config repositories ──────────────────────────────────────────────────────
async function repoInfo(e: RepoEntry): Promise<RepoInfo> {
  const git = gitRunner()
  const status = await repoStatus(e.path, git)
  const remoteUrl = status.remote ? await getRemoteUrl(e.path, git) : undefined
  // what it is called on GitHub (and a link, for the real github.com)
  const full = e.github ?? (remoteUrl ? (() => { const g = parseGithubUrl(remoteUrl); return g ? `${g.owner}/${g.repo}` : undefined })() : undefined)
  const online = remoteUrl ? { name: full ? full.split('/')[1] : path.basename(remoteUrl).replace(/\.git$/, ''), ...(full && /github\.com/i.test(remoteUrl) ? { url: `https://github.com/${full}` } : {}) } : undefined
  return { path: e.path, name: status.manifest?.name ?? path.basename(e.path), installId: e.installId, status, remoteUrl, ...(online ? { online } : {}) }
}
function rememberGithub(p: string, fullName: string) {
  const s = loadSettings()
  const hit = s.repos.find((r) => r.path === p)
  if (hit) hit.github = fullName; else s.repos.push({ path: p, github: fullName })
  saveSettings(s)
}
/** `installId`: link the preset to this OBS; `null`: unlink it (the preset stays exactly as it is); left out: keep the link as it is. */
function rememberRepo(p: string, installId?: string | null) {
  const s = loadSettings()
  const hit = s.repos.find((r) => r.path === p)
  if (hit) { if (installId) hit.installId = installId; else if (installId === null) delete hit.installId } else s.repos.push({ path: p, ...(installId ? { installId } : {}) })
  saveSettings(s)
}
/** A preset this computer already has for the same setup (same id), if any. */
function presetFor(id: string): RepoEntry | undefined {
  return loadSettings().repos.find((r) => {
    try { return fs.existsSync(r.path) && readBundleDir(r.path, { keepMissing: true }).manifest.id === id } catch { return false }
  })
}
/** Where this computer has each file of a setup: what was remembered, then the preset's own copies. */
function locationsFor(id: string): Locations {
  const cur = readLocations()[id] ?? { assets: {}, variables: {} }
  const hit = presetFor(id)
  if (!hit) return cur
  let own: Record<string, string> = {}
  try { own = localMediaLocations(hit.path, readBundleDir(hit.path).manifest) } catch { /* not readable: nothing to add */ }
  return { ...cur, assets: { ...own, ...Object.fromEntries(Object.entries(cur.assets).filter(([, f]) => fs.existsSync(f))) } }
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
function gitRunner(presetPath?: string): GitRunner {
  const base = githubAuthGit(loadGithubToken(), defaultGit)
  // who a save is by: decided per call from where git runs, so a preset with its own name keeps it
  return (args, cwd, env) => withIdentity(base, identityFor(presetPath ?? cwd))(args, cwd, env)
}
/** The app-wide choice: what was typed, else the GitHub account, else nothing (this computer's own git name is used, as before). */
function appIdentity(): GitIdentity | undefined {
  const s = loadSettings()
  if (s.identity?.mode === 'custom' && s.identity.name?.trim() && s.identity.email?.trim()) return { name: s.identity.name.trim(), email: s.identity.email.trim() }
  if (loadGithubToken() && s.github) return { name: s.github.name, email: s.github.email }
  return undefined
}
/** A preset's own choice wins over the app-wide one. `where` is a preset folder or a folder inside one. */
function identityFor(where: string): GitIdentity | undefined {
  try {
    const hit = loadSettings().repos.find((r) => where === r.path || where.startsWith(r.path + path.sep))
    const own = hit ? readLocalSettings(hit.path).author : undefined
    if (own?.name?.trim() && own.email?.trim()) return own
  } catch { /* the app-wide choice */ }
  return appIdentity()
}
const noGit = () => !!process.env.OBSCL_FAKE_NO_GIT // lets tests show the "install git" screen
let gitSeen = 0
/** Starting git is slow on some systems; once it has been found, it is not asked again for a minute. */
const hasGit = async () => {
  if (noGit()) return false
  if (Date.now() - gitSeen < 60_000) return true
  const ok = await gitAvailable()
  if (ok) gitSeen = Date.now()
  return ok
}
const gitMissing = 'Git is not installed. Open the Git repositories page: it can install it for you.'
const errText = (e: unknown) => redact((e as Error).message, loadGithubToken())

/** A folder name for a new repository under Documents, never one that already has something in it. */
/**
 * The app's own folder for presets, in the place each system keeps an app's own data (not Documents):
 * Linux ~/.local/share/obs-config-loader/presets, Windows %LOCALAPPDATA%\OBS Config Loader\Presets, macOS ~/Library/Application Support/OBS Config Loader/Presets.
 */
function defaultPresetsRoot(): string {
  if (process.platform === 'linux') return path.join(process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share'), 'obs-config-loader', 'presets')
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'OBS Config Loader', 'Presets')
  return path.join(app.getPath('appData'), 'OBS Config Loader', 'Presets')
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

/** New presets keep stream keys inside themselves (on this computer only) unless the person turned that off in Settings. */
const keepKeysDefault = () => loadSettings().rememberKeys !== false
/** Older versions remembered keys in the system keychain, per setup id. A preset that has none of its own picks them up once. */
function adoptLegacyKeys(presetPath: string): void {
  try {
    if (Object.keys(readLocalKeys(presetPath)).length) return
    const old = readSecrets()[readBundleDir(presetPath, { keepMissing: true }).manifest.id]
    if (old && Object.keys(old).length) writeLocalKeys(presetPath, old)
  } catch { /* nothing to adopt */ }
}

// ── updates (electron-updater from the project's GitHub releases) ──
const updates = new Updates(app.isPackaged, (st) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('updates:state', st)
})


// ── big-file storage: an S3-compatible bucket (Backblaze B2, Cloudflare R2, …). Its access keys are kept like the GitHub token ──
let storageKeysMem: StorageKeys | undefined
let storageSessionOnly = false
const storageKeysPath = () => path.join(app.getPath('userData'), 'storage.bin')
function loadStorageKeys(): StorageKeys | undefined {
  if (storageKeysMem) return storageKeysMem
  try { storageKeysMem = JSON.parse(safeStorage.decryptString(fs.readFileSync(storageKeysPath()))) } catch { /* none saved */ }
  return storageKeysMem
}
/** Is the storage a preset uses the one this computer has keys for? */
function storageReady(t?: StorageTarget): boolean {
  const mine = loadSettings().storage
  return !!mine && !!loadStorageKeys() && (!t || (mine.endpoint === t.endpoint && mine.bucket === t.bucket))
}
const storageError = (e: unknown) => redactKeys((e as Error).message)
function redactKeys(text: string): string {
  const k = loadStorageKeys()
  return k ? text.split(k.secretAccessKey).join('***').split(k.accessKeyId).join('***') : text
}
function sendStorageProgress(id: string, filename: string, done: number, total: number) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('storage:progress', { id, filename, done, total })
}

// ── keeping the app quick ────────────────────────────────────────────────────
// Reading a preset's state (diff against OBS, sizes, asking GitHub) is slow, and every tile on a page asks at once. Heavy
// questions are answered one at a time (the window stays alive in between), the same question asked twice shares one answer,
// and an answer is reused for a short while until something is changed.
let diskChain: Promise<unknown> = Promise.resolve()
let netLanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()]
const later = <T,>(fn: () => Promise<T> | T) => new Promise<T>((res, rej) => setImmediate(() => { Promise.resolve().then(fn).then(res, rej) }))
/** Work that reads many files runs one at a time. */
function heavy<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = diskChain.then(() => later(fn))
  diskChain = run.catch(() => undefined)
  return run
}
/** Work that waits for the internet runs two at a time. */
let nextLane = 0
function online<T>(fn: () => Promise<T> | T): Promise<T> {
  const k = nextLane; nextLane = 1 - nextLane
  const run = netLanes[k].then(() => later(fn))
  netLanes[k] = run.catch(() => undefined)
  return run
}
const memo = new Map<string, { at: number; v: Promise<unknown> }>()
function memoised<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as Promise<T>
  const v = fn()
  memo.set(key, { at: Date.now(), v })
  v.catch(() => { if (memo.get(key)?.v === v) memo.delete(key) })
  return v
}
const READ_ONLY = new Set(['installs:list', 'repos:list', 'repos:live', 'repos:needs', 'repos:renamed', 'repos:log', 'repos:compare', 'repos:check', 'presets:overview', 'presets:details', 'presets:authors', 'presets:keys', 'presets:scanFile', 'presets:extrasInfo', 'obs:scan', 'git:state', 'github:state', 'github:repos', 'github:orgs', 'settings:get', 'identity:get', 'storage:state', 'app:version', 'locations:load', 'secrets:load', 'updates:state'])

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  /** Reading never changes anything, so it keeps the quick answers; anything else makes them stale, before and after. */
  const handle: typeof ipcMain.handle = (channel, fn) => ipcMain.handle(channel, async (e, ...a) => {
    if (!READ_ONLY.has(channel)) memo.clear()
    try { return await fn(e, ...a) } finally { if (!READ_ONLY.has(channel)) memo.clear() }
  })
  handle('installs:list', async () => {
    const all = allInstalls()
    const running = await runningMap(all)
    return Promise.all(all.map((i) => describe(i, running.get(i.id) ?? false)))
  })
  handle('installs:addPortable', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose the portable OBS folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { cancelled: true }
    const got = portableInstall(host, r.filePaths[0])
    if ('error' in got) return { error: got.error }
    const s = loadSettings()
    if (!s.customInstalls.some((c) => c.id === got.id)) { s.customInstalls.push(got); saveSettings(s) }
    return { added: await describe(got, await obsRunningFor(got)) }
  })
  handle('installs:remove', (_e, id: string) => {
    const s = loadSettings()
    s.customInstalls = s.customInstalls.filter((c) => c.id !== id)
    saveSettings(s)
  })
  handle('installs:openFolder', async (_e, id: string) => { await shell.openPath(findInstall(id).configDir) })

  // ── starting OBS, and separate OBS instances ──
  handle('installs:launch', async (_e, id: string) => {
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
  handle('installs:verify', (_e, id: string, since: number) => {
    const i = findInstall(id)
    // Copied settings are there before OBS ever runs, so "the folder exists" proves nothing. OBS writes a new log file into
    // the folder it really uses every time it starts, and rewrites global.ini: look for something newer than the start.
    const fresh = (p: string) => { try { return fs.statSync(p).mtimeMs >= since - 2000 } catch { return false } }
    const logs = path.join(i.configDir, 'logs')
    let newLog = false
    try { newLog = fs.readdirSync(logs).some((f) => fresh(path.join(logs, f))) } catch { /* no logs folder yet */ }
    return { usesOwnSettings: newLog || fresh(path.join(i.configDir, 'global.ini')) }
  })

  handle('instances:support', (_e, baseId: string, name?: string) => instancePaths(findInstall(baseId), host, name || 'new'))
  handle('instances:create', async (_e, r: { baseId: string; name: string; copySettings: boolean }) => {
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
  handle('instances:remove', (_e, id: string, deleteFiles: boolean) => {
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
  handle('instances:openPlugins', async (_e, id: string) => {
    const i = findInstall(id)
    const dir = i.pluginDirs[0]
    if (dir) { fs.mkdirSync(dir, { recursive: true }); await shell.openPath(dir) }
  })

  handle('bundle:open', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Open an OBS config bundle',
      properties: ['openFile'],
      filters: [{ name: 'OBS config bundle', extensions: ['obsbundle', 'zip'] }],
    })
    return r.canceled || !r.filePaths[0] ? null : openBundlePath(r.filePaths[0])
  })
  handle('bundle:openFolder', async () => {
    const r = await dialog.showOpenDialog({ title: 'Open a config bundle folder', properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : openBundlePath(r.filePaths[0])
  })
  handle('bundle:openPath', (_e, p: string) => openBundlePath(p))

  const importOpts = async (r: ImportRequest) => {
    const b = bundles.get(r.handle)
    if (!b) throw new Error('That bundle is no longer open. Open it again.')
    return {
      bundle: b, install: findInstall(r.installId), host,
      collections: r.collections, profiles: r.profiles, variables: r.variables, assetFiles: r.assetFiles,
      conflict: r.conflict, activate: r.activate, preferPipewire: r.preferPipewire, obsRunning: await obsRunningFor(findInstall(r.installId)),
      installed: versionsOf(findInstall(r.installId)), websocket: r.websocket, sourceChoices: r.sourceChoices,
    }
  }
  handle('import:plan', async (_e, r: ImportRequest) => planImport(await importOpts(r)).report)
  handle('import:apply', async (_e, r: ImportRequest) => {
    const opts = await importOpts(r)
    const plan = planImport(opts)
    const res = applyImport(plan)
    {
      const all = readLocations(); const id = opts.bundle.manifest.id
      const cur = all[id] ?? { assets: {}, variables: {} }
      all[id] = { ...cur, assets: { ...cur.assets, ...plan.report.assetLocations } }
      writeLocations(all)
    }
    // Loaded from a repository: OBS now matches its current state, so later live edits are measured from here.
    if (fs.existsSync(path.join(opts.bundle.source, '.git'))) await markSynced(opts.bundle.source, opts.install)
    return { written: res.written.length, backedUp: res.backedUp.length, backupDir: res.backupDir }
  })

  handle('export:run', async (_e, r: ExportRequest): Promise<ExportResult | { error: string } | null> => {
    try {
      const install = findInstall(r.installId)
      const bundle = exportBundle({
        host, install, name: r.name, collections: r.collections, profiles: r.profiles, appVersion: app.getVersion(), versions: detectVersions(install, host), includeSecrets: r.includeKeys === true && (r.format ?? 'file') === 'file',
        bundleBelowBytes: r.media === 'all' ? Infinity : r.media === 'none' ? 0 : undefined,
        alsoBundle: r.alsoBundle, exclude: r.exclude, repository: r.repository,
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

  handle('git:state', async () => ({
    available: await hasGit(), platform: process.platform,
    help: gitInstallHelp(host.platform, host.platform === 'linux' ? detectLinuxPackageManager() : undefined),
  }))
  handle('git:install', async () => {
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

  handle('github:state', (): GithubState => ({ connected: !!loadGithubToken(), login: githubLogin ?? loadSettings().github?.login, sessionOnly: githubSessionOnly || undefined }))
  handle('github:connect', async (_e, token: string) => {
    const t = token.trim()
    if (!t) return { ok: false, error: 'Paste the token first.' }
    try {
      const who = await githubWhoAmI(t)
      githubTokenMem = t; githubLogin = who.login
      { const st = loadSettings(); st.github = { login: who.login, name: who.name, email: who.email }; saveSettings(st) }
      if (safeStorage.isEncryptionAvailable()) { fs.writeFileSync(githubPath(), safeStorage.encryptString(t)); githubSessionOnly = false }
      else githubSessionOnly = true // no keychain: never write it in the clear
      return { ok: true, login: who.login, sessionOnly: githubSessionOnly }
    } catch (e) { return { ok: false, error: errText(e) } }
  })
  handle('github:disconnect', () => {
    githubTokenMem = undefined; githubLogin = undefined; githubSessionOnly = false
    { const st = loadSettings(); delete st.github; saveSettings(st) }
    try { fs.rmSync(githubPath()) } catch { /* nothing saved */ }
  })
  handle('github:repos', async () => {
    const t = loadGithubToken()
    if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
    try { return { ok: true, repos: await githubListRepos(t) } } catch (e) { return { ok: false, error: errText(e) } }
  })

  handle('github:orgs', async () => {
    const t = loadGithubToken()
    if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
    try { return { ok: true, orgs: await githubOrgs(t) } } catch (e) { return { ok: false, error: errText(e) } }
  })

  handle('repos:list', () => memoised('list', 3_000, () => Promise.all(loadSettings().repos.filter((r) => fs.existsSync(r.path)).map(repoInfo))))
  handle('repos:suggestFolder', (_e, name: string) => suggestFolder(name))
  handle('repos:remove', (_e, p: string) => {
    const s = loadSettings(); s.repos = s.repos.filter((r) => r.path !== p); saveSettings(s)
  })
  handle('repos:openFolder', async (_e, p: string) => { await shell.openPath(p) })
  handle('repos:setInstall', (_e, p: string, installId: string | null) => rememberRepo(p, installId))

  handle('repos:addExisting', async () => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const r = await dialog.showOpenDialog({ title: 'Choose a config repository folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true, error: '' }
    const st = await repoStatus(r.filePaths[0], gitRunner())
    if (!st.isRepo) return { ok: false, error: 'That folder is not a git repository (it must be the top folder of one).' }
    if (!st.hasManifest) return { ok: false, error: 'That repository has no manifest.json, so it is not an OBS config bundle.' }
    rememberRepo(r.filePaths[0])
    return { ok: true, repo: await repoInfo({ path: r.filePaths[0] }) }
  })

  handle('repos:clone', async (_e, url: string, folder: string) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const v = validateRemoteUrl(url)
    if (!v.ok) return { ok: false, error: v.message }
    if (!emptyOrMissing(folder)) return { ok: false, error: 'That folder is not empty. Choose another one.' }
    try { await cloneRepoWith(v.url, folder) } catch (e) { return { ok: false, error: errText(e) } }
    if (!fs.existsSync(path.join(folder, 'manifest.json'))) return { ok: false, error: 'It was downloaded, but it has no manifest.json: it is not an OBS config repository.' }
    rememberRepo(folder)
    return { ok: true, repo: await repoInfo({ path: folder }) }
  })

  handle('repos:create', async (_e, r: { installId: string; name: string; folder: string; github?: { private: boolean; org?: string }; exclude?: ExportRequest['exclude']; link?: boolean; cloudSkip?: { layouts?: string[]; outputs?: string[]; scripts?: boolean; remoteControl?: boolean } }) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    if (!emptyOrMissing(r.folder)) return { ok: false, error: 'That folder is not empty. Choose another one.' }
    try {
      const git = gitRunner()
      await initRepo(r.folder, git)
      const inst = findInstall(r.installId)
      const seen: { id: string; filename: string; path: string }[] = []
      // what is not uploaded is chosen before the first save, so it never goes up even once (names here, ids as OBS files are named)
      if (r.cloudSkip && (r.cloudSkip.layouts?.length || r.cloudSkip.outputs?.length || r.cloudSkip.scripts || r.cloudSkip.remoteControl)) {
        writeLocalSettings(r.folder, { cloud: { skip: { ...r.cloudSkip, layouts: (r.cloudSkip.layouts ?? []).map((n) => slug(n)), outputs: (r.cloudSkip.outputs ?? []).map((n) => slug(n)) } } })
      }
      const res = await captureLive({ host, install: inst, dir: r.folder, name: r.name, appVersion: app.getVersion(), versions: detectVersions(inst, host), exclude: r.exclude, onAsset: (a) => seen.push(a), keepKeysDefault: keepKeysDefault(), git })
      if (res.status === 'error') return { ok: false, error: res.message }
      rememberAssets(r.folder, seen)
      rememberRepo(r.folder, r.link === false ? undefined : r.installId)
      let published: string | undefined
      if (r.github) {
        const t = loadGithubToken()
        if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
        try {
          const out = await publishToGithub(r.folder, t, r.name, { private: r.github.private, org: r.github.org })
          rememberGithub(r.folder, out.repo.fullName)
          published = out.repo.htmlUrl
          if (out.push.status === 'error') return { ok: false, error: `Created on GitHub, but pushing failed: ${out.push.message}` }
        } catch (e) { return { ok: false, error: `The repository was created on this computer, but not on GitHub: ${errText(e)}` } }
      }
      const info = await repoInfo({ path: r.folder, ...(r.link === false ? {} : { installId: r.installId }) })
      return { ok: true, repo: info, published, remoteUrl: info.remoteUrl ? publicRemoteUrl(info.remoteUrl) : undefined }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  /**
   * Make a preset out of an opened setup file: its stream keys and files go into the preset's own area, never into git.
   * A file that knows where its preset lives online (`latest`) gets the latest version from there first; if that cannot be reached,
   * the preset is made from the file and pointed at that address, so "Get updates" can combine them later.
   */
  const presetFromBundle = async (b: Bundle & { source?: string }, folder: string, installId?: string, latest = false) => {
    // the address is how the file finds its preset; inside the preset folder it is the remote instead
    const url = b.manifest.repository?.url
    const { repository: _r, ...manifest } = b.manifest
    void _r
    const copy: Bundle = { manifest: { ...manifest, variables: manifest.variables.map((v) => ({ ...v })) } as Bundle['manifest'], files: new Map(b.files) }
    const secrets = b.manifest.containsSecrets === true ? stripSecrets(copy) : {}
    let fromOnline = false
    if (latest && url) {
      try { await cloneRepoWith(url, folder); fromOnline = true } catch { fs.rmSync(folder, { recursive: true, force: true }) }
    }
    if (!fromOnline) {
      await createRepoFromBundle(folder, copy, gitRunner())
      if (url) { try { await setRemote(folder, url, gitRunner()) } catch { /* the preset still works without it */ } }
    }
    const kept = keepBundleLocals(folder, copy, secrets)
    rememberRepo(folder, installId)
    // the folder holds exactly what was just loaded into OBS: later changes are measured from here
    if (installId) { try { await markSynced(folder, findInstall(installId), gitRunner()) } catch { /* not worth failing for */ } }
    return { kept, url, fromOnline }
  }
  handle('repos:fromBundle', async (_e, handle: string, folder: string, installId?: string) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const b = bundles.get(handle)
    if (!b) return { ok: false, error: 'That bundle is no longer open. Open it again.' }
    try { await presetFromBundle(b, folder, installId) } catch (e) { return { ok: false, error: errText(e) } }
    return { ok: true, repo: await repoInfo({ path: folder, ...(installId ? { installId } : {}) }) }
  })

  /** "Import a file": a setup file becomes a preset in the presets folder; an extras file goes into the preset it belongs with. */
  handle('presets:importFile', async (_e, file?: string) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    let p = file
    if (!p) {
      const r = await dialog.showOpenDialog({
        title: 'Import a setup file', properties: ['openFile'],
        filters: [{ name: 'OBS setup file', extensions: ['obsbundle', 'zip', EXTRAS_EXT] }],
      })
      if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true, error: '' }
      p = r.filePaths[0]
    }
    try {
      if (p.toLowerCase().endsWith('.' + EXTRAS_EXT)) {
        const x = await readExtras(p)
        const hit = presetFor(x.manifest.presetId)
        if (!hit) return { ok: false, error: `This extras file belongs with a preset called “${x.manifest.presetName}”, which is not on this computer. Download that preset from GitHub first, then import this file again.` }
        const done = await applyExtras(hit.path, x)
        return { ok: true, kind: 'extras' as const, repo: await repoInfo(hit), applied: done }
      }
      const b = await readBundle(p)
      const have = presetFor(b.manifest.id)
      if (have) return { ok: true, kind: 'existing' as const, repo: await repoInfo(have), name: b.manifest.name }
      const folder = suggestFolder(b.manifest.name)
      const made = await presetFromBundle(b, folder, undefined, true)
      return { ok: true, kind: 'preset' as const, repo: await repoInfo({ path: folder }), keys: made.kept.keys, files: made.kept.media, online: !!made.url, latest: made.fromOnline }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  handle('bundle:existing', async (_e, handle: string) => {
    const b = bundles.get(handle)
    const hit = b && presetFor(b.manifest.id)
    return hit ? repoInfo(hit) : null
  })
  /** A file that knows its online address: the latest version from there (get updates if we have the preset, else download it). */
  handle('bundle:latest', async (_e, handle: string) => {
    if (!(await hasGit())) return { ok: false, error: gitMissing }
    const b = bundles.get(handle)
    if (!b) return { ok: false, error: 'That file is no longer open. Open it again.' }
    const have = presetFor(b.manifest.id)
    const git = gitRunner()
    try {
      if (have) {
        const r = await pullRepo(have.path, git)
        if (r.status === 'conflict') return { ok: false, error: 'Your preset and the online copy changed the same part. Open Presets to choose which to keep.' }
        if (r.status === 'dirty') return { ok: false, error: 'Your preset has changes that are not saved yet. Open Presets and save them first.' }
        if (r.status === 'error') return { ok: false, error: r.message }
        return { ok: true, path: have.path, how: r.status === 'updated' ? 'updated' : 'up-to-date' }
      }
      const url = b.manifest.repository?.url
      if (!url) return { ok: false, error: 'This file does not say where it is kept online.' }
      const v = validateRemoteUrl(url)
      if (!v.ok) return { ok: false, error: v.message }
      const folder = suggestFolder(b.manifest.name)
      try { await cloneRepoWith(v.url, folder) } catch (e) {
        const t = errText(e)
        return { ok: false, error: /auth|denied|403|404|not found|could not read|Invalid username/i.test(t) ? 'Could not download it. If it is private, sign in to GitHub in Settings first, then try again.' : t }
      }
      if (!fs.existsSync(path.join(folder, 'manifest.json'))) return { ok: false, error: 'It was downloaded, but it is not an OBS setup.' }
      if (readBundleDir(folder).manifest.id !== b.manifest.id) { fs.rmSync(folder, { recursive: true, force: true }); return { ok: false, error: 'The online copy is a different setup from this file, so it was not used.' } }
      rememberRepo(folder)
      return { ok: true, path: folder, how: 'downloaded' }
    } catch (e) { return { ok: false, error: errText(e) } }
  })
  /** Ask the online copy what is new, so "N to download" is true. */
  handle('repos:check', (_e, p: string) => memoised(`check|${p}`, 60_000, () => online(async () => {
    const git = gitRunner(p)
    const r = await fetchRepo(p, git)
    return { ok: r.ok, message: r.message, repo: await repoInfo({ path: p, installId: loadSettings().repos.find((x) => x.path === p)?.installId }) }
  })))

  handle('repos:setRemote', async (_e, p: string, url: string) => {
    const r = await setRemote(p, url, gitRunner())
    return r.ok ? { ok: true } : { ok: false, error: r.message }
  })
  handle('repos:publish', async (_e, p: string, name: string, priv: boolean, org?: string, replace?: boolean) => {
    const t = loadGithubToken()
    if (!t) return { ok: false, error: 'Connect your GitHub account first.' }
    try {
      const out = await publishToGithub(p, t, name, { private: priv, org, replaceExisting: replace === true })
      rememberGithub(p, out.repo.fullName)
      if (out.push.status === 'error') return { ok: false, error: `Created on GitHub, but pushing failed: ${out.push.message}` }
      return { ok: true, url: out.repo.htmlUrl, pushed: out.push.status === 'pushed' }
    } catch (e) { return { ok: false, error: e instanceof GithubError ? errText(e) : errText(e) } }
  })

  handle('repos:live', (_e, p: string, installId: string, withDiff?: boolean) => memoised(`live|${p}|${installId}|${withDiff === true}`, 30_000, () => heavy(async () => {
    const inst = findInstall(installId)
    const r = await captureLive({ host, install: inst, dir: p, dryRun: true, withDiff: withDiff === true, keepKeysDefault: keepKeysDefault(), git: gitRunner(p), assetIdHints: await assetHintsFor(p) })
    if (r.status === 'error') return { error: r.message }
    // and the other direction: what the preset has that this OBS has not got yet (typically after getting updates)
    return { changed: r.status === 'changes' ? r.files : [], details: r.status === 'changes' ? r.details : undefined, pending: await pendingForObs(p, inst, gitRunner(p)) }
  })))
  handle('repos:save', async (_e, p: string, installId: string, commitDirtyFirst: boolean, onConflict?: 'abort' | 'keep-repo' | 'keep-obs') => {
    const inst = findInstall(installId)
    const seen: { id: string; filename: string; path: string }[] = []
    const r = await captureLive({
      host, install: inst, dir: p, onDirty: commitDirtyFirst ? 'commit-first' : 'refuse', onConflict,
      appVersion: app.getVersion(), versions: detectVersions(inst, host), onAsset: (a) => seen.push(a), keepKeysDefault: keepKeysDefault(), git: gitRunner(p), assetIdHints: await assetHintsFor(p),
    })
    rememberAssets(p, seen)
    if (r.status === 'changes') return { status: 'unchanged' }
    if (r.status === 'committed' || r.status === 'unchanged') {
      const keys = r.status === 'committed' ? r.keys ?? 0 : 0
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
  handle('repos:pull', (_e, p: string, onConflict?: 'abort' | 'keep-mine' | 'keep-theirs') => pullRepo(p, gitRunner(), onConflict))
  handle('repos:push', (_e, p: string, force?: boolean) => pushRepo(p, gitRunner(), { force: force === true }))
  /** How this computer's copy and the online one relate: ask GitHub first, then compare. */
  handle('repos:compare', (_e, p: string) => memoised(`compare|${p}`, 60_000, () => online(async () => {
    const git = gitRunner(p)
    await fetchRepo(p, git)
    return onlineComparison(p, git)
  })))
  handle('repos:useOnline', async (_e, p: string) => {
    const git = gitRunner()
    const r = await useOnlineVersion(p, git)
    return r.ok ? { ok: true, kept: r.kept } : { ok: false, error: r.message }
  })
  handle('repos:log', (_e, p: string) => repoLog(p, 15, gitRunner()))
  handle('repos:renamed', (_e, p: string) => memoised(`renamed|${p}`, 15_000, () => heavy(() => renamedFiles(p))))
  /** "Use the new name": remember where the file is now and, when OBS is closed, point OBS's scenes at it. */
  handle('repos:acceptRename', async (_e, p: string, id: string, to: string, installId?: string) => {
    try {
      const m = readBundleDir(p).manifest
      const hit = (await renamedFiles(p)).find((r) => r.id === id && r.to === to)
      if (!hit) return { ok: false, error: 'That file is not where it was seen a moment ago. Look again.' }
      const all = readLocations(); const cur = all[m.id] ?? { assets: {}, variables: {} }
      cur.assets[id] = hit.to; all[m.id] = cur; writeLocations(all)
      let fixedInObs = 0; let obsRunning = false
      const inst = installId ? allInstalls().find((i) => i.id === installId) : undefined
      if (inst?.configExists) {
        if (await obsRunningFor(inst)) obsRunning = true
        else fixedInObs = replacePathInObs(inst.configDir, hit.from, hit.to)
      }
      return { ok: true, fixedInObs, obsRunning }
    } catch (e) { return { ok: false, error: errText(e) } }
  })
  handle('repos:needs', (_e, p: string) => memoised(`needs|${p}`, 30_000, () => heavy(async () => {
    const m = readBundleDir(p).manifest
    const all = readLocations()
    const cur = locationsFor(m.id)
    // files that came with a setup file are already here (in OBS's own folder): do not ask for them
    const here = locateExtracted(m, allInstalls().map((i) => i.configDir))
    const remembered = all[m.id] ?? { assets: {}, variables: {} }
    for (const [id, f] of Object.entries(here)) if (!cur.assets[id] || !fs.existsSync(cur.assets[id])) { cur.assets[id] = f; remembered.assets[id] = f }
    // only what was really learned is remembered: the preset's own copies are not where the file lives, and must not replace its real place
    all[m.id] = remembered; writeLocations(all)
    return assetNeeds(m, cur.assets)
  })))
  handle('repos:setAsset', (_e, p: string, assetId: string, file: string) => {
    const m = readBundleDir(p).manifest
    const all = readLocations()
    const cur = all[m.id] ?? { assets: {}, variables: {} }
    cur.assets[assetId] = file
    all[m.id] = cur
    writeLocations(all)
  })
  handle('locations:load', (_e, id: string) => locationsFor(id))
  handle('locations:save', (_e, id: string, l: Locations) => {
    // merged, never replaced: what import and save learned about where the files are must not be wiped by a screen that knows less
    const all = readLocations(); const cur = all[id] ?? { assets: {}, variables: {} }
    all[id] = { assets: { ...cur.assets, ...l.assets }, variables: l.variables }
    writeLocations(all)
  })

  handle('files:pick', async (_e, title: string, folder?: boolean) => {
    const r = await dialog.showOpenDialog({ title, properties: [folder ? 'openDirectory' : 'openFile'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  handle('files:reveal', (_e, p: string) => { shell.showItemInFolder(p) })

  // answers typed when loading a setup: kept in the preset made from it (this computer only); the keychain is only for setups with no preset
  handle('secrets:load', (_e, id: string) => {
    const hit = presetFor(id)
    if (hit) adoptLegacyKeys(hit.path)
    return { ...readSecrets()[id], ...(hit ? readLocalKeys(hit.path) : {}) }
  })
  handle('secrets:save', (_e, id: string, values: Record<string, string>) => {
    const hit = presetFor(id)
    if (hit && readLocalSettings(hit.path).keepKeys !== false && keepKeysDefault()) { writeLocalKeys(hit.path, values); return true }
    const all = readSecrets()
    all[id] = values
    return writeSecrets(all)
  })

  // ── settings ──
  handle('settings:get', () => {
    const s = loadSettings()
    return {
      presetsRoot: presetsRoot(), defaultPresetsRoot: defaultPresetsRoot(), isDefault: !s.presetsRoot,
      rememberKeys: s.rememberKeys !== false, canStoreKeys: true,
    }
  })
  handle('settings:setPresetsRoot', (_e, p: string | null) => {
    const s = loadSettings()
    if (p) s.presetsRoot = p; else delete s.presetsRoot
    saveSettings(s)
  })
  handle('settings:setRememberKeys', (_e, on: boolean) => {
    const s = loadSettings(); s.rememberKeys = on === true; saveSettings(s)
  })

  // ── presets (a preset is one of the saved setup folders) ──
  handle('presets:keys', (_e, p: string) => {
    adoptLegacyKeys(p)
    return { count: Object.keys(readLocalKeys(p)).length, canStore: true }
  })
  handle('presets:details', (_e, p: string) => {
    const b = readBundleDir(p)
    const m = b.manifest
    const overrides = m.platformOverrides ?? {}
    const platforms: ('win32' | 'darwin' | 'linux')[] = ['win32', 'darwin', 'linux']
    const label = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
    /** For one kind of source: on each system it does not exist on, what it becomes by default and what is chosen. `own`: the saved choices (for the kind, or for one source). */
    const targetsOf = (from: string, to: Record<string, string | undefined>, own: Partial<Record<string, string | null>> | undefined) =>
      platforms.filter((pl) => !availableOn(from, pl)).map((pl) => {
        const def = pl === 'linux' ? (to['linux-pipewire'] ?? to.linux) : to[pl]
        const has = own && (pl === 'linux' ? 'linux' in own || 'linux-pipewire' in own : pl in own)
        const val = has ? (pl === 'linux' ? (own!.linux ?? own!['linux-pipewire'] ?? null) : own![pl] ?? null) : undefined
        return { platform: pl, label: label[pl], default: def ?? null, defaultName: def ? sourceName(def) : null, chosen: val === undefined ? undefined : val, options: standInOptions(from, pl).map((id) => ({ id, name: sourceName(id) })) }
      })
    return {
      savedWithObs: m.savedWithObs as string | undefined,
      plugins: m.plugins.map((x) => ({ name: x.name, version: x.version, known: !x.id.startsWith('unknown:') })),
      scripts: [...m.assets.filter((a) => a.role === 'script').map((a) => a.filename), ...scriptFolderNames(m)],
      remoteControl: b.files.has(WEBSOCKET_FILE),
      layouts: m.collections.map((c) => ({ id: c.id, name: c.name, ...listNames(p, c.id) })),
      outputs: m.profiles.map((x) => ({ id: x.id, name: x.name })),
      exclude: m.exclude ?? {},
      translations: m.platformMap.filter((e) => SOURCE_PLATFORMS[e.from]).map((e) => ({ from: e.from, name: sourceName(e.from), targets: targetsOf(e.from, e.to, overrides[e.from]) })),
      // and the same per source, for when two sources of one kind should not be treated alike
      sourceTranslations: m.collections.flatMap((c) => listPlatformSources(p, c.id).map((x) => {
        const entry = [...m.platformMap, ...DEFAULT_PLATFORM_MAP].find((e) => e.from === x.kind)
        return { key: x.key, name: x.name, layout: c.name, from: x.kind, fromName: sourceName(x.kind), targets: targetsOf(x.kind, entry?.to ?? {}, m.sourceOverrides?.[x.key]) }
      }).filter((r) => r.targets.length)),
    }
  })

  /** Change the preset's own settings file and keep the change as a saved step. */
  const editManifest = async (p: string, change: (m: ReturnType<typeof readBundleDir>['manifest']) => void, message: string) => {
    const git = gitRunner()
    const st = await repoStatus(p, git)
    if (st.dirtyFiles.length) return { ok: false as const, error: 'This preset has changes that are not saved yet. Save them first.' }
    const m = readBundleDir(p, { keepMissing: true }).manifest
    change(m)
    fs.writeFileSync(path.join(p, 'manifest.json'), serializeManifest(m))
    await commitAll(p, message, git)
    if (st.remote) await pushRepo(p, git)
    return { ok: true as const }
  }
  handle('presets:setExclude', (_e, p: string, exclude: NonNullable<ExportRequest['exclude']>) =>
    editManifest(p, (m) => {
      const clean = { ...(exclude.collections?.length ? { collections: exclude.collections } : {}), ...(exclude.profiles?.length ? { profiles: exclude.profiles } : {}), ...(exclude.remoteControl ? { remoteControl: true } : {}), ...(exclude.scripts ? { scripts: true } : {}) }
      if (Object.keys(clean).length) m.exclude = clean; else delete m.exclude
    }, 'Changed what this preset saves'))
  handle('presets:setSourceOverrides', (_e, p: string, overrides: Record<string, Record<string, string | null>>) =>
    editManifest(p, (m) => { if (Object.keys(overrides).length) m.sourceOverrides = overrides as never; else delete m.sourceOverrides }, 'Changed how single sources are translated between computers'))
  handle('presets:setOverrides', (_e, p: string, overrides: Record<string, Record<string, string | null>>) =>
    editManifest(p, (m) => { if (Object.keys(overrides).length) m.platformOverrides = overrides as never; else delete m.platformOverrides }, 'Changed how sources are translated between computers'))

  handle('presets:move', async (_e, p: string, parent: string) => {
    try {
      const target = path.join(parent, path.basename(p))
      if (path.resolve(target) === path.resolve(p)) return { ok: false, error: 'It is already there.' }
      if (path.resolve(target).startsWith(path.resolve(p) + path.sep)) return { ok: false, error: 'Choose a folder outside this preset.' }
      if (fs.existsSync(target) && fs.readdirSync(target).length) return { ok: false, error: `There is already something called “${path.basename(p)}” in that folder. Choose another place.` }
      fs.mkdirSync(parent, { recursive: true })
      try { fs.renameSync(p, target) } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
        // another disk: copy, check, then remove the old one
        fs.cpSync(p, target, { recursive: true })
        if (!fs.existsSync(path.join(target, 'manifest.json'))) throw new Error('The copy did not finish, so nothing was moved.')
        fs.rmSync(p, { recursive: true, force: true })
      }
      const s = loadSettings()
      for (const r of s.repos) if (r.path === p) r.path = target
      saveSettings(s)
      return { ok: true, repo: await repoInfo(s.repos.find((r) => r.path === target) ?? { path: target }) }
    } catch (e) { return { ok: false, error: `Could not move it: ${(e as Error).message}` } }
  })

  // what is in an OBS (and what would go into a file), without reading any big file into the file
  handle('obs:scan', (_e, installId: string) => {
    const b = exportBundle({ host, install: findInstall(installId), name: 'scan', bundleBelowBytes: 0 })
    return {
      files: b.manifest.assets.filter((a) => a.role !== 'script').map((a) => ({ id: a.id, filename: a.filename, size: a.size ?? 0, available: a.size !== undefined, auto: (a.size ?? 0) <= SMALL_FILE })),
      scripts: [...b.manifest.assets.filter((a) => a.role === 'script').map((a) => a.filename), ...scriptFolderNames(b.manifest)],
      remoteControl: b.files.has(WEBSOCKET_FILE),
      keys: b.manifest.variables.filter((v) => v.kind === 'secret').map((v) => v.label ?? v.name),
    }
  })
  handle('presets:scanFile', (_e, p: string) => presetFiles(p, locationsFor(readBundleDir(p).manifest.id).assets))

  /** A setup file made from a preset: everything it holds, the big files that were chosen, the keys only when asked. */
  handle('presets:exportFile', async (_e, p: string, o: { includeKeys: boolean; bigFiles: string[]; independent: boolean }) => {
    try {
      const m = readBundleDir(p).manifest
      const remote = (await repoStatus(p, gitRunner())).remote ? await getRemoteUrl(p, gitRunner()) : undefined
      const built = buildPresetFile({
        dir: p, includeKeys: o.includeKeys, bigFiles: o.bigFiles, independent: o.independent, locations: locationsFor(m.id).assets,
        repository: remote && !o.independent ? publicRemoteUrl(remote) : undefined,
      })
      const b = built.bundle
      const mark = b.manifest.containsSecrets ? ' (CONTAINS STREAM KEYS)' : ''
      const d = await dialog.showSaveDialog({
        title: 'Export this preset to a file', defaultPath: `${b.manifest.name.replace(/[\\/:*?"<>|]/g, '_')}${mark}.obsbundle`,
        filters: [{ name: 'OBS setup file', extensions: ['obsbundle'] }],
      })
      if (d.canceled || !d.filePath) return { ok: false, cancelled: true, error: '' }
      fs.writeFileSync(d.filePath, await writeBundleZip(b))
      return { ok: true, path: d.filePath, keys: built.keys, missingMedia: built.missingMedia, independent: o.independent }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  /** What the companion file of a preset would hold. */
  handle('presets:extrasInfo', (_e, p: string) => {
    const c = extrasContent(p, locationsFor(readBundleDir(p).manifest.id).assets)
    return { files: c.files, media: c.media.map(({ id, filename, size }) => ({ id, filename, size })), keys: c.keys }
  })
  handle('presets:exportExtras', async (_e, p: string, o: { includeKeys: boolean; mediaIds: string[] }) => {
    try {
      const m = readBundleDir(p).manifest
      const d = await dialog.showSaveDialog({
        title: 'Export the extras of this preset', defaultPath: `${m.name.replace(/[\\/:*?"<>|]/g, '_')}${o.includeKeys ? ' (CONTAINS STREAM KEYS)' : ''}.${EXTRAS_EXT}`,
        filters: [{ name: 'OBS preset extras', extensions: [EXTRAS_EXT] }],
      })
      if (d.canceled || !d.filePath) return { ok: false, cancelled: true, error: '' }
      const r = await writeExtras({ dir: p, includeKeys: o.includeKeys, mediaIds: o.mediaIds, locations: locationsFor(m.id).assets }, d.filePath)
      return { ok: true, path: d.filePath, ...r }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  const dirSize = (dir: string): number => {
    let n = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const f = path.join(dir, e.name)
      try { n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size } catch { /* gone meanwhile */ }
    }
    return n
  }
  /** What a preset holds and where each part lives: this computer, GitHub, or only here. */
  handle('presets:overview', (_e, p: string) => memoised(`overview|${p}`, 30_000, () => heavy((): PresetOverview => {
    const b = readBundleDir(p)
    const m = b.manifest
    const set = readLocalSettings(p)
    const skip = set.cloud?.skip ?? {}
    const up = new Set(set.cloud?.media ?? [])
    const noCopy = new Set(set.skipLocalMedia ?? [])
    const ex = m.exclude ?? {}
    const files = presetFiles(p, locationsFor(m.id).assets)
    const own = localMediaLocations(p, m)
    const layouts = m.collections.map((c) => {
      const n = listNames(p, c.id)
      return { id: c.id, name: c.name, scenes: n.scenes.length, sources: n.sources.length, local: !ex.collections?.includes(c.name), cloud: !skip.layouts?.includes(c.id) }
    })
    const outputs = m.profiles.map((x) => ({ id: x.id, name: x.name, local: !ex.profiles?.includes(x.name), cloud: !skip.outputs?.includes(x.id) }))
    const scriptNames = [...m.assets.filter((a) => a.role === 'script').map((a) => a.filename), ...scriptFolderNames(m)]
    const rc = b.files.has(WEBSOCKET_FILE)
    const keyCount = Object.keys(readLocalKeys(p)).length
    const stored = new Set(set.cloud?.stored ?? [])
    const fileRows = files.map((f) => ({ ...f, haveCopy: !!own[f.id], keepCopy: !noCopy.has(f.id), cloud: up.has(f.id), stored: stored.has(f.id), tooBigForGithub: f.size > MAX_UPLOAD_FILE }))
    const onlyHere: string[] = []
    if (keyCount) onlyHere.push(`${keyCount} stream key${keyCount === 1 ? '' : 's'}`)
    const copied = fileRows.filter((f) => f.haveCopy && !f.cloud && !f.stored)
    if (copied.length) onlyHere.push(`${copied.length} file${copied.length === 1 ? '' : 's'} (${humanSize(copied.reduce((n, f) => n + f.size, 0))})`)
    const inStorage = fileRows.filter((f) => f.stored)
    if (inStorage.length) onlyHere.push(`${inStorage.length} file${inStorage.length === 1 ? '' : 's'} in your big-file storage`)
    for (const l of layouts) if (!l.cloud) onlyHere.push(`scene layout “${l.name}”`)
    for (const o of outputs) if (!o.cloud) onlyHere.push(`output settings “${o.name}”`)
    if (skip.scripts && scriptNames.length) onlyHere.push('scripts')
    if (skip.remoteControl && rc) onlyHere.push('remote-control settings')
    return {
      layouts, outputs, files: fileRows,
      scripts: { names: scriptNames, local: !ex.scripts, cloud: !skip.scripts },
      remoteControl: { present: rc, local: !ex.remoteControl, cloud: !skip.remoteControl },
      keys: { count: keyCount, keep: set.keepKeys ?? keepKeysDefault() },
      onlyHere, sizeBytes: dirSize(p), maxUploadBytes: MAX_UPLOAD_FILE,
      storage: set.storage ? { label: set.storage.label || set.storage.bucket, connected: storageReady(set.storage), target: set.storage } : undefined,
    }
  })))

  /** Change where each part of a preset lives. Upload choices take effect at once (one saved step); keys and copies follow the choice. */
  handle('presets:setStorage', async (_e, p: string, patch: { cloud?: { layouts?: string[]; outputs?: string[]; scripts?: boolean; remoteControl?: boolean; media?: string[] }; keepKeys?: boolean; skipLocalMedia?: string[] }) => {
    try {
      const git = gitRunner()
      const cur: LocalSettings = readLocalSettings(p)
      const next: LocalSettings = { ...cur }
      if (patch.cloud) {
        next.cloud = { ...cur.cloud, skip: { ...cur.cloud?.skip }, media: cur.cloud?.media }
        const sk = next.cloud!.skip!
        if (patch.cloud.layouts) sk.layouts = patch.cloud.layouts
        if (patch.cloud.outputs) sk.outputs = patch.cloud.outputs
        if (patch.cloud.scripts !== undefined) sk.scripts = patch.cloud.scripts
        if (patch.cloud.remoteControl !== undefined) sk.remoteControl = patch.cloud.remoteControl
        if (patch.cloud.media) next.cloud!.media = patch.cloud.media
      }
      if (patch.keepKeys !== undefined) next.keepKeys = patch.keepKeys
      if (patch.skipLocalMedia) next.skipLocalMedia = patch.skipLocalMedia
      writeLocalSettings(p, next)
      if (patch.keepKeys === false) fs.rmSync(path.join(p, LOCAL_DIR, 'keys.json'), { force: true })
      if (patch.skipLocalMedia) {
        const m = readBundleDir(p).manifest
        for (const a of m.assets) if (patch.skipLocalMedia.includes(a.id)) fs.rmSync(path.join(p, LOCAL_DIR, 'media', a.id), { recursive: true, force: true })
      }
      let changed = false, pushed = false
      if (patch.cloud) {
        const st = await repoStatus(p, git)
        if (st.dirtyFiles.length) { writeLocalSettings(p, cur); return { ok: false, error: 'This preset has changes that are not saved yet. Save them first, then change what is uploaded.' } }
        const r = await applyCloudSettings(p, git, locationsFor(readBundleDir(p).manifest.id).assets)
        if (!r.ok) { writeLocalSettings(p, cur); await applyCloudSettings(p, git); return { ok: false, error: r.message } }
        changed = r.changed
        // an online preset is kept up to date, so the change reaches GitHub straight away when it can
        if (changed && st.remote && st.behind === 0) pushed = (await pushRepo(p, git)).status === 'pushed'
      }
      return { ok: true, changed, pushed }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  handle('presets:rename', async (_e, r: { path: string; installId?: string; kind: 'preset' | 'layout' | 'output' | 'scene'; id?: string; layoutId?: string; from?: string; to: string }) => {
    const git = gitRunner()
    try {
      const st = await repoStatus(r.path, git)
      if (st.dirtyFiles.length) return { ok: false, error: 'This preset has changes that are not saved yet. Save them first, then rename.' }
      const m = readBundleDir(r.path).manifest
      const inst = r.installId ? allInstalls().find((i) => i.id === r.installId && i.configExists) : undefined
      const layout = m.collections.find((c) => c.id === (r.kind === 'layout' ? r.id : r.layoutId))
      const output = m.profiles.find((x) => x.id === r.id)
      // is the same thing in the linked OBS too?
      const inObs = !!inst && (r.kind === 'layout' ? !!layout && obsHasLayout(inst.configDir, layout.fileName ?? layout.name)
        : r.kind === 'output' ? !!output && obsHasOutput(inst.configDir, output.dirName ?? output.name)
        : r.kind === 'scene' ? !!layout && obsHasLayout(inst.configDir, layout.fileName ?? layout.name) : false)
      if (inObs && (await obsRunningFor(inst!))) return { ok: false, error: 'OBS is open. Close it first, so the new name can be changed in OBS as well.' }
      if (inObs) {
        // make sure nothing done in OBS since the last save is lost
        const cap = await captureLive({ host, install: inst!, dir: r.path, appVersion: app.getVersion(), versions: detectVersions(inst!, host), git })
        if (cap.status === 'conflict') return { ok: false, error: 'OBS and this preset changed the same part. Update the preset from OBS first and settle that, then rename.' }
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
          if (r.kind === 'layout') renameLayoutInObs(inst!.configDir, layoutNow!.name, r.to, layoutNow!.fileName ?? layoutNow!.name)
          else if (r.kind === 'output') renameOutputInObs(inst!.configDir, outputNow!.name, r.to, outputNow!.dirName ?? outputNow!.name)
          else renameSourceInObs(inst!.configDir, layoutNow!.fileName ?? layoutNow!.name, r.from!, r.to)
        }
        // a layout or output keeps its place in "kept on this computer" when its id changes with its name
        if (r.kind === 'layout' || r.kind === 'output') {
          const set = readLocalSettings(r.path)
          const now = readBundleDir(r.path, { keepMissing: true }).manifest
          const oldId = r.kind === 'layout' ? layoutNow!.id : outputNow!.id
          const newId = r.kind === 'layout' ? now.collections.find((c) => c.name === r.to.trim())?.id : now.profiles.find((x) => x.name === r.to.trim())?.id
          const list = r.kind === 'layout' ? set.cloud?.skip?.layouts : set.cloud?.skip?.outputs
          if (newId && newId !== oldId && list?.includes(oldId)) {
            const swapped = list.map((x) => (x === oldId ? newId : x))
            if (r.kind === 'layout') set.cloud!.skip!.layouts = swapped; else set.cloud!.skip!.outputs = swapped
            set.kept = cloudSkippedPaths(set.cloud!.skip)
            writeLocalSettings(r.path, set)
            writeExclude(r.path, set.kept)
          }
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

  /** Rename the repository on GitHub (always `OBS-Config-<name>`) and point this preset at the new address. */
  handle('presets:renameOnline', async (_e, p: string, name: string) => {
    const t = loadGithubToken()
    if (!t) return { ok: false, error: 'Sign in to GitHub first (under Settings).' }
    try {
      const entry = loadSettings().repos.find((r) => r.path === p) ?? { path: p }
      const remote = await getRemoteUrl(p, gitRunner())
      let found = entry.github ? { owner: entry.github.split('/')[0], repo: entry.github.split('/')[1] } : remote ? parseGithubUrl(remote) : null
      // a stand-in server (tests) hands out folder paths as addresses: the repository is that folder's name, under the signed-in account
      if (!found && remote && process.env.OBSCL_GITHUB_API && githubLogin) found = { owner: githubLogin, repo: path.basename(remote).replace(/\.git$/, '') }
      if (!found) return { ok: false, error: 'This preset is not on GitHub under an address the app can rename.' }
      const repo = await githubRenameRepo(t, found.owner, found.repo, name)
      const set = await setRemote(p, repo.cloneUrl, gitRunner())
      if (!set.ok) return { ok: false, error: set.message }
      rememberGithub(p, repo.fullName)
      return { ok: true, name: repo.name }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  handle('presets:setOnline', async (_e, p: string, on: boolean, name: string, priv: boolean, org?: string, replace?: boolean) => {
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
        const out = await publishToGithub(p, t, name, { private: priv, org, replaceExisting: replace === true })
        rememberGithub(p, out.repo.fullName)
        if (out.push.status === 'error') return { ok: false, error: out.replaced ? `Found it on GitHub, but replacing what is in it failed: ${out.push.message}` : `Created on GitHub, but uploading failed: ${out.push.message}` }
        return { ok: true, url: out.repo.htmlUrl }
      }
      const pr = await pushRepo(p, git)
      return pr.status === 'error' ? { ok: false, error: pr.message } : { ok: true }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  handle('updates:state', () => updates.state)
  handle('updates:check', () => updates.check())
  handle('updates:install', () => { updates.install() })
  // the theme-drawn title bar (the engine's window-frame module): off by default, applies after a restart
  handle('window:frame', () => ({ custom: !!loadSettings().customFrame, platform: process.platform }))
  handle('window:setCustomFrame', (_e, on: boolean) => { const s = loadSettings(); s.customFrame = on === true; saveSettings(s) })
  handle('window:control', (e, action: 'minimize' | 'maximize' | 'close') => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (action === 'minimize') w.minimize()
    else if (action === 'close') w.close()
    else if (w.isMaximized()) w.unmaximize(); else w.maximize()
  })
  handle('window:restart', () => { app.relaunch(); app.exit(0) })

  // ── who saves are by ──
  handle('identity:get', () => {
    const st = loadSettings()
    return {
      mode: st.identity?.mode ?? 'github', name: st.identity?.name ?? '', email: st.identity?.email ?? '',
      github: loadGithubToken() ? st.github : undefined,
      effective: appIdentity() ?? null,
    }
  })
  handle('identity:set', (_e, mode: 'github' | 'custom', name: string, email: string) => {
    const n = (name ?? '').trim(), m = (email ?? '').trim()
    if (mode === 'custom') {
      if (!n || !m) return { ok: false, error: 'Give both a name and an email address.' }
      if (/[<>\n]/.test(n) || /[<>\s]/.test(m) || !/^[^@]+@[^@]+$/.test(m)) return { ok: false, error: 'That name or email address is not usable. The address looks like name@example.com.' }
    }
    const st = loadSettings(); st.identity = { mode, ...(mode === 'custom' ? { name: n, email: m } : {}) }; saveSettings(st)
    return { ok: true }
  })
  handle('presets:authors', async (_e, p: string) => ({
    authors: await listAuthors(p, gitRunner(p)),
    own: readLocalSettings(p).author ?? null,
    effective: identityFor(p) ?? null,
  }))
  handle('presets:setAuthor', (_e, p: string, who: GitIdentity | null) => {
    const cur = readLocalSettings(p)
    if (who) {
      if (!who.name.trim() || !/^[^@\s<>]+@[^@\s<>]+$/.test(who.email.trim()) || /[<>\n]/.test(who.name)) return { ok: false, error: 'That name or email address is not usable.' }
      writeLocalSettings(p, { ...cur, author: { name: who.name.trim(), email: who.email.trim() } })
    } else { const { author: _a, ...rest } = cur; writeLocalSettings(p, rest) }
    return { ok: true }
  })
  /** Every save in a preset, signed with this name from now on and back to the first one; then GitHub gets the new history. */
  handle('presets:rewriteAuthors', async (_e, p: string, who: GitIdentity) => {
    try {
      if (!who.name.trim() || !/^[^@\s<>]+@[^@\s<>]+$/.test(who.email.trim()) || /[<>\n]/.test(who.name)) return { ok: false, error: 'That name or email address is not usable.' }
      const git = gitRunner(p)
      let st = await repoStatus(p, git)
      if (st.remote) {
        await fetchRepo(p, git)
        st = await repoStatus(p, git)
        if (st.behind > 0) return { ok: false, error: 'GitHub has newer changes than this computer. Press “Get updates” first, then change the name.' }
      }
      const r = await rewriteAuthor(p, who, git)
      if (!r.ok) return { ok: false, error: r.message }
      // saves from now on carry the same name
      writeLocalSettings(p, { ...readLocalSettings(p), author: { name: who.name.trim(), email: who.email.trim() } })
      let pushed = false, pushError: string | undefined
      if (st.remote && (r.changed || st.ahead > 0)) {
        const pr = await pushRepo(p, git, { force: true })
        pushed = pr.status === 'pushed'
        if (pr.status === 'error') pushError = pr.message
      }
      // the old history is only dropped once nothing still needs it
      if (!st.remote || pushed) await discardNameChangeBackup(p, git)
      return { ok: true, rewritten: r.rewritten, changed: r.changed, online: !!st.remote, pushed, pushError }
    } catch (e) { return { ok: false, error: errText(e) } }
  })

  // ── big-file storage ──
  handle('storage:state', () => ({ target: loadSettings().storage ?? null, hasKeys: !!loadStorageKeys(), canStoreKeys: safeStorage.isEncryptionAvailable(), sessionOnly: storageSessionOnly || undefined }))
  handle('storage:save', async (_e, target: StorageTarget, keys: StorageKeys | null) => {
    const t: StorageTarget = { endpoint: target.endpoint.trim(), region: (target.region ?? '').trim() || regionFromEndpoint(target.endpoint) || 'auto', bucket: target.bucket.trim(), ...(target.label?.trim() ? { label: target.label.trim() } : {}), prefix: (target.prefix ?? 'obs-config-loader/').trim() || 'obs-config-loader/' }
    const bad = validateTarget(t)
    if (bad) return { ok: false, error: bad }
    const k = keys && keys.accessKeyId.trim() && keys.secretAccessKey.trim() ? { accessKeyId: keys.accessKeyId.trim(), secretAccessKey: keys.secretAccessKey.trim() } : loadStorageKeys()
    if (!k) return { ok: false, error: 'Paste the key ID and the secret key.' }
    const test = await testStorage(t, k)
    if (!test.ok) return { ok: false, error: test.message.split(k.secretAccessKey).join('***') }
    storageKeysMem = k
    if (safeStorage.isEncryptionAvailable()) { fs.mkdirSync(path.dirname(storageKeysPath()), { recursive: true }); fs.writeFileSync(storageKeysPath(), safeStorage.encryptString(JSON.stringify(k))); storageSessionOnly = false }
    else storageSessionOnly = true // no keychain: never written in the clear
    const st = loadSettings(); st.storage = t; saveSettings(st)
    return { ok: true, sessionOnly: storageSessionOnly }
  })
  handle('storage:forget', () => {
    storageKeysMem = undefined; storageSessionOnly = false
    try { fs.rmSync(storageKeysPath(), { force: true }) } catch { /* nothing saved */ }
    const st = loadSettings(); delete st.storage; saveSettings(st)
  })
  /** Which files of a preset are kept in the storage. Files newly added are uploaded first; nothing changes if one fails. */
  handle('presets:setStored', async (_e, p: string, ids: string[]) => {
    try {
      const cur = readLocalSettings(p)
      const had = new Set(cur.cloud?.stored ?? [])
      const adding = ids.filter((i) => !had.has(i))
      const target = loadSettings().storage
      const keys = loadStorageKeys()
      if (adding.length && (!target || !keys)) return { ok: false, error: 'Set up your big-file storage first (Settings).' }
      const m = readBundleDir(p, { keepMissing: true }).manifest
      const own = localMediaLocations(p, m)
      const known = locationsFor(m.id).assets
      let uploaded = 0, already = 0
      for (const id of adding) {
        const a = m.assets.find((x) => x.id === id)
        if (!a) continue
        const file = [own[id], known[id]].find((f) => f && fs.existsSync(f))
        if (!file) return { ok: false, error: `“${a.filename}” is not on this computer, so it cannot be put in the storage. Find it first.` }
        const sha = await sha256OfFile(file)
        if (a.sha256 && a.sha256 !== sha) return { ok: false, error: `“${a.filename}” has changed since the preset was saved. Press “Update preset from OBS” first.` }
        // keyed by the fingerprint the preset records (or, for an older preset without one, this file's)
        const r = await putFile(target!, keys!, objectKey(target!, sha, a.filename), file, sha, (d, t) => sendStorageProgress(id, a.filename, d, t))
        if (r === 'uploaded') uploaded++; else already++
        if (!a.sha256) { a.sha256 = sha; a.size = fs.statSync(file).size; fs.writeFileSync(path.join(p, 'manifest.json'), serializeManifest(m)) }
      }
      const next: LocalSettings = { ...cur, cloud: { ...cur.cloud, stored: ids, media: (cur.cloud?.media ?? []).filter((x) => !ids.includes(x)) }, ...(ids.length && target ? { storage: target } : {}) }
      writeLocalSettings(p, next)
      const git = gitRunner(p)
      const st = await repoStatus(p, git)
      if (st.dirtyFiles.some((f) => f !== 'manifest.json' && f !== 'assets.lock.json')) { writeLocalSettings(p, cur); return { ok: false, error: 'This preset has changes that are not saved yet. Save them first.' } }
      const r = await applyCloudSettings(p, git, locationsFor(m.id).assets)
      if (!r.ok) { writeLocalSettings(p, cur); return { ok: false, error: r.message } }
      let pushed = false
      if (r.changed && st.remote && st.behind === 0) pushed = (await pushRepo(p, git)).status === 'pushed'
      return { ok: true, uploaded, already, pushed }
    } catch (e) { return { ok: false, error: storageError(e) } }
  })
  /** Download the files a preset keeps in the storage that this computer does not have yet. */
  handle('presets:fetchStored', async (_e, p: string) => {
    try {
      const set = readLocalSettings(p)
      const wanted = new Set(set.cloud?.stored ?? [])
      if (!wanted.size) return { ok: true, downloaded: 0, failed: [] as { filename: string; error: string }[] }
      const target = loadSettings().storage
      const keys = loadStorageKeys()
      if (!target || !keys || !storageReady(set.storage)) return { ok: false, error: set.storage ? `This preset keeps big files in “${set.storage.label || set.storage.bucket}”. Connect to it in Settings first (you only need its access keys).` : 'Set up your big-file storage first (Settings).' }
      const m = readBundleDir(p, { keepMissing: true }).manifest
      const own = localMediaLocations(p, m)
      const known = locationsFor(m.id).assets
      let downloaded = 0
      const failed: { filename: string; error: string }[] = []
      for (const a of m.assets) {
        if (!wanted.has(a.id) || [own[a.id], known[a.id]].some((f) => f && fs.existsSync(f))) continue
        if (!a.sha256) { failed.push({ filename: a.filename, error: 'The preset does not record this file’s fingerprint, so it cannot be fetched safely.' }); continue }
        try { await getFile(target, keys, objectKey(target, a.sha256, a.filename), localMediaPath(p, a.id, a.filename), a.sha256, (d, t) => sendStorageProgress(a.id, a.filename, d, t)); downloaded++ }
        catch (e) { failed.push({ filename: a.filename, error: storageError(e) }) }
      }
      return { ok: true, downloaded, failed }
    } catch (e) { return { ok: false, error: storageError(e) } }
  })

  handle('app:version', () => app.getVersion())
  handle('app:openExternal', (_e, url: string) => {
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
