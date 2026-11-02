import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Manifest } from './types.js'
import type { Host, ObsInstall } from './detect.js'
import { getIni } from './ini.js'

/** What this computer's OBS and plugins are, as far as can be told. Every part is optional: OBS does not always say. */
export interface DetectedVersions {
  /** Plugin modules OBS knows about but has switched off (module keys, see `moduleKey`). */
  disabled?: string[]
  /** "31.0.2" */
  obs?: string
  /** Plugin module name (lowercase, no dashes or underscores) to version. */
  plugins?: Record<string, string>
}

export const moduleKey = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '')

/** Names a plugin may be known by on a computer: its module names and its own id, with and without a leading "obs". */
function refKeys(p: { id: string; provides: { kind: string; id: string }[] }): string[] {
  const keys = p.provides.filter((x) => x.kind === 'module').map((x) => moduleKey(x.id)).concat(moduleKey(p.id))
  return [...new Set(keys.flatMap((k) => (k.startsWith('obs') ? [k, k.slice(3)] : [k])))]
}

/** OBS keeps its own version as one number in global.ini: major << 24 | minor << 16 | patch. */
export function parseObsVersion(globalIni: string): string | undefined {
  const raw = getIni(globalIni, 'General', 'LastVersion')
  const n = raw === undefined ? NaN : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  const major = Math.floor(n / 2 ** 24) % 256, minor = Math.floor(n / 2 ** 16) % 256, patch = n % 65536
  if (major < 20 || major > 99) return undefined // not an OBS-looking number: say nothing rather than something wrong
  return `${major}.${minor}.${patch}`
}

export interface PluginManagerEntry { module_name: string; display_name?: string; version?: string; enabled?: boolean; sources?: string[] }

/**
 * OBS 31 and newer keep a list of every plugin module they have seen, with the version the plugin reports and whether it
 * is switched on, in `<settings folder>/plugin_manager/modules.json`. It is the same on every kind of install and does not
 * depend on where a plugin's files are, which is why it is asked before the plugin folders are searched.
 */
export function readPluginManager(install: ObsInstall): PluginManagerEntry[] {
  try {
    const j = JSON.parse(fs.readFileSync(nodePath.join(install.configDir, 'plugin_manager', 'modules.json'), 'utf8'))
    return (Array.isArray(j) ? j : []).filter((e) => e && typeof e.module_name === 'string' && e.module_name)
  } catch { return [] }
}

export function detectObsVersion(install: ObsInstall): string | undefined {
  try { return parseObsVersion(fs.readFileSync(nodePath.join(install.configDir, 'global.ini'), 'utf8')) } catch { return undefined }
}

/** -1, 0 or 1; compares dotted numbers ("31.0.2" vs "30.2.3"), ignoring anything non-numeric. Unparseable counts as equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.match(/\d+/g)?.map(Number), pb = b.match(/\d+/g)?.map(Number)
  if (!pa || !pb) return 0
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export const newerOf = (a?: string, b?: string): string | undefined => (a && b ? (compareVersions(a, b) >= 0 ? a : b) : a ?? b)

/** Pull `Name\tversion` style lines out of `flatpak list --columns=application,version`. */
export function parseFlatpakPlugins(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const [app, version] = line.split('\t').map((s) => s.trim())
    const m = app && /^com\.obsproject\.Studio\.Plugin\.(.+)$/.exec(app)
    if (m && version) out[moduleKey(m[1])] = version
  }
  return out
}

export function parsePlistVersion(xml: string): string | undefined {
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)?.[1]?.trim()
}

/**
 * Best effort, per platform, and silent when it cannot tell (OBS itself does not record plugin versions):
 * macOS plugin bundles say it in Info.plist, Windows modules in their file properties, Flatpak in its list of extensions.
 * Native Linux packages are not asked: there is no reliable way that works for every distribution.
 */
export function detectPluginVersions(install: ObsInstall, host: Host): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of readPluginManager(install)) if (e.version?.trim()) out[moduleKey(e.module_name)] = e.version.trim()
  const have = (k: string) => k in out
  // On Windows the only other way is starting PowerShell, which is slow: OBS's own list is complete, so only fall back when it does not exist (older OBS)
  if (host.platform === 'win32' && (Object.keys(out).length || readPluginManager(install).length)) return out
  try {
    if (host.platform === 'darwin') {
      for (const dir of install.pluginDirs) {
        for (const name of host.listDir(dir)) {
          if (!/\.plugin$/i.test(name)) continue
          try {
            const v = parsePlistVersion(fs.readFileSync(nodePath.join(dir, name, 'Contents', 'Info.plist'), 'utf8'))
            if (v && !have(moduleKey(name.replace(/\.plugin$/i, '')))) out[moduleKey(name.replace(/\.plugin$/i, ''))] = v
          } catch { /* binary plist or unreadable: skip */ }
        }
      }
    } else if (host.platform === 'win32') {
      for (const dir of install.pluginDirs.filter((d) => host.isDir(d))) {
        // the folder goes in through the environment: arguments after -Command are glued onto the command, not passed as $args
        const script = `Get-ChildItem -LiteralPath $env:OBSCL_DIR -Recurse -Filter *.dll | ForEach-Object { $_.BaseName + '|' + $_.VersionInfo.FileVersion }`
        const text = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 8000, env: { ...process.env, OBSCL_DIR: dir } })
        for (const line of text.split(/\r?\n/)) {
          const [n, v] = line.split('|')
          if (n && v?.trim() && !have(moduleKey(n))) out[moduleKey(n)] = v.trim().replace(/(\.0)+$/, '')
        }
      }
    } else if (install.kind === 'flatpak') {
      for (const [k, v] of Object.entries(parseFlatpakPlugins(execFileSync('flatpak', ['list', '--columns=application,version'], { encoding: 'utf8', timeout: 8000 })))) if (!have(k)) out[k] = v
    }
  } catch { /* cannot tell: leave it out */ }
  return out
}

export function detectVersions(install: ObsInstall, host: Host): DetectedVersions {
  const disabled = readPluginManager(install).filter((e) => e.enabled === false).map((e) => moduleKey(e.module_name))
  return { obs: detectObsVersion(install), plugins: detectPluginVersions(install, host), ...(disabled.length ? { disabled } : {}) }
}

/**
 * Write versions into a manifest. A version only ever goes up (the newest any computer saved it with), so two computers
 * with different OBS versions saving the same setup settle instead of rewriting it back and forth forever.
 */
export function applyVersions(m: Manifest, prev: Manifest | undefined, live: DetectedVersions | undefined): void {
  const obs = newerOf(prev?.savedWithObs as string | undefined, live?.obs)
  if (obs) m.savedWithObs = obs
  for (const p of m.plugins) {
    const keys = refKeys(p)
    const fromLive = keys.map((k) => live?.plugins?.[k]).find(Boolean)
    const v = newerOf(prev?.plugins?.find((x) => x.id === p.id)?.version, fromLive)
    if (v) p.version = v
  }
}

/** Plain-words notes when this computer's OBS or plugins are older than what the setup was saved with. */
export function versionNotes(m: Manifest, installed: DetectedVersions | undefined): string[] {
  const notes: string[] = []
  if (!installed) return notes
  const saved = m.savedWithObs as string | undefined
  if (saved && installed.obs && compareVersions(installed.obs, saved) < 0) {
    notes.push(`This setup was saved with OBS ${saved}, and this computer has OBS ${installed.obs}. If something does not load, update OBS first.`)
  }
  for (const p of m.plugins) {
    if (installed.disabled?.some((d) => refKeys(p).includes(d))) notes.push(`${p.name} is installed but switched off in OBS. Switch it on in OBS's plugin manager, or its sources will stay empty.`)
    if (!p.version) continue
    const keys = refKeys(p)
    const have = keys.map((k) => installed.plugins?.[k]).find(Boolean)
    if (have && compareVersions(have, p.version) < 0) notes.push(`${p.name}: saved with version ${p.version}, this computer has ${have}. Update it if something does not load.`)
  }
  return notes
}
