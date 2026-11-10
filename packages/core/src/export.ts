import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import { FORMAT, FORMAT_VERSION, type Asset, type AssetRole, type Bundle, type Manifest, type ScriptProject, type Variable } from './types.js'
import type { Host, ObsInstall } from './detect.js'
import { escapeLiteral, looksLikeAbsolutePath, mapStrings, sanitizeFileName, splitPath } from './tokens.js'
import { getIni, mapIniValues } from './ini.js'
import { readActive } from './userconfig.js'
import { SecretScrubber } from './secrets.js'
import { BACKUP_FILE, DATA_FILE, looksSecret, makeIgnore, stripBom } from './safety.js'
import { DEFAULT_PLATFORM_MAP, isPlatformSpecific } from './sources.js'
import { extractVariants, parseVariants, serializeVariants, variantsPathFor } from './variants.js'
import { FILE_HINTS, installedModules, manifestPlugins, pluginReport, usedIds } from './plugins.js'
import { applyVersions, type DetectedVersions } from './versions.js'
import { addProfileVariants } from './profilevariants.js'

export interface ExportOptions {
  host: Host
  install: ObsInstall
  name: string
  id?: string
  description?: string
  /** Scene collection names (file name without .json). Default: all. */
  collections?: string[]
  /** Profile directory names. Default: all. */
  profiles?: string[]
  /** Media up to this size travel inside the bundle; bigger ones are external. Default 5 MB. 0 = none, Infinity = all. */
  bundleBelowBytes?: number
  /** Asset ids (see the assets of a first run) that travel inside the bundle whatever their size: the person chose them. */
  alsoBundle?: string[]
  /** Things left out of this setup (names as OBS has them). Everything else in OBS is kept. */
  exclude?: Manifest['exclude']
  /** Where this setup is kept online, to write into a file made from it. */
  repository?: string
  /** Called for every file the scenes use that exists on this computer: where it really is (so a preset can remember it). */
  onAsset?: (a: { id: string; filename: string; path: string; size: number }) => void
  /**
   * Files that were renamed: `{ <path now>: <id the file already has in the preset> }`. A file at one of these paths keeps its id instead of
   * getting a new one from its new name, so the preset still knows it is the same file.
   */
  assetIdHints?: Record<string, string>
  /** Script folders the preset already knows (its variables). A script whose file is not on this computer yet (the folder is made by the setup step later) is still that folder, so saving does not lose it. */
  knownProjects?: Variable[]
  /**
   * Put the stream keys and other secrets INTO the file. Off by default, and the file is then labelled everywhere
   * (`containsSecrets`, a warning in the manifest, a README in the zip). Never allowed for the git folder form.
   */
  includeSecrets?: boolean
  revision?: number
  appVersion?: string
  now?: Date
  /** The OBS and plugin versions of the computer saving (see `detectVersions`). */
  versions?: DetectedVersions
}

/** Where an asset's file lives inside a bundle. Scripts are small text files that belong with the setup, so they are kept in git too. */
export function assetBundlePath(a: Pick<Asset, 'id' | 'filename' | 'role'>): string {
  return `${a.role === 'script' ? 'scripts' : 'media'}/${a.id}/${a.filename}`
}
export const WEBSOCKET_FILE = 'global/obs-websocket.json'
const MAX_SCRIPT_BYTES = 1024 * 1024
/** Script folders: where their files are kept in a setup, and which of them are (code only, nothing hidden, nothing big). */
export const PROJECT_DIR = 'scripts/projects'
export const PROJECT_FILE = /\.(py|lua|sh|bat|cmd|ps1|txt|md|html?|css|m?js)$/i  // code, and the web page a script serves next to it (a dashboard)
/** OBS's own empty starter layout: called "Untitled" and holding no sources except at most empty scenes. */
export function isBlankDefault(j: any): boolean {
  if (typeof j?.name !== 'string' || !/^untitled$/i.test(j.name.trim())) return false
  const sources: any[] = Array.isArray(j.sources) ? j.sources : []
  return sources.every((s) => s?.id === 'scene' && !(Array.isArray(s?.settings?.items) && s.settings.items.length > 0))
}

/** What a setup may put into a script folder on import: code plus the pictures, sounds and data files the scenes use. Never programs. */
export const PROJECT_KEEP = /\.(py|lua|sh|bat|cmd|ps1|txt|html?|css|m?js|md|json|ini|cfg|yaml|yml|png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|flac|m4a|aac|opus|mp4|mov|mkv|webm|avi|flv|ttf|otf|woff2?)$/i
const PROJECT_SKIP_DIRS = new Set(['venv', 'env', 'node_modules', '__pycache__', 'site-packages', 'dist', 'build', 'images', 'media', 'assets'])
const PROJECT_DEPTH = 2
const PROJECT_MAX_FILES = 200
const PROJECT_MAX_BYTES = 5 * 1024 * 1024

const HOME_FOLDERS: [RegExp, string][] = [
  [/^Documents$/i, 'documents'], [/^Videos$/i, 'videos'], [/^Movies$/i, 'videos'], [/^Music$/i, 'music'],
  [/^Pictures$/i, 'pictures'], [/^Desktop$/i, 'desktop'],
]
/** Paths inside the OBS install or the OS itself are not ours to move. */
const SYSTEM_PATH = /^(?:\/usr\/|\/opt\/|\/app\/|\/snap\/|\/System\/|\/Applications\/|[A-Za-z]:[\\/](?:Program Files|Windows))/i

const hashCache = new Map<string, string>()
/** Hash a file in pieces, so a multi-gigabyte video is never held in memory. A file that has not changed (same size and time) is not read again. */
function sha256File(p: string): string {
  let key: string | undefined
  try { const st = fs.statSync(p); key = `${p}|${st.size}|${st.mtimeMs}`; const hit = hashCache.get(key); if (hit) return hit } catch { /* hashed below, or fails there */ }
  const out = sha256FileUncached(p)
  if (key) { if (hashCache.size > 500) hashCache.clear(); hashCache.set(key, out) }
  return out
}
function sha256FileUncached(p: string): string {
  const h = crypto.createHash('sha256')
  const fd = fs.openSync(p, 'r')
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024)
    for (let n = fs.readSync(fd, buf, 0, buf.length, null); n > 0; n = fs.readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n))
  } finally { fs.closeSync(fd) }
  return h.digest('hex')
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file'
}

function roleOf(file: string): AssetRole {
  const e = nodePath.extname(file).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(e)) return 'image'
  if (['.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv'].includes(e)) return 'video'
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'].includes(e)) return 'audio'
  if (['.ttf', '.otf', '.woff', '.woff2'].includes(e)) return 'font'
  if (['.py', '.lua'].includes(e)) return 'script'
  return 'other'
}

/** Turn the user-folder prefix of an absolute path into a built-in token, whatever OS wrote it. */
export function tokenisePathPrefix(p: string, home?: string): string | undefined {
  const esc = home ? home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : undefined
  const m = (esc && new RegExp(`^${esc}(?:[\\\\/](.*))?$`).exec(p)) ||
    /^(?:[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/home\/[^/]+|\/Users\/[^/]+|\/root)(?:[\\/](.*))?$/.exec(p)
  if (!m) return undefined
  const rest = (m[1] ?? '').split(/[\\/]/).filter(Boolean)
  if (rest.length) {
    const hit = HOME_FOLDERS.find(([re]) => re.test(rest[0]))
    if (hit) return ['{{' + hit[1] + '}}', ...rest.slice(1)].join('/')
  }
  return ['{{home}}', ...rest].join('/')
}

function folderLabel(key: string | undefined): string {
  const k = (key ?? '').split('.').pop() ?? ''
  if (k === 'FilePath') return 'Recording folder (simple output)'
  if (k === 'RecFilePath') return 'Recording folder (advanced output)'
  if (k === 'FFFilePath') return 'Recording folder (custom ffmpeg output)'
  return `Folder for ${key ?? 'a setting'}`
}

function splitFile(p: string): { dir: string; base: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return { dir: p.slice(0, i), base: p.slice(i + 1) }
}
const normForCompare = (p: string, platform: string) => {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return platform === 'win32' ? n.toLowerCase() : n
}
const samePathText = (a: string, b: string, platform: string) => normForCompare(a, platform) === normForCompare(b, platform)

class Collector {
  readonly assets: Asset[] = []
  readonly variables: Variable[] = []
  readonly files = new Map<string, Buffer>()
  private assetByPath = new Map<string, string>()
  private varByValue = new Map<string, string>()
  readonly warnings: string[] = []
  /** Folders a script lives in together with files it needs (its "project"): everything inside is kept relative to one folder variable. */
  private projects: { dir: string; name: string }[] = []
  /** Files inside a script folder that a source points at (images, music...): not code, but the scene needs them, so they travel with the folder. */
  private projectExtras: { variable: string; rel: string; full: string; size: number }[] = []

  /**
   * An OBS script that finds other files by its own location (`__file__`, `script_path()`) cannot be moved on its own:
   * it would lose them. When its folder holds other files and the script looks around itself, the folder is a project: the setup
   * does not copy the script, it asks where the folder is on each computer, and every path inside it is kept relative to that.
   */
  /** Script folders the preset already has (see `ExportOptions.knownProjects`). */
  known: Variable[] = []

  /** Known script folders OBS here does not register a script for: still those folders, at their suggested place on this computer. */
  registerKnownAtDefaults(): void {
    for (const k of this.known) {
      if (this.projects.some((p) => p.name === k.name) || !k.default) continue
      const d = k.default.replace(/^\{\{home\}\}/, this.host.home.replace(/\\/g, '/'))
      if (!looksLikeAbsolutePath(d) || d.includes('{{')) continue
      this.projects.push({ dir: d, name: k.name }); this.variables.push({ ...k })
    }
  }

  addScript(scriptPath: string): void {
    if (!looksLikeAbsolutePath(scriptPath)) return
    if (!fs.existsSync(scriptPath)) {
      // not here yet: when exactly one known script folder expects a script of this name, it is that folder
      const { dir, base } = splitFile(scriptPath)
      const hit = this.known.filter((k) => k.mustContain?.includes(base))
      if (hit.length === 1 && !this.projects.some((p) => p.name === hit[0].name)) { this.projects.push({ dir, name: hit[0].name }); this.variables.push({ ...hit[0] }) }
      return
    }
    let text: string
    try { if (!fs.statSync(scriptPath).isFile()) return; text = fs.readFileSync(scriptPath, 'utf8').slice(0, 256 * 1024) } catch { return }
    const { dir, base } = splitFile(scriptPath)
    let others: string[] = []
    try { others = fs.readdirSync(dir).filter((n) => n !== base && !n.startsWith('.')) } catch { return }
    if (!others.length || !/__file__|script_path\s*\(|dirname|getcwd/.test(text)) return
    if (this.projects.some((p) => samePathText(p.dir, dir, this.host.platform))) return
    let name = 'SCRIPT_FOLDER'
    for (let n = 2; this.variables.some((v) => v.name === name); n++) name = `SCRIPT_FOLDER_${n}`
    this.projects.push({ dir, name })
    this.variables.push({
      name, kind: 'path', label: `Folder of the script “${base}” (it uses other files in it)`, mustContain: [base],
      default: tokenisePathPrefix(dir, this.host.home) ?? dir.replace(/\\/g, '/'),
    })
  }

  /**
   * Keep the files of each script folder with the setup: the script itself and the code files next to it (never environments,
   * hidden files such as `.env`, big files, or anything that is not plain code). Stored as `scripts/projects/<variable>/<file>`.
   */
  collectProjects(): ScriptProject[] {
    const out: ScriptProject[] = []
    let total = 0
    for (const proj of this.projects) {
      const rels: string[] = []
      // what the project itself keeps out of its own repository (its secrets, its build, its private copy of OBS) stays out of the preset
      let ignored = (_rel: string, _isDir: boolean) => false
      try { ignored = makeIgnore(fs.readFileSync(nodePath.join(proj.dir, '.gitignore'), 'utf8')) } catch { /* no .gitignore */ }
      const walk = (dir: string, rel: string, depth: number) => {
        let ents: fs.Dirent[] = []
        try { ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) } catch { return }
        for (const e of ents) {
          if (e.name.startsWith('.')) continue
          const r = rel ? `${rel}/${e.name}` : e.name
          const full = nodePath.join(dir, e.name)
          if (ignored(r, e.isDirectory())) continue
          if (e.isDirectory()) { if (depth < PROJECT_DEPTH && !PROJECT_SKIP_DIRS.has(e.name.toLowerCase())) walk(full, r, depth + 1); continue }
          if (!e.isFile() || !PROJECT_FILE.test(e.name) || BACKUP_FILE.test(e.name) || rels.length >= PROJECT_MAX_FILES) continue
          let size = 0
          try { size = fs.statSync(full).size } catch { continue }
          if (size > MAX_SCRIPT_BYTES || total + size > PROJECT_MAX_BYTES) continue
          const data = fs.readFileSync(full)
          // a text file that holds a password or key (a saved setup code, a config with a token) is never kept: the preset may go online
          if (DATA_FILE.test(e.name) && looksSecret(data.toString('utf8'))) { this.warnings.push(`${r} looks like it holds a password or key, so it was not kept with the script folder.`); continue }
          total += size
          this.files.set(`${PROJECT_DIR}/${proj.name}/${r}`, data)
          rels.push(r)
        }
      }
      walk(proj.dir, '', 0)
      for (const x of this.projectExtras.filter((e) => e.variable === proj.name)) {
        if (rels.includes(x.rel)) continue
        const id = slug(x.rel.split('/').pop() ?? '')
        if (x.size > this.bundleBelow && !this.alsoBundle.has(id)) { this.warnings.push(`${x.rel} (${(x.size / 1048576).toFixed(0)} MB) is too large to keep with the setup; it has to be in the script folder on the other computer.`); continue }
        try {
          const data = fs.readFileSync(x.full)
          if (DATA_FILE.test(x.rel) && looksSecret(data.toString('utf8'))) { this.warnings.push(`${x.rel} looks like it holds a password or key, so it was not kept with the script folder.`); continue }
          this.files.set(`${PROJECT_DIR}/${proj.name}/${x.rel}`, data); rels.push(x.rel)
        } catch { /* vanished: the report on import will say it is missing */ }
      }
      if (rels.length) out.push({ variable: proj.name, files: rels })
    }
    return out
  }

  /** A source points at a file inside a script folder: remember it so the file is kept with the folder, whatever kind it is. */
  private noteProjectFile(variable: string, rel: string, full: string): void {
    if (this.projectExtras.some((e) => e.variable === variable && e.rel === rel)) return
    if (rel.split('/').some((x) => x.startsWith('.'))) return
    let st: fs.Stats
    try { st = fs.statSync(full) } catch { return }
    if (st.isFile()) this.projectExtras.push({ variable, rel, full, size: st.size })
  }

  private inProject(value: string): string | undefined {
    for (const p of this.projects) {
      const a = normForCompare(value, this.host.platform), b = normForCompare(p.dir, this.host.platform)
      if (a === b) return `{{var:${p.name}}}`
      if (a.startsWith(b + '/')) {
        const rel = value.replace(/\\/g, '/').slice(b.length + 1)
        this.noteProjectFile(p.name, rel, value)
        return `{{var:${p.name}}}/${rel}`
      }
    }
    return undefined
  }

  constructor(private host: Host, private bundleBelow: number, private alsoBundle: Set<string> = new Set(), private onAsset?: ExportOptions['onAsset'], private idHints: Record<string, string> = {}) {}

  private uniqueAssetId(base: string): string {
    let id = base
    let n = 2
    while (this.assets.some((a) => a.id === id)) id = `${base}-${n++}`
    return id
  }

  /** Returns the replacement for a string value, or the (escaped) original. */
  tokenise(value: string, key: string | undefined): string {
    if (!looksLikeAbsolutePath(value) || SYSTEM_PATH.test(value)) return escapeLiteral(value)
    const rel = this.inProject(value)
    if (rel) return rel
    let st: fs.Stats | undefined
    try { st = fs.statSync(value) } catch { /* not on this machine */ }
    const base = splitPath(value).parts.at(-1) ?? 'file'
    const hasExt = /\.[A-Za-z0-9]{1,5}$/.test(base)

    if (st?.isFile() || (!st && hasExt)) {
      const known = this.assetByPath.get(value)
      if (known) return `{{asset:${known}}}`
      const hinted = this.idHints[value]
      const id = hinted && !this.assets.some((a) => a.id === hinted) ? hinted : this.uniqueAssetId(slug(base))
      this.assetByPath.set(value, id)
      const asset: Asset = { id, filename: base, role: roleOf(base), mode: 'external' }
      if (st?.isFile()) {
        asset.size = st.size
        asset.sha256 = sha256File(value)
        this.onAsset?.({ id, filename: base, path: value, size: st.size })
        const isScript = asset.role === 'script' && st.size <= MAX_SCRIPT_BYTES
        if (isScript || st.size <= this.bundleBelow || this.alsoBundle.has(id)) {
          asset.mode = 'bundled'
          this.files.set(assetBundlePath(asset), fs.readFileSync(value))
        } else asset.hint = `${base} (${(st.size / 1048576).toFixed(0)} MB) is too large to bundle; locate it on import.`
      } else asset.hint = `${base} was not found on the exporting machine; locate it on import.`
      this.assets.push(asset)
      return `{{asset:${id}}}`
    }
    // A folder (or a name with no extension): a per-machine variable with a portable default.
    const known = this.varByValue.get(value)
    if (known) return `{{var:${known}}}`
    let name = (key ?? 'PATH').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (!name) name = 'PATH'
    if (name === 'PATH' || name === 'FILE_PATH') name = 'FOLDER'
    let n = 2
    const baseName = name
    while (this.variables.some((v) => v.name === name)) name = `${baseName}_${n++}`
    this.varByValue.set(value, name)
    this.variables.push({
      name, kind: 'path', label: folderLabel(key), default: tokenisePathPrefix(value, this.host.home) ?? value.replace(/\\/g, '/'),
    })
    return `{{var:${name}}}`
  }
}

function readJson(p: string): any | undefined {
  try { return JSON.parse(stripBom(fs.readFileSync(p, 'utf8'))) } catch { return undefined }
}

/** Active names (user.ini on OBS 31+, global.ini before), used as defaults. */
function activeFromGlobal(configDir: string): { collection?: string; profile?: string } {
  const a = readActive(configDir)
  return { collection: a.collectionFile, profile: a.profileDir }
}

export const SECRETS_WARNING =
  'This file contains your stream keys. Anyone who has it can stream as you. Keep it private, never post it or put it in a git repository, and delete it once you have loaded it.'
export const SECRETS_README_NAME = 'READ-ME-FIRST-CONTAINS-STREAM-KEYS.txt'
export const SECRETS_README = `WARNING: THIS FILE CONTAINS STREAM KEYS

${SECRETS_WARNING}

It is an OBS Config Loader setup file (.obsbundle). Open it with OBS Config Loader (Load a setup file).
If you only want to share your scenes and settings, export again and leave "Include my stream keys" unticked.
`

/**
 * The manifest fields that are worked out from the setup itself (which plugins it needs, which capture sources have
 * stand-ins). Computed from the collection files, their per-platform variants and the profile files, never from one
 * machine's live state, so every machine that saves the same setup writes the same thing.
 */
export function deriveManifestFields(b: Bundle): void {
  const used = { sources: new Set<string>(), filters: new Set<string>(), transitions: new Set<string>() }
  const add = (u: ReturnType<typeof usedIds>) => { u.sources.forEach((x) => used.sources.add(x)); u.filters.forEach((x) => used.filters.add(x)); u.transitions.forEach((x) => used.transitions.add(x)) }
  for (const c of b.manifest.collections) {
    const raw = b.files.get(c.file)
    try { if (raw) add(usedIds(JSON.parse(raw.toString('utf8')))) } catch { /* not JSON: nothing to learn */ }
    for (const plats of Object.values(parseVariants(b.files.get(variantsPathFor(c.file))))) {
      for (const v of Object.values(plats)) if (v?.id) used.sources.add(v.id)
    }
  }
  const hinted = new Set<string>()
  for (const name of b.files.keys()) { const hit = FILE_HINTS[name.split('/').pop() ?? '']; if (hit) hinted.add(hit) }
  b.manifest.plugins = manifestPlugins(pluginReport(used, undefined, hinted))
  b.manifest.platformMap = DEFAULT_PLATFORM_MAP.filter((e) => used.sources.has(e.from) && isPlatformSpecific(e.from))
}

/**
 * Put secret values (by variable name) into a bundle, for a file the person chose to include their keys in.
 * Marks the bundle the way `exportBundle` does. Returns how many keys went in; names the setup does not ask for are ignored.
 */
export function attachSecrets(b: Bundle, values: Record<string, string>): number {
  let n = 0
  b.manifest.variables = b.manifest.variables.map((v) => {
    if (v.kind !== 'secret' || !values[v.name]) return v
    n++
    return { ...v, value: values[v.name] }
  })
  if (n) {
    b.manifest.containsSecrets = true
    b.manifest.warning = SECRETS_WARNING
    b.files.set(SECRETS_README_NAME, Buffer.from(SECRETS_README))
  }
  return n
}

/**
 * Take the stream keys OUT of a bundle that was exported with `includeSecrets`, and hand them back by variable name.
 * What is left is safe to keep in git. Used by presets: the keys go into the preset's own local-only area instead.
 */
export function stripSecrets(b: Bundle): Record<string, string> {
  const out: Record<string, string> = {}
  b.manifest.variables = b.manifest.variables.map((v) => {
    if (v.value === undefined) return v
    if (v.kind === 'secret' && v.value) out[v.name] = v.value
    const { value: _v, ...rest } = v
    void _v
    return rest
  })
  delete b.manifest.containsSecrets
  delete b.manifest.warning
  b.files.delete(SECRETS_README_NAME)
  return out
}

export function exportBundle(opts: ExportOptions): Bundle {
  const { host, install } = opts
  const cfg = install.configDir
  const col = new Collector(host, opts.bundleBelowBytes ?? 5 * 1024 * 1024, new Set(opts.alsoBundle ?? []), opts.onAsset, opts.assetIdHints)
  col.known = opts.knownProjects ?? []
  const ex = opts.exclude ?? {}
  const scrub = new SecretScrubber(opts.includeSecrets === true)
  const files = col.files

  // scene collections
  const scenesDir = nodePath.join(cfg, 'basic', 'scenes')
  const collections: Manifest['collections'] = []
  const used = { sources: new Set<string>(), filters: new Set<string>(), transitions: new Set<string>() }
  let sourceNames: string[] = []
  try { sourceNames = fs.readdirSync(scenesDir).filter((f) => f.endsWith('.json')).sort() } catch { /* none */ }
  // scripts that need the files around them are found first, so every path inside their folder is kept relative to it
  if (!ex.scripts) {
    for (const file of sourceNames) {
      const j = readJson(nodePath.join(scenesDir, file))
      if (!j || ex.collections?.includes(file.replace(/\.json$/, '')) || (typeof j.name === 'string' && ex.collections?.includes(j.name))) continue
      if (opts.collections && !opts.collections.includes(file.replace(/\.json$/, ''))) continue
      for (const s of Array.isArray(j.modules?.['scripts-tool']) ? j.modules['scripts-tool'] : []) if (typeof s?.path === 'string') col.addScript(s.path)
    }
  }
  col.registerKnownAtDefaults()
  for (const file of sourceNames) {
    const name = file.replace(/\.json$/, '')
    if (opts.collections && !opts.collections.includes(name)) continue
    const json = readJson(nodePath.join(scenesDir, file))
    if (!json) { col.warnings.push(`Skipped ${file}: not valid JSON.`); continue }
    // OBS makes an empty "Untitled" layout of its own on first start. It is not part of anyone's setup, and the person cannot see or delete it
    // from this app, so it must never show up as a change or be copied into a preset.
    if (isBlankDefault(json)) continue
    if (ex.collections?.includes(name) || (typeof json.name === 'string' && ex.collections?.includes(json.name))) continue
    if (ex.scripts && json.modules && typeof json.modules === 'object') { json.modules = { ...json.modules }; delete json.modules['scripts-tool'] }
    const u = usedIds(json)
    u.sources.forEach((x) => used.sources.add(x)); u.filters.forEach((x) => used.filters.add(x)); u.transitions.forEach((x) => used.transitions.add(x))
    const out = mapStrings(json, (s, k) => col.tokenise(s, k))
    const id = slug(name) + (collections.some((c) => c.id === slug(name)) ? `-${collections.length + 1}` : '')
    files.set(`collections/${id}.json`, Buffer.from(JSON.stringify(out, null, 4) + '\n'))
    const variants = extractVariants(out, host.platform)
    if (Object.keys(variants).length) files.set(variantsPathFor(`collections/${id}.json`), Buffer.from(serializeVariants(variants)))
    const shown = (json.name as string) || name
    collections.push({ id, name: shown, file: `collections/${id}.json`, ...(sanitizeFileName(shown) !== name ? { fileName: name } : {}) })
  }

  // profiles
  const profRoot = nodePath.join(cfg, 'basic', 'profiles')
  const profiles: Manifest['profiles'] = []
  const hinted = new Set<string>()
  let profDirs: string[] = []
  try { profDirs = fs.readdirSync(profRoot).filter((d) => fs.statSync(nodePath.join(profRoot, d)).isDirectory()).sort() } catch { /* none */ }
  for (const dir of profDirs) {
    if (opts.profiles && !opts.profiles.includes(dir)) continue
    if (ex.profiles?.includes(dir)) continue
    // OBS's own empty starter profile ("Untitled", no streaming service set up) next to real ones is not part of anyone's setup
    if (profDirs.length > 1 && /^untitled$/i.test(dir) && !fs.existsSync(nodePath.join(profRoot, dir, 'service.json'))) continue
    const id = slug(dir) + (profiles.some((p) => p.id === slug(dir)) ? `-${profiles.length + 1}` : '')
    const base = `profiles/${id}`
    let display = dir
    for (const f of fs.readdirSync(nodePath.join(profRoot, dir)).sort()) {
      const full = nodePath.join(profRoot, dir, f)
      if (!fs.statSync(full).isFile()) continue
      if (BACKUP_FILE.test(f)) continue // a program's own spare copy of a file: same secrets, never used
      if (FILE_HINTS[f]) hinted.add(FILE_HINTS[f])
      const rel = `${base}/${f}`
      if (f.endsWith('.json')) {
        const j = readJson(full)
        if (j !== undefined) {
          const primary = f === 'service.json' ? 'settings.key' : undefined
          const scrubbed = scrub.scrubJson(j, rel, primary)
          files.set(rel, Buffer.from(JSON.stringify(mapStrings(scrubbed, (s, k) => (s.includes('{{var:') ? s : col.tokenise(s, k)), ), null, 4) + '\n'))
          continue
        }
        // a JSON file that cannot be read cannot be scrubbed: it is left out, never copied as it is (it may hold a stream key)
        col.warnings.push(`${f} (in the output settings “${dir}”) could not be read, so it was left out. It may hold a key or password.`)
        continue
      } else if (f === 'basic.ini') {
        const text = fs.readFileSync(full, 'utf8')
        display = getIni(text, 'General', 'Name') ?? dir
        files.set(rel, Buffer.from(mapIniValues(text, (_s, k, v) => (looksLikeAbsolutePath(v) ? col.tokenise(v, `${_s}.${k}`) : v)), 'utf8'))
        continue
      }
      const raw = fs.readFileSync(full)
      if (DATA_FILE.test(f) && looksSecret(raw.toString('utf8'))) { col.warnings.push(`${f} (in the output settings “${dir}”) looks like it holds a password or key, so it was left out.`); continue }
      files.set(rel, raw)
    }
    profiles.push({ id, name: display, dir: base, ...(sanitizeFileName(display) !== dir ? { dirName: dir } : {}) })
  }

  // OBS's remote-control (WebSocket) settings: other programs (stream decks, overlays, scripts) depend on them
  const wsJson = readJson(nodePath.join(cfg, 'plugin_config', 'obs-websocket', 'config.json'))
  if (wsJson && typeof wsJson === 'object' && !ex.remoteControl) files.set(WEBSOCKET_FILE, Buffer.from(JSON.stringify(scrub.scrubJson(wsJson, WEBSOCKET_FILE), null, 4) + '\n'))

  const active = activeFromGlobal(cfg)
  const activeCol = collections.find((c) => c.file === `collections/${slug(active.collection ?? '')}.json`) ?? collections[0]
  const activeProf = profiles.find((p) => p.dir.endsWith('/' + slug(active.profile ?? ''))) ?? profiles[0]

  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: opts.id ?? crypto.randomUUID(),
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.revision ? { revision: opts.revision } : {}),
    exportedAt: (opts.now ?? new Date()).toISOString(),
    generator: { name: 'obs-config-loader', version: opts.appVersion ?? '0.1.0' },
    source: { platform: host.platform },
    collections,
    profiles,
    ...(activeCol ? { activeCollection: activeCol.id } : {}),
    ...(activeProf ? { activeProfile: activeProf.id } : {}),
    variables: [...[...scrub.variables].sort((a, b) => Number(b.name === 'STREAM_KEY') - Number(a.name === 'STREAM_KEY')), ...col.variables],
    assets: col.assets,
    plugins: [],
    platformMap: [],
  }
  const projects = col.collectProjects()
  if (projects.length) manifest.projects = projects
  if (opts.repository) manifest.repository = { url: opts.repository }
  const bundle: Bundle = { manifest, files }
  addProfileVariants(bundle, host.platform) // this system's own encoders and audio devices, kept apart from other systems'
  deriveManifestFields(bundle)
  applyVersions(manifest, undefined, opts.versions)
  if (opts.includeSecrets && manifest.variables.some((v) => v.kind === 'secret' && v.value)) {
    manifest.containsSecrets = true
    manifest.warning = SECRETS_WARNING
    files.set(SECRETS_README_NAME, Buffer.from(SECRETS_README))
  }
  return bundle
}
