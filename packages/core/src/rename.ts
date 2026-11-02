import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { readBundleDir, serializeManifest } from './bundleIO.js'
import { slug } from './export.js'
import { getIni, setIni } from './ini.js'
import { variantsPathFor, type VariantsFile } from './variants.js'

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
  const b = readBundleDir(dir)
  if (b.manifest.name === name) return []
  b.manifest.name = name
  writeManifest(dir, b.manifest)
  return ['manifest.json']
}

/** A scene layout (OBS: "Scene Collection"). Its file and the per-OS file next to it are renamed with it. */
export function renameSceneLayout(dir: string, id: string, newName: string): string[] {
  const name = need(newName)
  const b = readBundleDir(dir)
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
  c.id = newId; const oldName = c.name; c.name = name; c.file = newFile
  if (b.manifest.exclude?.collections?.includes(oldName)) b.manifest.exclude.collections = b.manifest.exclude.collections.map((n) => (n === oldName ? name : n))
  if (b.manifest.activeCollection === id) b.manifest.activeCollection = newId
  writeManifest(dir, b.manifest)
  return changed
}

/** An output setting (OBS: "Profile"). Its folder is renamed and the name inside its basic.ini too. */
export function renameOutputSetting(dir: string, id: string, newName: string): string[] {
  const name = need(newName)
  const b = readBundleDir(dir)
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
  p.id = newId; p.name = name; p.dir = newDir
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
  const b = readBundleDir(dir)
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
  const b = readBundleDir(dir)
  const c = b.manifest.collections.find((x) => x.id === collectionId)
  if (!c) return { scenes: [], sources: [] }
  const json = JSON.parse(fs.readFileSync(nodePath.join(dir, c.file), 'utf8'))
  const all: any[] = json.sources ?? []
  return { scenes: all.filter((s) => s.id === 'scene').map((s) => s.name), sources: all.filter((s) => s.id !== 'scene').map((s) => s.name) }
}

// ── the same renames, in an OBS settings folder ──────────────────────────────

const fileSafe = (n: string) => n.replace(/[\\/:*?"<>|\0]/g, '_')

/**
 * Rename a scene layout in an OBS settings folder (its file, the name inside it, and the "current" choice in global.ini).
 * OBS must not be running: it rewrites its files when it quits and would undo this.
 */
export function renameLayoutInObs(configDir: string, from: string, newName: string): void {
  const to = need(newName)
  const dir = nodePath.join(configDir, 'basic', 'scenes')
  const src = nodePath.join(dir, fileSafe(from) + '.json'), dst = nodePath.join(dir, fileSafe(to) + '.json')
  if (!fs.existsSync(src)) throw new RenameError(`OBS has no scene layout called “${from}”.`)
  if (src !== dst && fs.existsSync(dst)) throw new RenameError(`OBS already has a scene layout called “${to}”.`)
  const json = JSON.parse(fs.readFileSync(src, 'utf8')); json.name = to
  fs.writeFileSync(dst, JSON.stringify(json, null, 4) + '\n')
  if (src !== dst) fs.rmSync(src)
  const g = nodePath.join(configDir, 'global.ini')
  if (fs.existsSync(g)) {
    let t = fs.readFileSync(g, 'utf8')
    if (getIni(t, 'Basic', 'SceneCollection') === from) t = setIni(t, 'Basic', 'SceneCollection', to)
    if (getIni(t, 'Basic', 'SceneCollectionFile') === fileSafe(from)) t = setIni(t, 'Basic', 'SceneCollectionFile', fileSafe(to))
    fs.writeFileSync(g, t)
  }
}

/** Rename output settings in an OBS settings folder (folder, the name in basic.ini, global.ini). */
export function renameOutputInObs(configDir: string, from: string, newName: string): void {
  const to = need(newName)
  const root = nodePath.join(configDir, 'basic', 'profiles')
  const src = nodePath.join(root, fileSafe(from)), dst = nodePath.join(root, fileSafe(to))
  if (!fs.existsSync(src)) throw new RenameError(`OBS has no output settings called “${from}”.`)
  if (src !== dst && fs.existsSync(dst)) throw new RenameError(`OBS already has output settings called “${to}”.`)
  if (src !== dst) fs.renameSync(src, dst)
  const ini = nodePath.join(dst, 'basic.ini')
  if (fs.existsSync(ini)) fs.writeFileSync(ini, setIni(fs.readFileSync(ini, 'utf8'), 'General', 'Name', to))
  const g = nodePath.join(configDir, 'global.ini')
  if (fs.existsSync(g)) {
    let t = fs.readFileSync(g, 'utf8')
    if (getIni(t, 'Basic', 'Profile') === from) t = setIni(t, 'Basic', 'Profile', to)
    if (getIni(t, 'Basic', 'ProfileDir') === fileSafe(from)) t = setIni(t, 'Basic', 'ProfileDir', fileSafe(to))
    fs.writeFileSync(g, t)
  }
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

export const obsHasLayout = (configDir: string, name: string) => fs.existsSync(nodePath.join(configDir, 'basic', 'scenes', fileSafe(name) + '.json'))
export const obsHasOutput = (configDir: string, name: string) => fs.existsSync(nodePath.join(configDir, 'basic', 'profiles', fileSafe(name)))
