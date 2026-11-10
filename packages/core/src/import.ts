import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import type { Bundle, Manifest, Platform, PlatformMapEntry } from './types.js'
import type { Host, ObsInstall } from './detect.js'
import { BUILTIN_TOKENS, sanitizeFileName, pathModule, resolveJson, resolveString, type BuiltinToken, type TokenResolver } from './tokens.js'
import { getIni, mapIniValues, setIni } from './ini.js'
import { activeTargets, withActive } from './userconfig.js'
import { availableEncoders, fixEncoders, type EncoderFix } from './encoders.js'
import { PROFILE_VARIANTS_FILE, applyPlatformPart, parseProfileVariants } from './profilevariants.js'
import { DEFAULT_PLATFORM_MAP, standInOptions, sourceName, PIPEWIRE_AUDIO_MODULE, PIPEWIRE_SCREEN, PIPEWIRE_UNIFIED_SINCE, availableOn, isPipewireAudioId, isPlatformSpecific, legacyPipewireId } from './sources.js'
import { applyVariants, parseVariants, variantsPathFor } from './variants.js'
import { KNOWN_PLUGINS, checkPlugins, installedModules, type PluginFinding } from './plugins.js'
import { unversioned } from './plugins.js'
import { assetBundlePath, PROJECT_DIR, PROJECT_KEEP, WEBSOCKET_FILE } from './export.js'
import { compareVersions, versionNotes, type DetectedVersions } from './versions.js'

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
  /** What this computer's OBS and plugins are (see `detectVersions`); used to warn when they are older than the setup's. */
  installed?: DetectedVersions
  /** Also put back OBS's remote-control (WebSocket) settings, when the setup has them. Default true. */
  websocket?: boolean
  /** The person's choice for this load, per source id: a stand-in id, or null to hide it. Wins over everything else. */
  sourceChoices?: Record<string, string | null>
}

export type WriteAction = 'create' | 'replace' | 'keep-both' | 'skip'

export interface PlannedWrite {
  /** Absolute target path. */
  path: string
  data: Buffer
  action: WriteAction
  /** Existing file to copy to the backup folder first. */
  backupOf?: string
  kind: 'collection' | 'profile-file' | 'media' | 'global' | 'websocket' | 'project'
}

export interface Substitution {
  source: string
  from: string
  to?: string
  /** `substituted` replaced the id; `disabled` kept the id and hid the scene items. */
  result: 'substituted' | 'disabled' | 'variant' | 'added'
  note?: string
  /** The source id (its kind) that a choice for all sources of that kind is keyed by (`ImportOptions.sourceChoices`). */
  key?: string
  /** This particular source (`u:<uuid>` or `n:<name>`): a choice keyed by it applies to this source alone and beats the one for its kind. */
  sourceKey?: string
  /** For a swapped or hidden source: the plain names, and what else could stand in (for the choice on the import screen). */
  fromName?: string
  toName?: string
  options?: { id: string; name: string }[]
}

export interface ImportReport {
  /** Where each file the setup uses will be on this computer (the copies it brings, and the ones the person pointed to). */
  assetLocations: Record<string, string>
  willWrite: { path: string; action: WriteAction }[]
  missingVariables: { name: string; kind: string; required: boolean }[]
  /** Secrets you did not type in, whose value already in OBS was left as it was (never blanked). */
  keptSecrets: string[]
  /** The file carries stream keys inside (so it must be handled like a password). */
  containsSecrets: boolean
  /** Secrets that were taken from the file itself (not typed in): their names. */
  includedSecrets: string[]
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

const getAt = (o: unknown, path: string[]): unknown => path.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o)
function setAt(o: unknown, path: string[], v: unknown): boolean {
  const parent = getAt(o, path.slice(0, -1))
  if (!parent || typeof parent !== 'object') return false
  ;(parent as Record<string, unknown>)[path[path.length - 1]] = v
  return true
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

interface AdaptContext {
  preferPipewire: boolean
  /** The PipeWire audio plugin is installed on the target (so its sources can stand in for generic audio sources). */
  pipewireAudio: boolean
  /** The target OBS's version, when known (the PipeWire capture sources changed in 30.2). */
  obsVersion?: string
  /** This load's own choices per source id (a stand-in id, or null to hide it). */
  choices?: Record<string, string | null>
}

function pickReplacement(from: string, entry: PlatformMapEntry, target: Platform, ctx: AdaptContext): string | undefined {
  const t = entry.to as Record<string, string | undefined>
  if (target === 'linux') {
    const order = ctx.preferPipewire ? ['linux-pipewire', 'linux'] : ['linux', 'linux-pipewire']
    for (const k of order) {
      let id = t[k]
      if (!id || !availableOn(id, 'linux')) continue
      // generic audio only uses the PipeWire audio plugin when it is there; application audio has no other choice
      if (isPipewireAudioId(id) && !ctx.pipewireAudio && id !== 'pipewire_audio_application_capture') continue
      if (id === PIPEWIRE_SCREEN && ctx.obsVersion && compareVersions(ctx.obsVersion, PIPEWIRE_UNIFIED_SINCE) < 0) id = legacyPipewireId(from)
      return id
    }
    return undefined
  }
  return t[target] && availableOn(t[target]!, target) ? t[target] : undefined
}

const WINDOWS_AUDIO_PARENTS = new Set(['window_capture', 'game_capture'])

/** `Title:Class:exe.exe` as Windows capture stores it: the program's name, for a note. */
function programOf(window: unknown): string | undefined {
  if (typeof window !== 'string') return undefined
  const exe = window.split(':').pop()
  return exe && /\.[a-z0-9]+$/i.test(exe) ? exe : undefined
}

/** What a choice for one particular source is stored under: its uuid when OBS gave it one, else its name. */
export const sourceKeyOf = (s: { uuid?: string; name?: string }) => (s.uuid ? `u:${s.uuid}` : `n:${s.name ?? ''}`)

/** Swap or disable sources that cannot exist on the target platform. Mutates the collection. */
function adaptSources(collection: any, manifest: Manifest, target: Platform, ctx: AdaptContext, subs: Substitution[]): void {
  const table = [...manifest.platformMap, ...DEFAULT_PLATFORM_MAP]
  const overrides = manifest.platformOverrides ?? {}
  const disabled = new Set<string>() // names and uuids of sources to hide
  const added: any[] = []
  for (const s of collection.sources ?? []) {
    const id: string = s.id
    const base = unversioned(id)
    if (!isPlatformSpecific(id) && !isPlatformSpecific(base)) continue
    const key = isPlatformSpecific(id) ? id : base
    if (availableOn(key, target)) continue
    const entry = table.find((e) => e.from === key)
    // the person's own choice first, then the built-in table
    const srcKey = sourceKeyOf(s)
    const pick_ = (t: Partial<Record<string, string | null>>) => target === 'linux' ? ('linux-pipewire' in t || 'linux' in t) : target in t
    // a source's own saved choice beats the one for its whole kind
    const ownTargets = (manifest.sourceOverrides?.[srcKey] && pick_(manifest.sourceOverrides[srcKey]!) ? manifest.sourceOverrides[srcKey] : overrides[key]) ?? {}
    const ownKey = target === 'linux' ? (ctx.preferPipewire && 'linux-pipewire' in ownTargets ? 'linux-pipewire' : 'linux' in ownTargets ? 'linux' : 'linux-pipewire' in ownTargets ? 'linux-pipewire' : undefined) : (target in ownTargets ? target : undefined)
    const own = ownKey ? ownTargets[ownKey as keyof typeof ownTargets] : undefined
    const chosenNow = ctx.choices && srcKey in ctx.choices ? ctx.choices[srcKey] : ctx.choices && key in ctx.choices ? ctx.choices[key] : undefined
    const hasOwn = chosenNow !== undefined || ownKey !== undefined
    const to = chosenNow !== undefined ? (chosenNow ?? undefined) : ownKey !== undefined ? (own ?? undefined) : entry ? pickReplacement(key, entry, target, ctx) : undefined
    const program = key === 'wasapi_process_output_capture' ? programOf(s.settings?.window) : undefined
    // Windows window/game capture with "capture audio" on: that audio has to become its own source elsewhere
    const wantsAudio = WINDOWS_AUDIO_PARENTS.has(key) && s.settings?.capture_audio === true
    const audioEntry = wantsAudio ? table.find((e) => e.from === 'wasapi_process_output_capture') : undefined
    const audioTo = audioEntry ? (overrides.wasapi_process_output_capture && target in overrides.wasapi_process_output_capture ? overrides.wasapi_process_output_capture[target] ?? undefined : pickReplacement('wasapi_process_output_capture', audioEntry, target, ctx)) : undefined
    const audioProgram = wantsAudio ? programOf(s.settings?.window) : undefined
    if (to) {
      // The old settings name devices/windows of the other OS; OBS would ignore or misread them.
      s.id = to
      s.versioned_id = to
      s.settings = {}
      subs.push({ source: s.name, from: id, to, result: 'substituted', note: chosenNow !== undefined ? 'As you chose.' : hasOwn ? 'As you set it in the preset settings.' : entry?.note, key, sourceKey: srcKey, fromName: sourceName(key), toName: sourceName(to), options: standInOptions(key, target).map((o) => ({ id: o, name: sourceName(o) })) })
    } else {
      if (s.name) disabled.add(`n:${s.name}`)
      if (s.uuid) disabled.add(`u:${s.uuid}`)
      subs.push({ source: s.name, from: id, result: 'disabled', note: chosenNow === null ? 'Hidden, as you chose.' : hasOwn ? 'Hidden, as you set it in the preset settings.' : 'No equivalent on this platform; kept as is and hidden.', key, sourceKey: srcKey, fromName: sourceName(key), options: standInOptions(key, target).map((o) => ({ id: o, name: sourceName(o) })) })
    }
    if (program && to) subs[subs.length - 1].note = `${subs[subs.length - 1].note ?? ''} It was capturing ${program}.`.trim()
    if (audioTo) {
      const uuid = crypto.randomUUID()
      added.push({ parent: s, source: audioSource(`${s.name} (audio)`, audioTo, uuid) })
      subs.push({ source: `${s.name} (audio)`, from: `${id} with “capture audio” on`, to: audioTo, result: 'added', note: `The window's own audio became a separate source; pick the application again.${audioProgram ? ` It was capturing ${audioProgram}.` : ''}` })
    } else if (wantsAudio && !audioTo) {
      subs.push({ source: s.name, from: `${id} with “capture audio” on`, result: 'disabled', note: 'The audio of this capture has no equivalent on this computer, so it is not captured.' })
    }
  }
  for (const a of added) {
    collection.sources.push(a.source)
    // put it in every scene that has the capture, right after it
    for (const sc of collection.sources) {
      const items: any[] = sc?.settings?.items
      if (!Array.isArray(items)) continue
      const at = items.findIndex((it) => it?.name === a.parent.name || (a.parent.uuid && it?.source_uuid === a.parent.uuid))
      if (at < 0) continue
      const nextId = items.reduce((m, it) => Math.max(m, Number(it?.id) || 0), 0) + 1
      items.splice(at + 1, 0, sceneItem(a.source.name, a.source.uuid, nextId))
      if (typeof sc.settings.id_counter === 'number') sc.settings.id_counter = Math.max(sc.settings.id_counter, nextId)
    }
  }
  if (!disabled.size) return
  for (const s of collection.sources ?? []) {
    for (const item of s?.settings?.items ?? []) {
      if (disabled.has(`n:${item.name}`) || (item.source_uuid && disabled.has(`u:${item.source_uuid}`))) item.visible = false
    }
  }
}

/** An audio source as OBS writes one. */
function audioSource(name: string, id: string, uuid: string) {
  return {
    prev_ver: 536870912, name, uuid, id, versioned_id: id, settings: {}, mixers: 255, sync: 0, flags: 0, volume: 1, balance: 0.5,
    enabled: true, muted: false, 'push-to-mute': false, 'push-to-mute-delay': 0, 'push-to-talk': false, 'push-to-talk-delay': 0,
    hotkeys: {}, deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0, private_settings: {},
  }
}

/** A scene item as OBS writes one (visible, untransformed). */
function sceneItem(name: string, uuid: string, id: number) {
  return {
    name, source_uuid: uuid, visible: true, locked: false, rot: 0, scale_ref: { x: 1920, y: 1080 }, align: 5, bounds_type: 0, bounds_align: 0,
    bounds_crop: false, crop_left: 0, crop_top: 0, crop_right: 0, crop_bottom: 0, id, group_item_backup: false,
    pos: { x: 0, y: 0 }, pos_rel: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, scale_rel: { x: 1, y: 1 }, bounds: { x: 0, y: 0 }, bounds_rel: { x: 0, y: 0 },
    scale_filter: 'disable', blend_method: 'default', blend_type: 'normal', show_transition: { duration: 0 }, hide_transition: { duration: 0 }, private_settings: {},
  }
}

const KNOWN_FOLDER_NAMES: Record<string, BuiltinToken> = { videos: 'videos', movies: 'videos', music: 'music', pictures: 'pictures', documents: 'documents', desktop: 'desktop' }

/**
 * Where a folder from another computer goes on this one: inside the same kind of folder in the home folder when the original sat in one
 * (`/mnt/Disk/Videos/OBS` -> `<Videos>/OBS`), else directly in the home folder under its own last name.
 */
export function fallbackFolder(original: string, folders: Record<string, string>, p: typeof nodePath.posix): string {
  const segs = original.split(/[\\/]/).filter(Boolean)
  const at = segs.findIndex((s) => KNOWN_FOLDER_NAMES[s.toLowerCase()] !== undefined)
  if (at >= 0) return p.join(folders[KNOWN_FOLDER_NAMES[segs[at].toLowerCase()]] ?? folders.home, ...segs.slice(at + 1))
  return p.join(folders.home, segs.at(-1) ?? 'OBS')
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
  const installedMods = installedModules(host, install)
  const encodersHere = availableEncoders(install)
  const adaptCtx: AdaptContext = { preferPipewire: o.preferPipewire ?? true, pipewireAudio: installedMods.has(PIPEWIRE_AUDIO_MODULE), obsVersion: o.installed?.obs, choices: o.sourceChoices }

  if (o.obsRunning) blockers.push('OBS is running. Close it first: it rewrites its files on exit and would undo the import.')
  if (m.obsMinVersion) warnings.push(`This setup was made for OBS ${m.obsMinVersion} or newer.`)

  // variables
  // Secrets that travel inside the file (only when it says so). What the person typed beats them; both beat what is already in OBS.
  const included: Record<string, string> = {}
  if (m.containsSecrets === true) for (const v of m.variables) if (v.kind === 'secret' && v.value) included[v.name] = v.value
  const answers = { ...included, ...(o.variables ?? {}) }
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
      // A suggested folder from another computer (a drive or mount that is not here) is no use: use the same kind of folder in the home folder.
      if (v.kind === 'path' && /^(\/|[A-Za-z]:[\\/])/.test(d) && !host.exists(d) && !host.isDir(p.dirname(d))) {
        const alt = fallbackFolder(d, folders, p)
        warnings.push(`${v.label ?? v.name}: the suggested folder ${d} does not exist on this computer, so ${alt} is used instead.`)
        d = alt
      }
      varValue.set(v.name, d)
      usedDefaults.push(v.name)
    } else {
      varValue.set(v.name, '')
      missingVariables.push({ name: v.name, kind: v.kind, required: !!v.required })
    }
  }

  // The files of a script folder come with the setup. They are put into the folder when it is a new or empty folder, or when it already
  // is that project (holds its main script); any other folder is left alone, so a setup file can never drop code into a folder
  // that belongs to something else (a startup folder, say).
  const projectFiles = new Set<string>()
  const projectWrites: { folder: string; label: string; rel: string; data: Buffer }[] = []
  for (const pr of m.projects ?? []) {
    const v = m.variables.find((x) => x.name === pr.variable)
    const folder = v ? varValue.get(v.name) : undefined
    if (!v || !folder) continue
    const files = pr.files.filter((rel) => PROJECT_KEEP.test(rel) && !rel.startsWith('/') && !rel.includes('\\') && !rel.split('/').includes('..') && !rel.split('/').some((x) => x.startsWith('.')) && bundle.files.has(`${PROJECT_DIR}/${pr.variable}/${rel}`))
    const main = v.mustContain ?? []
    const isEmpty = (() => { try { return fs.readdirSync(folder).length === 0 } catch { return true } })()
    const isProject = main.length > 0 && main.some((f) => host.exists(p.join(folder, f)))
    if (!files.length) continue
    if (!isEmpty && !isProject) {
      warnings.push(`${v.label ?? v.name}: ${folder} already has other things in it, so the script files kept with this setup were not put there. Choose the folder the script lives in, or an empty one.`)
      continue
    }
    for (const rel of files) { projectFiles.add(`${v.name}/${rel}`); projectWrites.push({ folder, label: v.label ?? v.name, rel, data: bundle.files.get(`${PROJECT_DIR}/${pr.variable}/${rel}`)! }) }
  }

  // a folder a script lives in must really hold that script: otherwise OBS shows the script as broken
  for (const v of m.variables) {
    const folder = v.mustContain?.length ? varValue.get(v.name) : undefined
    if (!folder) continue
    for (const f of v.mustContain!) {
      if (projectFiles.has(`${v.name}/${f}`)) continue // it comes with the setup and is put there
      if (!host.exists(p.join(folder, f))) warnings.push(`${v.label ?? v.name}: ${f} was not found in ${folder}. Choose the folder it is in, or the script will show as broken in OBS.`)
    }
  }

  // assets
  const missingAssets: ImportReport['missingAssets'] = []
  const assetPath = new Map<string, string>()
  for (const a of m.assets) {
    if (a.mode === 'bundled') {
      const rel = assetBundlePath(a)
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
    isPath: (n) => m.variables.find((v) => v.name === n)?.kind === 'path',
    builtin: (n) => folders[n],
    missing: (kind, name) => missingSeen.add(`${kind}:${name}`),
  }

  const colIds = new Set(o.collections ?? m.collections.map((c) => c.id))
  const keptSecrets = new Set<string>()
  const profIds = new Set(o.profiles ?? m.profiles.map((c) => c.id))
  const usedCollections: any[] = []
  const takenNames = (dir: string, ext: string): Set<string> => {
    try { return new Set(fs.readdirSync(dir).map((f) => (ext ? f.replace(new RegExp(`${ext}$`), '') : f))) } catch { return new Set() }
  }

  const planFile = (path: string, data: Buffer, kind: PlannedWrite['kind'], action: WriteAction): void => {
    writes.push({ path, data, action, kind, backupOf: action === 'replace' && fs.existsSync(path) ? path : undefined })
  }

  for (const w of projectWrites) {
    const dest = p.join(w.folder, ...w.rel.split('/'))
    let same = false
    try { same = fs.readFileSync(dest).equals(w.data) } catch { /* not there yet */ }
    if (!same) planFile(dest, w.data, 'project', fs.existsSync(dest) ? 'replace' : 'create')
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
    // this platform's own saved version of each capture source, where the setup has one
    const variants = resolveJson(parseVariants(bundle.files.get(variantsPathFor(c.file))), resolver, target)
    for (const u of applyVariants(json, variants, target)) {
      subs.push({ source: u.source, from: u.id, to: u.id, result: 'variant', note: `Using the ${target === 'win32' ? 'Windows' : target === 'darwin' ? 'macOS' : 'Linux'} version saved in this setup.` })
    }
    adaptSources(json, m, target, adaptCtx, subs)
    usedCollections.push(json)
    let name = c.name
    // the file keeps the name OBS gave it (other tools may look for it), unless the person asked to keep both
    const fileBase = sanitizeFileName(c.fileName ?? name)
    let file = p.join(scenesDir, fileBase + '.json')
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
      activeCollectionFile = action === 'keep-both' ? sanitizeFileName(name) : fileBase
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
    let encoderFixes: EncoderFix[] = []
    // this system's own copy of the encoder and audio device settings, when the setup has one
    const mine = parseProfileVariants(bundle.files.get(`${prefix}${PROFILE_VARIANTS_FILE}`))[target]
    let name = pr.name
    let dirName = sanitizeFileName(pr.dirName ?? name)
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
      if (fname === PROFILE_VARIANTS_FILE) continue // the setup's own bookkeeping, not an OBS file
      const src: Buffer = mine?.files?.[fname] !== undefined ? Buffer.from(mine.files[fname]) : data
      let out: Buffer = src
      const dest = p.join(profRoot, dirName, fname)
      if (fname.endsWith('.json') && encoderFixes.some((f) => f.resets === fname)) {
        out = Buffer.from('{}\n') // settings of an encoder that is no longer used
      } else if (fname.endsWith('.json')) {
        try {
          const json = resolveJson(JSON.parse(src.toString('utf8')), resolver, target)
          // A secret you did not type in must not wipe the one OBS already has: keep what is in the file being replaced.
          let existing: unknown
          try { existing = JSON.parse(fs.readFileSync(dest, 'utf8')) } catch { /* nothing there yet */ }
          for (const v of m.variables) {
            if (v.kind !== 'secret' || answers[v.name] !== undefined || !v.target?.startsWith(`${key}#`)) continue
            const at = v.target.slice(key.length + 1).split('.')
            const old = getAt(existing, at)
            if (typeof old === 'string' && old !== '' && setAt(json, at, old)) keptSecrets.add(v.name)
          }
          out = Buffer.from(JSON.stringify(json, null, 4) + '\n')
        } catch { /* keep raw */ }
      } else if (fname === 'basic.ini') {
        let t = mapIniValues(applyPlatformPart(src.toString('utf8'), mine), (_s, _k, v) => resolveString(v, resolver, target))
        t = setIni(t, 'General', 'Name', name)
        // an encoder this OBS does not have leaves the Settings window with empty boxes and no OK: swap it for one every OBS has
        const fixed = fixEncoders(t, { available: encodersHere, target })
        encoderFixes = fixed.fixes
        for (const f of fixed.fixes) warnings.push(`“${name}”: the ${f.label} (${f.from}) is not available in this OBS, so ${f.to} is used instead. Check it under Settings, Output.`)
        out = Buffer.from(fixed.text)
      }
      // Replacing a profile replaces its files one by one; each one is backed up.
      planFile(dest, out, 'profile-file', fs.existsSync(dest) ? 'replace' : action === 'keep-both' ? 'keep-both' : 'create')
    }
    if (m.activeProfile === pr.id || !activeProfileDir) { activeProfileDir = dirName; activeProfileName = name }
  }

  // make the import the one OBS opens with (user.ini on OBS 31 and newer, global.ini before)
  if (o.activate && (activeCollectionFile || activeProfileDir)) {
    for (const gp of activeTargets(cfg, p.join)) {
      let t = ''
      try { t = fs.readFileSync(gp, 'utf8') } catch { /* OBS never ran */ }
      t = withActive(t, { collection: activeCollectionName, collectionFile: activeCollectionFile, profile: activeProfileName, profileDir: activeProfileDir })
      planFile(gp, Buffer.from(t), 'global', fs.existsSync(gp) ? 'replace' : 'create')
    }
  }

  for (const k of missingSeen) {
    const [kind, name] = k.split(/:(.*)/s)
    if (kind === 'builtin') warnings.push(`Unknown folder token {{${name}}}.`)
  }
  // OBS's remote-control (WebSocket) settings: the same rules as a profile's JSON (typed beats the file; nothing typed keeps what is there)
  const wsData = bundle.files.get(WEBSOCKET_FILE)
  if (wsData && o.websocket !== false) {
    const dest = p.join(cfg, 'plugin_config', 'obs-websocket', 'config.json')
    try {
      const json = resolveJson(JSON.parse(wsData.toString('utf8')), resolver, target)
      let existing: unknown
      try { existing = JSON.parse(fs.readFileSync(dest, 'utf8')) } catch { /* none yet */ }
      for (const v of m.variables) {
        if (v.kind !== 'secret' || answers[v.name] !== undefined || !v.target?.startsWith(`${WEBSOCKET_FILE}#`)) continue
        const at = v.target.slice(WEBSOCKET_FILE.length + 1).split('.')
        const old = getAt(existing, at)
        if (typeof old === 'string' && old !== '' && setAt(json, at, old)) keptSecrets.add(v.name)
      }
      const pwVar = m.variables.find((v) => v.kind === 'secret' && v.target?.startsWith(`${WEBSOCKET_FILE}#`))
      const pw = pwVar ? getAt(json, pwVar.target!.slice(WEBSOCKET_FILE.length + 1).split('.')) : undefined
      if (pwVar && (json as any)?.auth_required !== false && (typeof pw !== 'string' || pw === '')) {
        // a remote-control file that demands a password and has none would lock every program out: leave OBS's own settings alone
        warnings.push('OBS\'s remote-control settings (WebSocket) were not put back, because they need a password and none was given. Type it in the list of passwords, or set it in OBS under Tools, WebSocket Server Settings.')
      } else planFile(dest, Buffer.from(JSON.stringify(json, null, 4) + '\n'), 'websocket', fs.existsSync(dest) ? 'replace' : 'create')
    } catch { warnings.push('The remote-control settings in this setup could not be read, so they were left as they are.') }
  }
  const scripts = m.assets.filter((a) => a.role === 'script')
  if (scripts.length) {
    warnings.push(`This setup runs ${scripts.length === 1 ? 'a script' : scripts.length + ' scripts'} (${scripts.map((s) => s.filename).join(', ')}). The scripts are put back, but OBS needs Python (or Lua) set up under Tools, then Scripts, for them to run.`)
  }
  warnings.push(...versionNotes(m, o.installed))
  const plugins = checkPlugins(m.plugins, installedMods, target)
  if (target === 'linux' && subs.some((x) => x.to && isPipewireAudioId(x.to)) && !installedMods.has(PIPEWIRE_AUDIO_MODULE)) {
    const how = KNOWN_PLUGINS.find((k) => k.id === 'obs-pipewire-audio-capture')?.install
    warnings.push(`Some audio sources became PipeWire audio sources, which need the PipeWire Audio Capture plugin, and it is not installed in this OBS. ${(install.kind === 'flatpak' ? how?.['linux-flatpak'] : how?.['linux-native']) ?? ''}`.trim())
  }
  if (m.source?.platform && m.source.platform !== target) {
    const sys = (x: string) => (x === 'win32' ? 'Windows' : x === 'darwin' ? 'a Mac' : 'Linux')
    warnings.push(`This setup was made on ${sys(m.source.platform)} and is going into ${sys(target)}, so screen, window and sound capture and device choices need checking (listed below).`)
  }

  return {
    writes,
    report: {
      assetLocations: Object.fromEntries(assetPath), willWrite: writes.map((w) => ({ path: w.path, action: w.action })),
      missingVariables: missingVariables.filter((v) => !keptSecrets.has(v.name)), keptSecrets: [...keptSecrets], containsSecrets: m.containsSecrets === true,
      includedSecrets: Object.keys(included).filter((n) => (o.variables ?? {})[n] === undefined), usedDefaults, missingAssets, plugins, substitutions: subs, warnings, blockers, backupDir,
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
