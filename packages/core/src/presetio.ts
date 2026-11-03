import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import JSZip from 'jszip'
import { BundleError, LOCAL_DIR, readBundleDir } from './bundleIO.js'
import { assetBundlePath, attachSecrets } from './export.js'
import {
  cloudSkippedPaths, isSkipped, localMediaLocations, localMediaPath, readLocalKeys, safeSegment, readLocalSettings, writeExclude, writeLocalKeys, writeLocalSettings, type CloudSkip,
} from './local.js'
import type { Bundle } from './types.js'

export const SMALL_FILE = 5 * 1024 * 1024

// ── a setup file made from a preset ─────────────────────────────────────────

export interface PresetFileOptions {
  dir: string
  /** Put this preset's stream keys inside the file (clearly labelled). */
  includeKeys?: boolean
  /** Big files (asset ids) to put inside. Files up to 5 MB always go in. */
  bigFiles?: string[]
  /** Where else this computer knows the files are (asset id -> path), besides the preset's own copies. */
  locations?: Record<string, string>
  /**
   * `true`: whoever opens the file gets a preset of their own (a new identity, no link to your online copy), so they back it up
   * to their own GitHub and your history and theirs never meet. `false`: the file stays one with this preset (same identity,
   * and the online address when there is one), which suits moving it between your own computers.
   */
  independent?: boolean
  /** The online address of this preset (no password in it), for a file that stays linked. */
  repository?: string
}

export interface PresetFile { bundle: Bundle; keys: number; missingMedia: string[] }

/** Read a preset and make the bundle for a file: its files, the chosen big files, optionally the stream keys. */
export function buildPresetFile(o: PresetFileOptions): PresetFile {
  const b = readBundleDir(o.dir)
  const own = localMediaLocations(o.dir, b.manifest)
  const chosen = new Set(o.bigFiles ?? [])
  for (const a of b.manifest.assets) {
    if (a.role === 'script') continue
    const have = b.files.has(assetBundlePath(a))
    const f = [own[a.id], o.locations?.[a.id]].find((x) => x && fs.existsSync(x))
    if (!have && f && (fs.statSync(f).size <= SMALL_FILE || chosen.has(a.id))) { a.mode = 'bundled'; b.files.set(assetBundlePath(a), fs.readFileSync(f)) }
    else if (have) a.mode = 'bundled'
  }
  delete b.manifest.exclude // the file is a complete copy of what it holds; leave-outs belong to the preset, not to the file
  delete b.manifest.repository
  if (o.independent) b.manifest.id = crypto.randomUUID()
  else if (o.repository) b.manifest.repository = { url: o.repository }
  const keys = o.includeKeys ? attachSecrets(b, readLocalKeys(o.dir)) : 0
  return { bundle: b, keys, missingMedia: b.manifest.assets.filter((a) => a.mode === 'external').map((a) => a.filename) }
}

/**
 * The files a preset can put in a setup file: every file the scenes use, with the size and whether this computer has it.
 */
export function presetFiles(dir: string, locations: Record<string, string> = {}): { id: string; filename: string; size: number; available: boolean; auto: boolean }[] {
  const m = readBundleDir(dir).manifest
  const own = localMediaLocations(dir, m)
  return m.assets.filter((a) => a.role !== 'script').map((a) => {
    const f = [own[a.id], locations[a.id]].find((x) => x && fs.existsSync(x))
    const size = f ? fs.statSync(f).size : a.size ?? 0
    return { id: a.id, filename: a.filename, size, available: !!f, auto: !!f && size <= SMALL_FILE }
  })
}

/** Take the stream keys and the files out of a bundle that was opened, and put them into the preset made from it. */
export function keepBundleLocals(dir: string, b: Bundle, secrets: Record<string, string>): { keys: number; media: number } {
  const keys = Object.keys(secrets).length ? writeLocalKeys(dir, secrets) : 0
  let media = 0
  for (const a of b.manifest.assets) {
    const data = b.files.get(assetBundlePath(a))
    if (!data || a.role === 'script' || !safeSegment(a.id) || !safeSegment(a.filename)) continue
    const dest = localMediaPath(dir, a.id, a.filename)
    fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, data)
    media++
  }
  return { keys, media }
}

// ── the companion file: only what the online copy does not have ──────────────

export const EXTRAS_FORMAT = 'obs-config-extras'
export const EXTRAS_EXT = 'obsextras'

export interface ExtrasManifest {
  format: typeof EXTRAS_FORMAT
  version: 1
  /** The preset this belongs with (its manifest id). */
  presetId: string
  presetName: string
  createdAt: string
  /** Parts of the preset that are not uploaded: files inside the preset, and which parts they are. */
  files: string[]
  cloudSkip?: CloudSkip
  /** Files (big ones mostly) the scenes use, kept under `media/<id>/<file>`. */
  media: { id: string; filename: string; size: number }[]
  containsSecrets?: boolean
  warning?: string
  /** Stream keys by variable name. Only when the person chose to include them. */
  keys?: Record<string, string>
}

export interface ExtrasOptions {
  dir: string
  includeKeys?: boolean
  /** Files (asset ids) to put in. Default: every file this computer has. */
  mediaIds?: string[]
  locations?: Record<string, string>
}

export interface ExtrasContent {
  /** What would go in, for showing before the file is made. */
  files: string[]
  media: { id: string; filename: string; size: number; path: string }[]
  keys: number
  cloudSkip?: CloudSkip
}

/** What the companion file of a preset would hold: the parts that are not uploaded, the files, the keys. */
export function extrasContent(dir: string, locations: Record<string, string> = {}): ExtrasContent {
  const b = readBundleDir(dir)
  const settings = readLocalSettings(dir)
  const skipped = cloudSkippedPaths(settings.cloud?.skip)
  const uploaded = new Set(settings.cloud?.media ?? [])
  const own = localMediaLocations(dir, b.manifest)
  const files = [...b.files.keys()].filter((f) => isSkipped(f, skipped)).sort()
  const media: ExtrasContent['media'] = []
  for (const a of b.manifest.assets) {
    if (a.role === 'script' || uploaded.has(a.id)) continue
    const f = [own[a.id], locations[a.id]].find((x) => x && fs.existsSync(x))
    if (f) media.push({ id: a.id, filename: a.filename, size: fs.statSync(f).size, path: f })
  }
  return { files, media, keys: Object.keys(readLocalKeys(dir)).length, ...(settings.cloud?.skip ? { cloudSkip: settings.cloud.skip } : {}) }
}

/** Write the companion file. Files are streamed from disk, so a multi-gigabyte video does not fill memory. */
export async function writeExtras(o: ExtrasOptions, outPath: string): Promise<{ files: number; media: number; keys: number; bytes: number }> {
  const b = readBundleDir(o.dir)
  const c = extrasContent(o.dir, o.locations)
  const want = o.mediaIds ? new Set(o.mediaIds) : undefined
  const media = c.media.filter((m) => !want || want.has(m.id))
  const keys = o.includeKeys ? readLocalKeys(o.dir) : {}
  const m: ExtrasManifest = {
    format: EXTRAS_FORMAT, version: 1, presetId: b.manifest.id, presetName: b.manifest.name, createdAt: new Date().toISOString(),
    files: c.files, ...(c.cloudSkip ? { cloudSkip: c.cloudSkip } : {}),
    media: media.map(({ id, filename, size }) => ({ id, filename, size })),
    ...(Object.keys(keys).length ? {
      containsSecrets: true, keys,
      warning: 'This file contains your stream keys. Anyone who has it can stream as you. Keep it private and delete it once you have used it.',
    } : {}),
  }
  const zip = new JSZip()
  zip.file('extras.json', JSON.stringify(m, null, 2) + '\n')
  for (const f of c.files) zip.file(`files/${f}`, b.files.get(f)!)
  for (const x of media) zip.file(`media/${x.id}/${x.filename}`, fs.createReadStream(x.path), { binary: true })
  fs.mkdirSync(nodePath.dirname(outPath), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outPath)
    zip.generateNodeStream({ streamFiles: true, compression: 'STORE' }).pipe(out).on('finish', () => resolve()).on('error', reject)
    out.on('error', reject)
  })
  return { files: c.files.length, media: media.length, keys: Object.keys(keys).length, bytes: fs.statSync(outPath).size }
}

export interface Extras { manifest: ExtrasManifest; zip: JSZip }

export async function readExtras(file: string): Promise<Extras> {
  let buf: Buffer
  try { buf = fs.readFileSync(file) } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_FS_FILE_TOO_LARGE') throw new BundleError('This file is bigger than 2 GB, which this app cannot open in one go. Copy the big files into the preset by hand instead.', 'invalid')
    throw e
  }
  const zip = await JSZip.loadAsync(buf)
  const f = zip.file('extras.json')
  if (!f) throw new BundleError('This is not an extras file (no extras.json inside).', 'not-a-bundle')
  let m: ExtrasManifest
  try { m = JSON.parse(await f.async('string')) } catch { throw new BundleError('extras.json is not valid JSON.', 'invalid') }
  if (m.format !== EXTRAS_FORMAT) throw new BundleError('This is not an extras file.', 'not-a-bundle')
  if (m.version > 1) throw new BundleError('This extras file is from a newer version of the app. Update the app first.', 'too-new')
  return { manifest: m, zip }
}

export interface ExtrasApplied { files: number; media: number; keys: number }

/** Put an extras file into the preset it belongs with. Refuses a different preset. Never overwrites a file the preset already has. */
export async function applyExtras(dir: string, x: Extras): Promise<ExtrasApplied> {
  const here = readBundleDir(dir).manifest
  if (here.id !== x.manifest.presetId) throw new BundleError(`This file belongs with the preset “${x.manifest.presetName}”, not with “${here.name}”.`, 'invalid')
  let files = 0, media = 0
  // the parts that are not uploaded stay out of git here too
  if (x.manifest.cloudSkip) {
    const s = readLocalSettings(dir)
    const cur = s.cloud?.skip ?? {}
    const add = x.manifest.cloudSkip
    s.cloud = { ...s.cloud, skip: {
      layouts: [...new Set([...(cur.layouts ?? []), ...(add.layouts ?? [])])], outputs: [...new Set([...(cur.outputs ?? []), ...(add.outputs ?? [])])],
      scripts: cur.scripts || add.scripts, remoteControl: cur.remoteControl || add.remoteControl,
    } }
    writeLocalSettings(dir, s)
    writeExclude(dir, cloudSkippedPaths(s.cloud.skip))
  }
  for (const f of x.manifest.files) {
    const rel = f.replace(/\\/g, '/')
    if (rel.startsWith('/') || rel.split('/').includes('..') || rel === 'manifest.json' || rel.startsWith(`${LOCAL_DIR}/`) || rel.startsWith('.git')) continue
    const entry = x.zip.file(`files/${rel}`)
    if (!entry) continue
    const dest = nodePath.join(dir, rel)
    if (fs.existsSync(dest)) continue
    fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, await entry.async('nodebuffer'))
    files++
  }
  for (const m of x.manifest.media) {
    const entry = x.zip.file(`media/${m.id}/${m.filename}`)
    if (!entry || !safeSegment(m.id) || !safeSegment(m.filename)) continue
    const dest = localMediaPath(dir, m.id, m.filename)
    fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, await entry.async('nodebuffer'))
    media++
  }
  const keys = x.manifest.containsSecrets && x.manifest.keys ? writeLocalKeys(dir, x.manifest.keys) : 0
  return { files, media, keys }
}
