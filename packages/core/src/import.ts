import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import type { Bundle, Manifest, Platform, PlatformMapEntry } from './types.js'
import type { Host, ObsInstall } from './detect.js'
import { BUILTIN_TOKENS, pathModule, resolveJson, resolveString, type BuiltinToken, type TokenResolver } from './tokens.js'
import { getIni, mapIniValues, setIni } from './ini.js'
import { DEFAULT_PLATFORM_MAP, availableOn, isPlatformSpecific } from './sources.js'
import { checkPlugins, installedModules, type PluginFinding } from './plugins.js'
import { unversioned } from './plugins.js'

export type ConflictMode = 'replace' | 'keep-both' | 'skip'

export interface ImportOptions {
  bundle: Bundle
  install: ObsInstall
  host: Host
  /** Collection / profile ids from the manifest. Default: all. */
  collections?: string[]
  profiles?: string[]
  /** Answers for manifest variables (secrets included). Missing ones fall back to the variable's default. */
  variables?: Record<string, string>
  /** Local path for each external asset id. */
  assetFiles?: Record<string, string>
  /** Where bundled media are written. Default: <configDir>/obs-config-loader/<bundle id>/media */
  mediaDir?: string
  conflict?: ConflictMode
  /** Make the imported collection/profile the active one in global.ini. */
  activate?: boolean
  /** On Linux, prefer PipeWire (Wayland) capture over X11 when a source has to be substituted. Default true. */
  preferPipewire?: boolean
  /** The caller knows OBS is running (import is blocked: OBS rewrites its files on exit). */
  obsRunning?: boolean
  folders?: Partial<Record<BuiltinToken, string>>
  now?: Date
}

export type WriteAction = 'create' | 'replace' | 'keep-both' | 'skip'

export interface PlannedWrite {
  /** Absolute target path. */
  path: string
  data: Buffer
  action: WriteAction
  /** Existing file to copy to the backup folder first. */
  backupOf?: string
  kind: 'collection' | 'profile-file' | 'media' | 'global'
}

export interface Substitution {
  source: string
  from: string
  to?: string
  /** `substituted` replaced the id; `disabled` kept the id and hid the scene items. */
  result: 'substituted' | 'disabled'
  note?: string
}

export interface ImportReport {
  willWrite: { path: string; action: WriteAction }[]
  missingVariables: { name: string; kind: string; required: boolean }[]
  usedDefaults: string[]
  missingAssets: { id: string; filename: string; hint?: string }[]
  plugins: PluginFinding[]
  substitutions: Substitution[]
  warnings: string[]
  /** Reasons the import must not proceed (OBS running, no OBS config dir resolvable...). */
  blockers: string[]
  backupDir: string
}

export interface ImportPlan {
  writes: PlannedWrite[]
  report: ImportReport
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\0]/g, '_').replace(/^\.+/, '_').trim() || 'Untitled'
}

function defaultFolders(host: Host): Record<BuiltinToken, string> {
  const p = pathModule(host.platform)
  const h = host.home
  return {
    home: h,
    documents: p.join(h, 'Documents'),
    videos: p.join(h, host.platform === 'darwin' ? 'Movies' : 'Videos'),
    music: p.join(h, 'Music'),
    pictures: p.join(h, 'Pictures'),
    desktop: p.join(h, 'Desktop'),
    bundle: '',
  }
}

function pickReplacement(entry: PlatformMapEntry, target: Platform, preferPipewire: boolean): string | undefined {
  const t = entry.to as Record<string, string | undefined>
  if (target === 'linux') {
    const order = preferPipewire ? ['linux-pipewire', 'linux'] : ['linux', 'linux-pipewire']
    for (const k of order) if (t[k] && availableOn(t[k]!, 'linux')) return t[k]
    return undefined
  }
  return t[target] && availableOn(t[target]!, target) ? t[target] : undefined
}

/** Swap or disable sources that cannot exist on the target platform. Mutates the collection. */
function adaptSources(collection: any, manifest: Manifest, target: Platform, preferPipewire: boolean, subs: Substitution[]): void {
  const table = [...manifest.platformMap, ...DEFAULT_PLATFORM_MAP]
  const disabled = new Set<string>() // names and uuids of sources to hide
  for (const s of collection.sources ?? []) {
    const id: string = s.id
    const base = unversioned(id)
    if (!isPlatformSpecific(id) && !isPlatformSpecific(base)) continue
    const key = isPlatformSpecific(id) ? id : base
    if (availableOn(key, target)) continue
    const entry = table.find((e) => e.from === key)
    const to = entry ? pickReplacement(entry, target, preferPipewire) : undefined
    if (to) {
      // The old settings name devices/windows of the other OS; OBS would ignore or misread them.
      s.id = to
      s.versioned_id = to
      s.settings = {}
      subs.push({ source: s.name, from: id, to, result: 'substituted', note: entry?.note })
    } else {
      if (s.name) disabled.add(`n:${s.name}`)
      if (s.uuid) disabled.add(`u:${s.uuid}`)
      subs.push({ source: s.name, from: id, result: 'disabled', note: 'No equivalent on this platform; kept as is and hidden.' })
    }
  }
  if (!disabled.size) return
  for (const s of collection.sources ?? []) {
    for (const item of s?.settings?.items ?? []) {
      if (disabled.has(`n:${item.name}`) || (item.source_uuid && disabled.has(`u:${item.source_uuid}`))) item.visible = false
    }
  }
}

export function planImport(o: ImportOptions): ImportPlan {
  const { bundle, install, host } = o
  const m = bundle.manifest
  const target = host.platform
  const p = pathModule(target)
  const cfg = install.configDir
  const warnings: string[] = []
  const blockers: string[] = []
  const subs: Substitution[] = []
  const writes: PlannedWrite[] = []
  const stamp = (o.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const backupDir = p.join(cfg, 'obs-config-loader', 'backups', stamp)
  const mediaDir = o.mediaDir ?? p.join(cfg, 'obs-config-loader', m.id, 'media')
  const conflict = o.conflict ?? 'replace'

  if (o.obsRunning) blockers.push('OBS is running. Close it first: it rewrites its files on exit and would undo the import.')
  if (m.obsMinVersion) warnings.push(`This setup was made for OBS ${m.obsMinVersion} or newer.`)

  // variables
  const answers = o.variables ?? {}
  const folders = { ...defaultFolders(host), ...o.folders, bundle: mediaDir }
  const usedDefaults: string[] = []
  const missingVariables: ImportReport['missingVariables'] = []
  const varValue = new Map<string, string>()
  const resolveFolderTokens = (s: string) =>
    s.replace(/\{\{([a-z]+)\}\}/g, (w, k: string) => ((BUILTIN_TOKENS as readonly string[]).includes(k) ? folders[k as BuiltinToken] : w))
  for (const v of m.variables) {
    if (answers[v.name] !== undefined) varValue.set(v.name, answers[v.name])
    else if (v.default !== undefined) {
      let d = resolveFolderTokens(v.default)
      if (v.kind === 'path') d = target === 'win32' ? d.replace(/\//g, '\\') : d
      varValue.set(v.name, d)
      usedDefaults.push(v.name)
    } else {
      varValue.set(v.name, '')
      missingVariables.push({ name: v.name, kind: v.kind, required: !!v.required })
    }
  }

  // assets
  const missingAssets: ImportReport['missingAssets'] = []
  const assetPath = new Map<string, string>()
  for (const a of m.assets) {
    if (a.mode === 'bundled') {
      const rel = `media/${a.id}/${a.filename}`
      const data = bundle.files.get(rel)
      if (!data) { missingAssets.push({ id: a.id, filename: a.filename, hint: 'Listed as bundled but not in the bundle.' }); continue }
      const dest = p.join(mediaDir, a.id, a.filename)
      assetPath.set(a.id, dest)
      writes.push({ path: dest, data, action: fs.existsSync(dest) ? 'replace' : 'create', kind: 'media' })
    } else {
      const given = o.assetFiles?.[a.id]
      if (given) {
        assetPath.set(a.id, given)
        if (a.sha256 && fs.existsSync(given)) {
          try {
            const h = crypto.createHash('sha256').update(fs.readFileSync(given)).digest('hex')
            if (h !== a.sha256) warnings.push(`${a.filename}: the file you chose is not the same one the setup was made with (checksum differs).`)
          } catch { /* unreadable: OBS will say so */ }
        }
        if ((install.kind === 'flatpak' || install.kind === 'snap') && !given.startsWith(cfg)) {
          warnings.push(`${a.filename}: ${install.kind} OBS can only see folders it was given access to; if the source stays empty, grant access to ${nodePath.dirname(given)}.`)
        }
      } else missingAssets.push({ id: a.id, filename: a.filename, hint: a.hint })
    }
  }

  const missingSeen = new Set<string>()
  const resolver: TokenResolver = {
    asset: (id) => assetPath.get(id),
    variable: (n) => varValue.get(n),
    builtin: (n) => folders[n],
    missing: (kind, name) => missingSeen.add(`${kind}:${name}`),
  }

  const colIds = new Set(o.collections ?? m.collections.map((c) => c.id))
  const profIds = new Set(o.profiles ?? m.profiles.map((c) => c.id))
  const usedCollections: any[] = []
  const takenNames = (dir: string, ext: string): Set<string> => {
    try { return new Set(fs.readdirSync(dir).map((f) => (ext ? f.replace(new RegExp(`${ext}$`), '') : f))) } catch { return new Set() }
  }

  const planFile = (path: string, data: Buffer, kind: PlannedWrite['kind'], action: WriteAction): void => {
    writes.push({ path, data, action, kind, backupOf: action === 'replace' && fs.existsSync(path) ? path : undefined })
  }

  // collections
  const scenesDir = p.join(cfg, 'basic', 'scenes')
  let activeCollectionFile: string | undefined
  let activeCollectionName: string | undefined
  for (const c of m.collections) {
    if (!colIds.has(c.id)) continue
    const raw = bundle.files.get(c.file)
    if (!raw) { warnings.push(`Collection ${c.name}: ${c.file} is missing from the bundle.`); continue }
    let json: any
    try { json = JSON.parse(raw.toString('utf8')) } catch { warnings.push(`Collection ${c.name}: file is not valid JSON.`); continue }
    json = resolveJson(json, resolver, target)
    adaptSources(json, m, target, o.preferPipewire ?? true, subs)
    usedCollections.push(json)
    let name = c.name
    let file = p.join(scenesDir, sanitizeFileName(name) + '.json')
    let action: WriteAction = fs.existsSync(file) ? 'replace' : 'create'
    if (action === 'replace' && conflict === 'skip') action = 'skip'
    if (action === 'replace' && conflict === 'keep-both') {
      const taken = takenNames(scenesDir, '\\.json')
      let n = 2
      while (taken.has(sanitizeFileName(`${c.name} (${n})`))) n++
      name = `${c.name} (${n})`
      file = p.join(scenesDir, sanitizeFileName(name) + '.json')
      action = 'keep-both'
    }
    json.name = name
    if (action !== 'skip') planFile(file, Buffer.from(JSON.stringify(json, null, 4) + '\n'), 'collection', action)
    if (action !== 'skip' && (m.activeCollection === c.id || !activeCollectionFile)) {
      activeCollectionFile = sanitizeFileName(name)
      activeCollectionName = name
    }
  }

  // profiles
  const profRoot = p.join(cfg, 'basic', 'profiles')
  let activeProfileDir: string | undefined
  let activeProfileName: string | undefined
  for (const pr of m.profiles) {
    if (!profIds.has(pr.id)) continue
    const prefix = pr.dir.replace(/\/$/, '') + '/'
    const entries = [...bundle.files.entries()].filter(([k]) => k.startsWith(prefix))
    let name = pr.name
    let dirName = sanitizeFileName(name)
    let action: WriteAction = fs.existsSync(p.join(profRoot, dirName)) ? 'replace' : 'create'
    if (action === 'replace' && conflict === 'skip') action = 'skip'
    if (action === 'replace' && conflict === 'keep-both') {
      const taken = takenNames(profRoot, '')
      let n = 2
      while (taken.has(sanitizeFileName(`${pr.name} (${n})`))) n++
      name = `${pr.name} (${n})`
      dirName = sanitizeFileName(name)
      action = 'keep-both'
    }
    if (action === 'skip') continue
    for (const [key, data] of entries) {
      const fname = key.slice(prefix.length)
      let out: Buffer = data
      if (fname.endsWith('.json')) {
        try { out = Buffer.from(JSON.stringify(resolveJson(JSON.parse(data.toString('utf8')), resolver, target), null, 4) + '\n') } catch { /* keep raw */ }
      } else if (fname === 'basic.ini') {
        let t = mapIniValues(data.toString('utf8'), (_s, _k, v) => resolveString(v, resolver, target))
        t = setIni(t, 'General', 'Name', name)
        out = Buffer.from(t)
      }
      const dest = p.join(profRoot, dirName, fname)
      // Replacing a profile replaces its files one by one; each one is backed up.
      planFile(dest, out, 'profile-file', fs.existsSync(dest) ? 'replace' : action === 'keep-both' ? 'keep-both' : 'create')
    }
    if (m.activeProfile === pr.id || !activeProfileDir) { activeProfileDir = dirName; activeProfileName = name }
  }

  // global.ini: make the import the active setup
  if (o.activate && (activeCollectionFile || activeProfileDir)) {
    const gp = p.join(cfg, 'global.ini')
    let t = ''
    try { t = fs.readFileSync(gp, 'utf8') } catch { /* OBS never ran */ }
    if (activeCollectionFile) {
      t = setIni(t, 'Basic', 'SceneCollection', activeCollectionName!)
      t = setIni(t, 'Basic', 'SceneCollectionFile', activeCollectionFile)
    }
    if (activeProfileDir) {
      t = setIni(t, 'Basic', 'Profile', activeProfileName!)
      t = setIni(t, 'Basic', 'ProfileDir', activeProfileDir)
    }
    planFile(gp, Buffer.from(t), 'global', fs.existsSync(gp) ? 'replace' : 'create')
  }

  for (const k of missingSeen) {
    const [kind, name] = k.split(/:(.*)/s)
    if (kind === 'builtin') warnings.push(`Unknown folder token {{${name}}}.`)
  }
  const plugins = checkPlugins(m.plugins, installedModules(host, install))
  if (m.source?.platform && m.source.platform !== target) {
    warnings.push(`Made on ${m.source.platform}, importing on ${target}: capture sources and device choices need checking (see substitutions).`)
  }

  return {
    writes,
    report: {
      willWrite: writes.map((w) => ({ path: w.path, action: w.action })),
      missingVariables, usedDefaults, missingAssets, plugins, substitutions: subs, warnings, blockers, backupDir,
    },
  }
}

export interface ApplyResult { written: string[]; backedUp: string[]; backupDir: string }

/** Perform a plan. Refuses when the plan has blockers. Replaced files are copied to the backup folder first. */
export function applyImport(plan: ImportPlan): ApplyResult {
  if (plan.report.blockers.length) throw new Error(plan.report.blockers.join(' '))
  const written: string[] = []
  const backedUp: string[] = []
  for (const w of plan.writes) {
    if (w.action === 'skip') continue
    if (w.backupOf && fs.existsSync(w.backupOf)) {
      // Keep the path below the config dir so backups of different files cannot collide.
      const rel = w.backupOf.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, '').replace(/[\\/]+/g, '__')
      const dest = nodePath.join(plan.report.backupDir, rel)
      fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
      fs.copyFileSync(w.backupOf, dest)
      backedUp.push(dest)
    }
    fs.mkdirSync(nodePath.dirname(w.path), { recursive: true })
    const tmp = w.path + '.obscl-tmp'
    fs.writeFileSync(tmp, w.data)
    fs.renameSync(tmp, w.path)
    written.push(w.path)
  }
  return { written, backedUp, backupDir: plan.report.backupDir }
}
