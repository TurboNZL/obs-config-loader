import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { readBundleDir, serializeManifest } from './bundleIO.js'
import { slug } from './export.js'
import { setIni } from './ini.js'
import { renameActive } from './userconfig.js'
import { variantsPathFor, type VariantsFile } from './variants.js'
import { sourceKeyOf } from './import.js'
import { isPlatformSpecific } from './sources.js'
import { unversioned } from './plugins.js'

/**
 * Renaming inside a saved preset (a setup folder). Everything that mentions the old name is updated together so the
 * preset stays consistent; the caller commits the changed files. Loading the preset into OBS then uses the new names.
 */
export class RenameError extends Error {}

const cleanName = (s: string) => s.trim()
function need(name: string): string {
  const n = cleanName(name)
  if (!n) throw new RenameError('Type a name first.')
  if (/[\\/:*?"<>|\0]/.test(n)) throw new RenameError('A name cannot contain any of these characters: \\ / : * ? " < > |')
  return n
}

function writeManifest(dir: string, m: unknown) {
  fs.writeFileSync(nodePath.join(dir, 'manifest.json'), serializeManifest(m as never))
}

/** The preset's own name (what the list shows). */
export function renamePreset(dir: string, newName: string): string[] {
  const name = need(newName)
  const b = readBundleDir(dir, { keepMissing: true })
  if (b.manifest.name === name) return []
  b.manifest.name = name
  writeManifest(dir, b.manifest)
  return ['manifest.json']
}

/** A scene layout (OBS: "Scene Collection"). Its file and the per-OS file next to it are renamed with it. */
export function renameSceneLayout(dir: string, id: string, newName: string): string[] {
  const name = need(newName)
  const b = readBundleDir(dir, { keepMissing: true })
  const c = b.manifest.collections.find((x) => x.id === id)
  if (!c) throw new RenameError('That scene layout is not in this preset any more.')
  if (c.name === name) return []
  if (b.manifest.collections.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new RenameError(`This preset already has a scene layout called “${name}”.`)
  const newId = slug(name)
  const taken = b.manifest.collections.some((x) => x.id !== id && x.id === newId)
  if (taken) throw new RenameError(`“${name}” is too close to another scene layout's name. Pick a different name.`)
  const newFile = `collections/${newId}.json`
  const changed = ['manifest.json']
  const raw = JSON.parse(fs.readFileSync(nodePath.join(dir, c.file), 'utf8'))
  raw.name = name
  fs.writeFileSync(nodePath.join(dir, newFile), JSON.stringify(raw, null, 4) + '\n')
  if (newFile !== c.file) fs.rmSync(nodePath.join(dir, c.file))
  const vOld = nodePath.join(dir, variantsPathFor(c.file))
  if (fs.existsSync(vOld) && newFile !== c.file) fs.renameSync(vOld, nodePath.join(dir, variantsPathFor(newFile)))
  changed.push(c.file, newFile)
  c.id = newId; const oldName = c.name; c.name = name; c.file = newFile; delete c.fileName // OBS names the file after the new name now
  if (b.manifest.exclude?.collections?.includes(oldName)) b.manifest.exclude.collections = b.manifest.exclude.collections.map((n) => (n === oldName ? name : n))
  if (b.manifest.activeCollection === id) b.manifest.activeCollection = newId
  writeManifest(dir, b.manifest)
  return changed
}

/** An output setting (OBS: "Profile"). Its folder is renamed and the name inside its basic.ini too. */
export function renameOutputSetting(dir: string, id: string, newName: string): string[] {
  const name = need(newName)
  const b = readBundleDir(dir, { keepMissing: true })
  const p = b.manifest.profiles.find((x) => x.id === id)
  if (!p) throw new RenameError('That output setting is not in this preset any more.')
  if (p.name === name) return []
  if (b.manifest.profiles.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new RenameError(`This preset already has output settings called “${name}”.`)
  const newId = slug(name)
  if (b.manifest.profiles.some((x) => x.id !== id && x.id === newId)) throw new RenameError(`“${name}” is too close to another one's name. Pick a different name.`)
  const newDir = `profiles/${newId}`
  const ini = nodePath.join(dir, p.dir, 'basic.ini')
  if (fs.existsSync(ini)) fs.writeFileSync(ini, setIni(fs.readFileSync(ini, 'utf8'), 'General', 'Name', name))
  if (newDir !== p.dir) fs.renameSync(nodePath.join(dir, p.dir), nodePath.join(dir, newDir))
  const old = p.dir
  const oldName = p.name
  p.id = newId; p.name = name; p.dir = newDir; delete p.dirName
  if (b.manifest.exclude?.profiles?.includes(oldName)) b.manifest.exclude.profiles = b.manifest.exclude.profiles.map((n) => (n === oldName ? name : n))
  if (b.manifest.activeProfile === id) b.manifest.activeProfile = newId
  writeManifest(dir, b.manifest)
  return ['manifest.json', old, newDir]
}

/** Every place in a scene layout that points at a source by its name. */
export function renameSourceInJson(json: any, from: string, to: string): number {
  let n = 0
  for (const s of json.sources ?? []) {
    if (s?.name === from) { s.name = to; n++ }
    for (const it of s?.settings?.items ?? []) if (it?.name === from) { it.name = to; n++ }
  }
  for (const s of json.scene_order ?? []) if (s?.name === from) { s.name = to; n++ }
  for (const k of ['current_scene', 'current_program_scene', 'current_preview_scene']) if (json[k] === from) { json[k] = to; n++ }
  return n
}

/** A scene or any other source inside one scene layout. Everything that uses it keeps working under the new name. */
export function renameSceneOrSource(dir: string, collectionId: string, from: string, newName: string): string[] {
  const to = need(newName)
  const b = readBundleDir(dir, { keepMissing: true })
  const c = b.manifest.collections.find((x) => x.id === collectionId)
  if (!c) throw new RenameError('That scene layout is not in this preset any more.')
  const full = nodePath.join(dir, c.file)
  const json = JSON.parse(fs.readFileSync(full, 'utf8'))
  if (!(json.sources ?? []).some((s: any) => s.name === from)) throw new RenameError(`“${from}” is not in this scene layout.`)
  if (from === to) return []
  if ((json.sources ?? []).some((s: any) => s.name === to)) throw new RenameError(`There is already something called “${to}” in this scene layout.`)
  renameSourceInJson(json, from, to)
  fs.writeFileSync(full, JSON.stringify(json, null, 4) + '\n')
  const changed = [c.file]
  const vp = nodePath.join(dir, variantsPathFor(c.file))
  if (fs.existsSync(vp)) {
    const v = JSON.parse(fs.readFileSync(vp, 'utf8')) as VariantsFile
    if (v[from]) {
      v[to] = v[from]; delete v[from]
      fs.writeFileSync(vp, JSON.stringify(v, null, 2) + '\n')
      changed.push(variantsPathFor(c.file))
    }
  }
  return changed
}

/** Names of the scenes and other things in a saved scene layout, for the rename list. */
export function listNames(dir: string, collectionId: string): { scenes: string[]; sources: string[] } {
  const b = readBundleDir(dir, { keepMissing: true })
  const c = b.manifest.collections.find((x) => x.id === collectionId)
  if (!c) return { scenes: [], sources: [] }
  const json = JSON.parse(fs.readFileSync(nodePath.join(dir, c.file), 'utf8'))
  const all: any[] = json.sources ?? []
  return { scenes: all.filter((s) => s.id === 'scene').map((s) => s.name), sources: all.filter((s) => s.id !== 'scene').map((s) => s.name) }
}

/**
 * Sources in a saved scene layout that only exist on some systems (screen, window and sound capture): what the translation
 * settings are about. `kind` is the source id a choice for the whole kind is stored under; `key` is this source's own.
 */
export function listPlatformSources(dir: string, collectionId: string): { key: string; name: string; kind: string }[] {
  const b = readBundleDir(dir, { keepMissing: true })
  const c = b.manifest.collections.find((x) => x.id === collectionId)
  if (!c) return []
  let json: any
  try { json = JSON.parse(fs.readFileSync(nodePath.join(dir, c.file), 'utf8')) } catch { return [] }
  const out: { key: string; name: string; kind: string }[] = []
  for (const s of json.sources ?? []) {
    if (typeof s?.id !== 'string' || s.id === 'scene') continue
    const kind = isPlatformSpecific(s.id) ? s.id : unversioned(s.id)
    if (!isPlatformSpecific(kind)) continue
    out.push({ key: sourceKeyOf(s), name: String(s.name ?? ''), kind })
  }
  return out
}

// ── the same renames, in an OBS settings folder ──────────────────────────────

const fileSafe = (n: string) => n.replace(/[\\/:*?"<>|\0]/g, '_')

/**
 * Rename a scene layout in an OBS settings folder (its file, the name inside it, and the "current" choice in global.ini).
 * OBS must not be running: it rewrites its files when it quits and would undo this.
 */
export function renameLayoutInObs(configDir: string, from: string, newName: string, fromFile: string = from): void {
  const to = need(newName)
  const dir = nodePath.join(configDir, 'basic', 'scenes')
  const src = nodePath.join(dir, fileSafe(fromFile) + '.json'), dst = nodePath.join(dir, fileSafe(to) + '.json')
  if (!fs.existsSync(src)) throw new RenameError(`OBS has no scene layout called “${from}”.`)
  if (src !== dst && fs.existsSync(dst)) throw new RenameError(`OBS already has a scene layout called “${to}”.`)
  const json = JSON.parse(fs.readFileSync(src, 'utf8')); json.name = to
  fs.writeFileSync(dst, JSON.stringify(json, null, 4) + '\n')
  if (src !== dst) fs.rmSync(src)
  renameActive(configDir, 'collection', from, fileSafe(fromFile), to, fileSafe(to))
}

/** Rename output settings in an OBS settings folder (folder, the name in basic.ini, global.ini). */
export function renameOutputInObs(configDir: string, from: string, newName: string, fromDir: string = from): void {
  const to = need(newName)
  const root = nodePath.join(configDir, 'basic', 'profiles')
  const src = nodePath.join(root, fileSafe(fromDir)), dst = nodePath.join(root, fileSafe(to))
  if (!fs.existsSync(src)) throw new RenameError(`OBS has no output settings called “${from}”.`)
  if (src !== dst && fs.existsSync(dst)) throw new RenameError(`OBS already has output settings called “${to}”.`)
  if (src !== dst) fs.renameSync(src, dst)
  const ini = nodePath.join(dst, 'basic.ini')
  if (fs.existsSync(ini)) fs.writeFileSync(ini, setIni(fs.readFileSync(ini, 'utf8'), 'General', 'Name', to))
  renameActive(configDir, 'profile', from, fileSafe(fromDir), to, fileSafe(to))
}

/** Rename a scene or source inside one scene layout in an OBS settings folder. Returns false when OBS has no such thing. */
export function renameSourceInObs(configDir: string, layout: string, from: string, newName: string): boolean {
  const to = need(newName)
  const file = nodePath.join(configDir, 'basic', 'scenes', fileSafe(layout) + '.json')
  if (!fs.existsSync(file)) return false
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!(json.sources ?? []).some((s: any) => s.name === from)) return false
  if ((json.sources ?? []).some((s: any) => s.name === to)) throw new RenameError(`There is already something called “${to}” in OBS's scene layout “${layout}”.`)
  renameSourceInJson(json, from, to)
  fs.writeFileSync(file, JSON.stringify(json, null, 4) + '\n')
  return true
}

/** Paths in this OBS's scenes that point at a file that is not there (a renamed or moved file shows up here). */
export function missingFilesInObs(configDir: string): string[] {
  const dir = nodePath.join(configDir, 'basic', 'scenes')
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { return [] }
  const found = new Set<string>()
  const walk = (o: any): void => {
    if (typeof o === 'string') { if (/^(\/|[A-Za-z]:[\\/])/.test(o) && /\.[A-Za-z0-9]{1,5}$/.test(o) && !fs.existsSync(o)) found.add(o) }
    else if (Array.isArray(o)) o.forEach(walk)
    else if (o && typeof o === 'object') Object.values(o).forEach(walk)
  }
  for (const f of files) { try { walk(JSON.parse(fs.readFileSync(nodePath.join(dir, f), 'utf8').replace(/^\uFEFF/, ''))) } catch { /* not readable: nothing to learn */ } }
  return [...found]
}

/**
 * A file the scenes use was renamed or moved: point every source at the new path (exact matches only), in every scene layout of an
 * OBS settings folder. OBS must not be running. Returns how many places were changed.
 */
export function replacePathInObs(configDir: string, from: string, to: string): number {
  const dir = nodePath.join(configDir, 'basic', 'scenes')
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { return 0 }
  const same = (a: string) => a === from || a.replace(/\\/g, '/') === from.replace(/\\/g, '/')
  let changed = 0
  for (const f of files) {
    let json: any
    try { json = JSON.parse(fs.readFileSync(nodePath.join(dir, f), 'utf8').replace(/^\uFEFF/, '')) } catch { continue }
    let n = 0
    const walk = (o: any): any => {
      if (typeof o === 'string') { if (same(o)) { n++; return to } return o }
      if (Array.isArray(o)) return o.map(walk)
      if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]))
      return o
    }
    const next = walk(json)
    if (n) { fs.writeFileSync(nodePath.join(dir, f), JSON.stringify(next, null, 4) + '\n'); changed += n }
  }
  return changed
}

export const obsHasLayout = (configDir: string, name: string) => fs.existsSync(nodePath.join(configDir, 'basic', 'scenes', fileSafe(name) + '.json'))
export const obsHasOutput = (configDir: string, name: string) => fs.existsSync(nodePath.join(configDir, 'basic', 'profiles', fileSafe(name)))

/** Take a scene layout out of the preset (its files too). The preset must keep at least one. OBS itself is not touched. */
export function removeSceneLayout(dir: string, id: string): string[] {
  const b = readBundleDir(dir, { keepMissing: true })
  const c = b.manifest.collections.find((x) => x.id === id)
  if (!c) throw new RenameError('That scene layout is not in this preset any more.')
  if (b.manifest.collections.length <= 1) throw new RenameError('A preset needs at least one scene layout, so the last one cannot be removed.')
  fs.rmSync(nodePath.join(dir, c.file), { force: true })
  fs.rmSync(nodePath.join(dir, variantsPathFor(c.file)), { force: true })
  b.manifest.collections = b.manifest.collections.filter((x) => x.id !== id)
  if (b.manifest.activeCollection === id) b.manifest.activeCollection = b.manifest.collections[0].id
  writeManifest(dir, b.manifest)
  return ['manifest.json', c.file]
}

/** Take output settings (OBS: a profile) out of the preset, with its folder. At least one must stay. */
export function removeOutputSetting(dir: string, id: string): string[] {
  const b = readBundleDir(dir, { keepMissing: true })
  const p = b.manifest.profiles.find((x) => x.id === id)
  if (!p) throw new RenameError('That output setting is not in this preset any more.')
  if (b.manifest.profiles.length <= 1) throw new RenameError('A preset needs at least one set of output settings, so the last one cannot be removed.')
  fs.rmSync(nodePath.join(dir, p.dir), { recursive: true, force: true })
  b.manifest.profiles = b.manifest.profiles.filter((x) => x.id !== id)
  if (b.manifest.activeProfile === id) b.manifest.activeProfile = b.manifest.profiles[0].id
  writeManifest(dir, b.manifest)
  return ['manifest.json', p.dir]
}

/** Which systems a part was saved on (from the per-system files next to it), for telling two look-alikes apart. */
export function systemsSavedOn(dir: string, rel: string): ('win32' | 'darwin' | 'linux')[] {
  try {
    const j = JSON.parse(fs.readFileSync(nodePath.join(dir, rel), 'utf8')) as Record<string, unknown>
    return (['win32', 'darwin', 'linux'] as const).filter((k) => k in j || (k === 'linux' && Object.keys(j).some((x) => x.startsWith('linux'))))
  } catch { return [] }
}
