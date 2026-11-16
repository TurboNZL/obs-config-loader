import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import JSZip from 'jszip'

/**
 * Getting a portable OBS onto a Windows computer without a browser or an installer: find the newest release on OBS's own GitHub page,
 * download the zip, check it against the fingerprint GitHub publishes, unpack it into a folder that does not exist yet, and switch
 * portable mode on. Nothing already on the computer is touched or overwritten.
 */
export const AUTO_SUFFIX = ' (config loader auto install)'
export const OBS_RELEASE_API = 'https://api.github.com/repos/obsproject/obs-studio/releases/latest'

/** A folder name inside `parent` that is not taken: `name`, then `name (config loader auto install)`, then with a number. */
export function freshFolder(parent: string, name: string, exists: (p: string) => boolean = fs.existsSync): string {
  const base = name.trim() || 'OBS Studio'
  if (!exists(nodePath.join(parent, base))) return nodePath.join(parent, base)
  for (let n = 1; n < 1000; n++) {
    const cand = base + AUTO_SUFFIX + (n > 1 ? ` ${n}` : '')
    if (!exists(nodePath.join(parent, cand))) return nodePath.join(parent, cand)
  }
  throw new Error('Could not find a free folder name.')
}

export interface ObsRelease { version: string; name: string; url: string; size: number; sha256?: string }
type Fetch = typeof fetch

/** The newest portable (zip) build for 64-bit Windows. */
export async function latestWindowsPortable(f: Fetch = fetch): Promise<ObsRelease> {
  const res = await f(OBS_RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'obs-config-loader' } })
  if (!res.ok) throw new Error(`OBS's download page did not answer (${res.status}). Check your internet connection and try again.`)
  const rel = (await res.json()) as { tag_name?: string; assets?: { name: string; size: number; browser_download_url: string; digest?: string }[] }
  const a = (rel.assets ?? []).find((x) => /Windows-x64\.zip$/i.test(x.name) && !/pdb|installer/i.test(x.name))
  if (!a) throw new Error('Could not find the Windows download for OBS on its release page.')
  return { version: rel.tag_name ?? '', name: a.name, url: a.browser_download_url, size: a.size, ...(a.digest?.startsWith('sha256:') ? { sha256: a.digest.slice(7) } : {}) }
}

export async function downloadFile(url: string, dest: string, onProgress: (done: number, total: number) => void, f: Fetch = fetch): Promise<string> {
  fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
  const res = await f(url, { headers: { 'User-Agent': 'obs-config-loader' } })
  if (!res.ok || !res.body) throw new Error(`The download did not start (${res.status}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(dest)
  let done = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      hash.update(value); done += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      onProgress(done, total)
    }
  } finally { await new Promise<void>((r) => out.end(() => r())) }
  return hash.digest('hex')
}

/** Unpack a zip, refusing any entry that would land outside `dest`. */
export async function extractZipSafe(zipFile: string, dest: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipFile))
  const names = Object.keys(zip.files)
  const root = nodePath.resolve(dest)
  let n = 0
  for (const name of names) {
    const target = nodePath.resolve(root, name)
    if (target !== root && !target.startsWith(root + nodePath.sep)) throw new Error(`The download holds a file that would be written outside its folder (${name}), so it was not unpacked.`)
    const e = zip.files[name]
    if (e.dir) { fs.mkdirSync(target, { recursive: true }); continue }
    fs.mkdirSync(nodePath.dirname(target), { recursive: true })
    fs.writeFileSync(target, await e.async('nodebuffer'))
    onProgress?.(++n, names.length)
  }
  return n
}

export interface InstallProgress { phase: 'looking' | 'downloading' | 'checking' | 'unpacking' | 'done'; done?: number; total?: number; text: string }

export async function installPortableObs(o: { parent: string; name?: string; onProgress?: (p: InstallProgress) => void; fetchImpl?: Fetch; tmpDir?: string }): Promise<{ root: string; version: string }> {
  const say = o.onProgress ?? (() => {})
  const f = o.fetchImpl ?? fetch
  say({ phase: 'looking', text: 'Looking up the newest OBS Studio…' })
  const rel = await latestWindowsPortable(f)
  const root = freshFolder(o.parent, o.name ?? 'OBS Studio')
  const zip = nodePath.join(o.tmpDir ?? nodePath.join(o.parent, '.obs-download'), rel.name)
  try {
    const sha = await downloadFile(rel.url, zip, (d, t) => say({ phase: 'downloading', done: d, total: t || rel.size, text: `Downloading OBS ${rel.version}…` }), f)
    say({ phase: 'checking', text: 'Checking the download…' })
    if (rel.sha256 && rel.sha256.toLowerCase() !== sha) throw new Error('The download does not match the fingerprint OBS publishes, so it was thrown away. Try again.')
    fs.mkdirSync(root, { recursive: true })
    await extractZipSafe(zip, root, (d, t) => say({ phase: 'unpacking', done: d, total: t, text: 'Unpacking…' }))
    if (!fs.existsSync(nodePath.join(root, 'bin/64bit/obs64.exe'))) throw new Error('The download did not contain OBS (bin/64bit/obs64.exe is missing).')
    fs.writeFileSync(nodePath.join(root, 'portable_mode.txt'), '') // OBS keeps its settings inside this folder when this file exists (OBS's own switch)
  } catch (e) {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* partial folder we made ourselves */ }
    throw e
  } finally {
    try { fs.rmSync(zip, { force: true }) } catch { /* download leftovers */ }
  }
  say({ phase: 'done', text: 'OBS is ready.' })
  return { root, version: rel.version }
}
