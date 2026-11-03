import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import JSZip from 'jszip'
import { FORMAT, FORMAT_VERSION, type Bundle, type Manifest } from './types.js'

export class BundleError extends Error {
  constructor(message: string, readonly code: 'not-a-bundle' | 'too-new' | 'unsafe-path' | 'invalid') {
    super(message)
  }
}

const MANIFEST = 'manifest.json'
const MAX_ENTRIES = 20000

function safeName(name: string): string {
  const n = name.replace(/\\/g, '/')
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split('/').includes('..')) {
    throw new BundleError(`Refusing unsafe path in bundle: ${name}`, 'unsafe-path')
  }
  return n
}

/** Validate a parsed manifest. Newer versions are refused, older and unknown fields are kept. */
export function parseManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object') throw new BundleError('manifest.json is not an object.', 'invalid')
  const m = raw as Record<string, unknown>
  if (m.format !== FORMAT) throw new BundleError(`Not an OBS config bundle (format is ${JSON.stringify(m.format)}).`, 'not-a-bundle')
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) {
    throw new BundleError('Bundle has no valid version.', 'invalid')
  }
  if (m.version > FORMAT_VERSION) {
    throw new BundleError(
      `This bundle uses format version ${m.version}, but this app understands up to ${FORMAT_VERSION}. Update the app first.`,
      'too-new',
    )
  }
  if (typeof m.id !== 'string' || !m.id) throw new BundleError('Bundle has no id.', 'invalid')
  if (typeof m.name !== 'string') throw new BundleError('Bundle has no name.', 'invalid')
  // A secret's value is only honoured in a file that says it carries secrets: a stray `value` elsewhere is ignored, not used.
  const variables = (Array.isArray(m.variables) ? m.variables : []).map((v: any) =>
    m.containsSecrets === true || !v || typeof v !== 'object' || !('value' in v) ? v : (({ value: _v, ...rest }) => rest)(v))
  return {
    ...m,
    variables,
    collections: Array.isArray(m.collections) ? m.collections : [],
    profiles: Array.isArray(m.profiles) ? m.profiles : [],
    assets: Array.isArray(m.assets) ? m.assets : [],
    plugins: Array.isArray(m.plugins) ? m.plugins : [],
    platformMap: Array.isArray(m.platformMap) ? m.platformMap : [],
  } as Manifest
}

export function serializeManifest(m: Manifest): Buffer {
  return Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8')
}

// ── zip ──────────────────────────────────────────────────────────────────────

export async function readBundleZip(data: Buffer): Promise<Bundle> {
  const zip = await JSZip.loadAsync(data)
  const names = Object.keys(zip.files)
  if (names.length > MAX_ENTRIES) throw new BundleError('Bundle has too many files.', 'invalid')
  // Some zip tools wrap everything in one folder; accept that.
  const prefix = (() => {
    if (zip.file(MANIFEST)) return ''
    const hit = names.find((n) => /^[^/]+\/manifest\.json$/.test(n))
    return hit ? hit.slice(0, hit.indexOf('/') + 1) : ''
  })()
  const mf = zip.file(prefix + MANIFEST)
  if (!mf) throw new BundleError('No manifest.json in this file.', 'not-a-bundle')
  let raw: unknown
  try { raw = JSON.parse(await mf.async('string')) } catch { throw new BundleError('manifest.json is not valid JSON.', 'invalid') }
  const manifest = parseManifest(raw)
  const files = new Map<string, Buffer>()
  for (const name of names) {
    const entry = zip.files[name]
    if (entry.dir || !name.startsWith(prefix)) continue
    const rel = safeName(name.slice(prefix.length))
    if (rel === MANIFEST) continue
    files.set(rel, await entry.async('nodebuffer'))
  }
  return { manifest, files }
}

export async function writeBundleZip(b: Bundle): Promise<Buffer> {
  const zip = new JSZip()
  // Fixed date so exporting the same content twice gives the same bytes.
  const date = new Date(Date.UTC(2020, 0, 1))
  zip.file(MANIFEST, serializeManifest(b.manifest), { date })
  for (const name of [...b.files.keys()].sort()) zip.file(safeName(name), b.files.get(name)!, { date })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

// ── directory (the git form) ─────────────────────────────────────────────────

/** The folder inside a preset that never leaves this computer (stream keys, copies of big files, this preset's own upload choices). */
export const LOCAL_DIR = 'local'

/** `keepMissing`: keep the manifest exactly as written, even for things whose files are not here (for code that writes the manifest back). */
export function readBundleDir(dir: string, opts: { keepMissing?: boolean } = {}): Bundle {
  const mp = nodePath.join(dir, MANIFEST)
  if (!fs.existsSync(mp)) throw new BundleError('No manifest.json in this folder.', 'not-a-bundle')
  let raw: unknown
  try { raw = JSON.parse(fs.readFileSync(mp, 'utf8')) } catch { throw new BundleError('manifest.json is not valid JSON.', 'invalid') }
  const manifest = parseManifest(raw)
  const files = new Map<string, Buffer>()
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(nodePath.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (r === '.git' || r.startsWith('.git/') || r === LOCAL_DIR || r === 'assets.lock.json' || r === '.gitignore') continue
      if (ent.isDirectory()) walk(r)
      else if (r !== MANIFEST) files.set(r, fs.readFileSync(nodePath.join(dir, r)))
    }
  }
  walk('')
  // Things the person chose not to upload are not in a copy that came from online: leave them out of the lists, so nothing asks for a missing file
  if (!opts.keepMissing) {
    manifest.collections = manifest.collections.filter((c) => files.has(c.file))
    manifest.profiles = manifest.profiles.filter((pr) => [...files.keys()].some((f) => f.startsWith(pr.dir + '/')))
  }
  return { manifest, files }
}

/**
 * Write the directory form. Bundled media are written only when `withMedia` (git keeps them out).
 * Existing files that are not part of the bundle are left alone (the folder may be a git checkout).
 */
export function writeBundleDir(b: Bundle, dir: string, opts: { withMedia: boolean; /** Media (by asset id) that are kept in the folder even though `withMedia` is off. */ mediaIds?: string[] } = { withMedia: false }): void {
  // A folder is meant for git, and git keeps history forever: stream keys must never be written there.
  if (b.manifest.containsSecrets || b.manifest.variables.some((v) => v.value !== undefined)) {
    throw new BundleError('A setup that has stream keys inside can only be saved as a single file, never into a folder for git.', 'invalid')
  }
  fs.mkdirSync(dir, { recursive: true })
  // Without the media in the folder, a "bundled" asset is a placeholder: record it as external (hash kept)
  // so a later pull asks for the file instead of failing to find it.
  const keep = new Set(opts.mediaIds ?? [])
  const manifest: Manifest = opts.withMedia ? b.manifest : {
    ...b.manifest,
    assets: b.manifest.assets.map((a) => (a.mode === 'bundled' && a.role !== 'script' && !keep.has(a.id) ? { ...a, mode: 'external' as const } : a)),
  }
  fs.writeFileSync(nodePath.join(dir, MANIFEST), serializeManifest(manifest))
  // Clear previously exported content so removed collections/profiles do not linger.
  for (const sub of ['collections', 'profiles', 'scripts', 'global', 'media']) fs.rmSync(nodePath.join(dir, sub), { recursive: true, force: true })
  for (const [name, data] of b.files) {
    if (name.startsWith('media/') && !opts.withMedia && !keep.has(name.split('/')[1])) continue
    const target = nodePath.join(dir, safeName(name))
    fs.mkdirSync(nodePath.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
  }
  const lock = Object.fromEntries(
    manifest.assets.map((a) => [a.id, { filename: a.filename, mode: a.mode, sha256: a.sha256, size: a.size, hint: a.hint }]),
  )
  fs.writeFileSync(nodePath.join(dir, 'assets.lock.json'), JSON.stringify(lock, null, 2) + '\n')
  // `local/` is this computer's own part of a preset (stream keys, copies of big files): git never sees it.
  // (Presets made earlier ignored `media/`; chosen files are kept there now, so that line goes.)
  const gi = nodePath.join(dir, '.gitignore')
  const lines = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).filter((l) => l !== '') : []
  const wanted = lines.filter((l) => l.trim() !== 'media/')
  if (!wanted.includes(`${LOCAL_DIR}/`)) wanted.push(`${LOCAL_DIR}/`)
  if (wanted.join('\n') !== lines.join('\n') || !fs.existsSync(gi)) fs.writeFileSync(gi, wanted.join('\n') + '\n')
}

/** Open a bundle from a path: a zip/.obsbundle file or a directory. */
export async function readBundle(path: string): Promise<Bundle> {
  const st = fs.statSync(path)
  return st.isDirectory() ? readBundleDir(path) : readBundleZip(fs.readFileSync(path))
}
