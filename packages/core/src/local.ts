import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { LOCAL_DIR } from './bundleIO.js'
import { variantsPathFor } from './variants.js'
import type { Manifest } from './types.js'

/**
 * A preset has two parts. The part git tracks (scenes, output settings, scripts, plugin list) can go online. The part in
 * `local/` never leaves this computer: stream keys, copies of the big files the scenes use, and this preset's own choices
 * about what is uploaded. Saving from OBS fills both, so the preset is a complete copy on this computer.
 */

export interface CloudSkip { layouts?: string[]; outputs?: string[]; scripts?: boolean; remoteControl?: boolean }
export interface LocalSettings {
  /** Keep stream keys in this preset (on this computer only). Default yes. */
  keepKeys?: boolean
  /** Files (asset ids) that are NOT copied into the preset. Default: every file is copied. */
  skipLocalMedia?: string[]
  /** Bookkeeping: the parts git was last told to leave out (so a part that is uploaded again can be noticed). */
  kept?: string[]
  cloud?: {
    /** Parts that stay on this computer when the preset is uploaded (scene layout / output settings ids from the manifest). */
    skip?: CloudSkip
    /** Files (asset ids) that ARE uploaded. Default: none (they are big). */
    media?: string[]
  }
}

const SETTINGS = 'settings.json'
const KEYS = 'keys.json'

export const localPath = (dir: string, ...parts: string[]) => nodePath.join(dir, LOCAL_DIR, ...parts)

export function readLocalSettings(dir: string): LocalSettings {
  try { return JSON.parse(fs.readFileSync(localPath(dir, SETTINGS), 'utf8')) as LocalSettings } catch { return {} }
}
export function writeLocalSettings(dir: string, s: LocalSettings): void {
  // the bookkeeping field belongs to the save, not to whoever changes the choices
  if (s.kept === undefined) { const old = readLocalSettings(dir).kept; if (old) s = { ...s, kept: old } }
  fs.mkdirSync(localPath(dir), { recursive: true })
  fs.writeFileSync(localPath(dir, SETTINGS), JSON.stringify(s, null, 2) + '\n')
}

// ── stream keys ──────────────────────────────────────────────────────────────

/** Stream keys kept in this preset, by variable name. */
export function readLocalKeys(dir: string): Record<string, string> {
  try {
    const j = JSON.parse(fs.readFileSync(localPath(dir, KEYS), 'utf8'))
    return j && typeof j === 'object' && j.keys && typeof j.keys === 'object' ? j.keys : {}
  } catch { return {} }
}
/** Add (or update) keys. Keys already kept stay, so a key OBS no longer has is not lost by a save. */
export function writeLocalKeys(dir: string, values: Record<string, string>, replace = false): number {
  const merged = replace ? { ...values } : { ...readLocalKeys(dir), ...values }
  if (!Object.keys(merged).length) { fs.rmSync(localPath(dir, KEYS), { force: true }); return 0 }
  ensureGitIgnoresLocal(dir)
  fs.mkdirSync(localPath(dir), { recursive: true })
  fs.writeFileSync(localPath(dir, KEYS), JSON.stringify({ note: 'Stream keys. They stay on this computer: never uploaded, never in the preset\'s history.', keys: merged }, null, 2) + '\n', { mode: 0o600 })
  return Object.keys(merged).length
}
export function clearLocalKeys(dir: string): void { fs.rmSync(localPath(dir, KEYS), { force: true }) }

// ── copies of the files the scenes use ──────────────────────────────────────

/** A single folder or file name taken from a manifest (which can come from anywhere): no separators, never `.` or `..`. */
export const safeSegment = (s: unknown): s is string => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !/[\\/\0]/.test(s)

export function localMediaPath(dir: string, id: string, filename: string): string {
  if (!safeSegment(id) || !safeSegment(filename)) throw new Error('A file in this setup has a name that is not allowed.')
  return localPath(dir, 'media', id, filename)
}

export interface SeenAsset { id: string; filename: string; path: string; size?: number }

function sameFileContent(src: string, dest: string): boolean {
  try {
    const a = fs.statSync(src), b = fs.statSync(dest)
    return a.size === b.size && b.mtimeMs >= a.mtimeMs - 1
  } catch { return false }
}

/** Which of these files would be (re)copied into the preset. */
export function mediaToCopy(dir: string, seen: SeenAsset[], settings: LocalSettings = readLocalSettings(dir)): SeenAsset[] {
  const skip = new Set(settings.skipLocalMedia ?? [])
  return seen.filter((a) => !skip.has(a.id) && !sameFileContent(a.path, localMediaPath(dir, a.id, a.filename)))
}

/** Copy the files the scenes use into the preset (a fast copy-on-write copy where the disk supports it). Returns what was copied. */
export function storeLocalMedia(dir: string, seen: SeenAsset[], settings: LocalSettings = readLocalSettings(dir)): SeenAsset[] {
  const todo = mediaToCopy(dir, seen, settings)
  for (const a of todo) {
    const dest = localMediaPath(dir, a.id, a.filename)
    fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
    fs.copyFileSync(a.path, dest, fs.constants.COPYFILE_FICLONE)
    try { const t = fs.statSync(a.path); fs.utimesSync(dest, t.atime, t.mtime) } catch { /* the copy is still good */ }
  }
  return todo
}

/** Copies in the preset of files it no longer uses are removed. */
export function pruneLocalMedia(dir: string, manifest: Manifest, settings: LocalSettings = readLocalSettings(dir)): void {
  const root = localPath(dir, 'media')
  let ids: string[] = []
  try { ids = fs.readdirSync(root) } catch { return }
  const skip = new Set(settings.skipLocalMedia ?? [])
  for (const id of ids) {
    if (!safeSegment(id)) continue
    const a = manifest.assets.find((x) => x.id === id)
    if (!a || skip.has(id)) fs.rmSync(nodePath.join(root, id), { recursive: true, force: true })
  }
}

/** Where this preset keeps its own copy of each file (only those that are really there). */
export function localMediaLocations(dir: string, manifest: Manifest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of manifest.assets) {
    if (!safeSegment(a.id) || !safeSegment(a.filename)) continue
    const p = localMediaPath(dir, a.id, a.filename)
    if (fs.existsSync(p)) out[a.id] = p
  }
  return out
}

// ── what is uploaded ────────────────────────────────────────────────────────

/** Paths (relative to the preset, folders end with `/`) that stay on this computer when the preset is uploaded. */
export function cloudSkippedPaths(skip: CloudSkip | undefined): string[] {
  if (!skip) return []
  const out: string[] = []
  for (const id of skip.layouts ?? []) out.push(`collections/${id}.json`, variantsPathFor(`collections/${id}.json`))
  for (const id of skip.outputs ?? []) out.push(`profiles/${id}/`)
  if (skip.scripts) out.push('scripts/')
  if (skip.remoteControl) out.push('global/obs-websocket.json')
  return out
}

export const isSkipped = (file: string, skipped: string[]) => skipped.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s))

const BLOCK = '# obs-config-loader: kept on this computer'

/** Make git ignore `local/`, even before a save has written the shared `.gitignore`. */
export function ensureGitIgnoresLocal(dir: string): void {
  writeExclude(dir, undefined)
}

/** The paths git is currently told to leave out (besides `local/`). */
export function readExclude(dir: string): string[] {
  try {
    const lines = fs.readFileSync(nodePath.join(dir, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/)
    const i = lines.indexOf(BLOCK)
    return i < 0 ? [] : lines.slice(i + 1).filter((l) => l.startsWith('/') && l !== `/${LOCAL_DIR}/`).map((l) => l.slice(1))
  } catch { return [] }
}

/**
 * Tell git which paths are not uploaded, in the repository's own `info/exclude` (this computer only, so one person's choice
 * does not change another's). `local/` is always ignored.
 */
export function writeExclude(dir: string, skipped: string[] | undefined): void {
  const gitDir = nodePath.join(dir, '.git')
  try { if (!fs.statSync(gitDir).isDirectory()) return } catch { return }
  const f = nodePath.join(gitDir, 'info', 'exclude')
  let text = ''
  try { text = fs.readFileSync(f, 'utf8') } catch { /* none yet */ }
  const lines = text.split(/\r?\n/)
  const i = lines.indexOf(BLOCK)
  const before = (i < 0 ? lines : lines.slice(0, i)).filter((l) => l !== '')
  const old = i < 0 ? [] : lines.slice(i + 1).filter(Boolean)
  const rules = skipped === undefined ? old.filter((l) => l !== `/${LOCAL_DIR}/`) : skipped.map((p) => '/' + p)
  const block = [BLOCK, `/${LOCAL_DIR}/`, ...rules]
  fs.mkdirSync(nodePath.dirname(f), { recursive: true })
  fs.writeFileSync(f, [...before, ...block].join('\n') + '\n')
}

/** Paths in `dir` that differ from the same paths in `from` (a fresh copy of what OBS has), among the ones that stay local. */
export function localOnlyDiffs(from: string, dir: string, skipped: string[]): string[] {
  const out: string[] = []
  const list = (root: string, rel: string, acc: Map<string, string>) => {
    const full = nodePath.join(root, rel)
    let st: fs.Stats
    try { st = fs.statSync(full) } catch { return }
    if (st.isDirectory()) for (const n of fs.readdirSync(full)) list(root, rel.replace(/\/$/, '') + '/' + n, acc)
    else acc.set(rel, full)
  }
  for (const s of skipped) {
    const a = new Map<string, string>(), b = new Map<string, string>()
    list(from, s.replace(/\/$/, ''), a); list(dir, s.replace(/\/$/, ''), b)
    for (const [k, v] of a) { const w = b.get(k); if (!w || !fs.readFileSync(v).equals(fs.readFileSync(w))) out.push(k) }
    for (const k of b.keys()) if (!a.has(k)) out.push(k)
  }
  return [...new Set(out)].sort()
}

/** Put the local-only parts of a fresh copy into the preset (and remove ones OBS no longer has). */
export function copyLocalOnly(from: string, dir: string, skipped: string[]): void {
  for (const s of skipped) {
    const rel = s.replace(/\/$/, '')
    const src = nodePath.join(from, rel), dest = nodePath.join(dir, rel)
    fs.rmSync(dest, { recursive: true, force: true })
    if (fs.existsSync(src)) { fs.mkdirSync(nodePath.dirname(dest), { recursive: true }); fs.cpSync(src, dest, { recursive: true }) }
  }
}
