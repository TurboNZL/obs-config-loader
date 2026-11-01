import type { Platform } from './types.js'
import { DEFAULT_PLATFORM_MAP, isPlatformSpecific, availableOn } from './sources.js'
import { unversioned } from './plugins.js'

/**
 * Capture sources only exist on some operating systems, and what they point at (a window, a screen, a device) never
 * translates. So a setup keeps one version of such a source per platform, next to the collection:
 *
 *   collections/<id>.json            the OBS collection (what OBS wrote; its platform-specific sources are the first saver's)
 *   collections/<id>.platforms.json  { "<source name>": { "win32": {id, settings}, "linux": {...}, "darwin": {...} } }
 *
 * Saving on one OS only ever writes that OS's entries; importing on an OS uses its own entry when there is one.
 */
export interface SourceVariant { id: string; versioned_id?: string; settings: unknown }
export type VariantsFile = Record<string, Partial<Record<Platform, SourceVariant>>>

export const PLATFORM_ORDER: Platform[] = ['darwin', 'linux', 'win32']

export const variantsPathFor = (collectionFile: string) => collectionFile.replace(/\.json$/, '.platforms.json')

const isSpecific = (id: unknown): id is string =>
  typeof id === 'string' && (isPlatformSpecific(id) || isPlatformSpecific(unversioned(id)))
const emptySettings = (s: unknown) => !s || (typeof s === 'object' && Object.keys(s as object).length === 0)

/** True for a source that was only put there by an import as the stand-in for another OS's source, and never set up here. */
function isUntouchedStandIn(live: any, canonical: any | undefined): boolean {
  if (!canonical || canonical.id === live.id || !emptySettings(live.settings)) return false
  const entry = DEFAULT_PLATFORM_MAP.find((e) => e.from === canonical.id || e.from === unversioned(canonical.id))
  return !!entry && Object.values(entry.to).includes(live.id)
}

/**
 * The variants file after saving `live` (a tokenised collection) on `platform`: this platform's entries replaced by what
 * is in OBS now, every other platform's kept as they were, and names that are gone from the collection dropped.
 */
export function extractVariants(live: any, platform: Platform, prev: VariantsFile = {}, prevCanonical?: any): VariantsFile {
  const byName = new Map<string, any>((live?.sources ?? []).map((s: any) => [s.name, s]))
  const canonicalByName = new Map<string, any>((prevCanonical?.sources ?? []).map((s: any) => [s.name, s]))
  const out: VariantsFile = {}
  for (const [name, plats] of Object.entries(prev)) {
    const src = byName.get(name)
    if (src && isSpecific(src.id)) out[name] = { ...plats } // still a platform-specific source: keep what other OSes saved
  }
  for (const [name, src] of byName) {
    if (!isSpecific(src.id) || !availableOn(isPlatformSpecific(src.id) ? src.id : unversioned(src.id), platform)) continue
    if (isUntouchedStandIn(src, canonicalByName.get(name)) && !out[name]?.[platform]) continue
    out[name] = { ...(out[name] ?? {}), [platform]: { id: src.id, ...(src.versioned_id ? { versioned_id: src.versioned_id } : {}), settings: src.settings ?? {} } }
  }
  return out
}

/** Stable text for a variants file (names sorted, platforms in a fixed order) so saving twice never changes it. */
export function serializeVariants(v: VariantsFile): string {
  const out: Record<string, Record<string, SourceVariant>> = {}
  for (const name of Object.keys(v).sort()) {
    const row: Record<string, SourceVariant> = {}
    for (const p of PLATFORM_ORDER) if (v[name]?.[p]) row[p] = v[name]![p]!
    if (Object.keys(row).length) out[name] = row
  }
  return JSON.stringify(out, null, 4) + '\n'
}

export function parseVariants(raw: Buffer | string | undefined): VariantsFile {
  if (!raw) return {}
  try {
    const j = JSON.parse(String(raw))
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as VariantsFile) : {}
  } catch { return {} }
}

export interface AppliedVariant { source: string; id: string }

/** Put this platform's own version of each source into the collection. Returns what was used. Mutates `collection`. */
export function applyVariants(collection: any, variants: VariantsFile, platform: Platform): AppliedVariant[] {
  const used: AppliedVariant[] = []
  for (const s of collection?.sources ?? []) {
    const v = variants[s.name]?.[platform]
    if (!v || !isSpecific(s.id)) continue
    s.id = v.id
    if (v.versioned_id) s.versioned_id = v.versioned_id; else delete s.versioned_id
    s.settings = v.settings ?? {}
    used.push({ source: s.name, id: v.id })
  }
  return used
}
