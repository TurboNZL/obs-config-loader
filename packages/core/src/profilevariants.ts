import type { Bundle, Platform } from './types.js'
import { parseIni, setIni } from './ini.js'

/**
 * Some of a profile only makes sense on one system: which encoders (NVENC, AMD, VAAPI, VideoToolbox) and which audio devices.
 * So a setup keeps one copy of those per system, next to the profile (`profiles/<id>/platforms.json`), like it does for
 * capture sources. Saving on one system only writes that system's copy; the others stay as they were, even if the computer
 * that saved never uses them. Loading uses the copy for the system it is loaded on, when there is one.
 */
export const PROFILE_VARIANTS_FILE = 'platforms.json'

export interface ProfileVariant { ini?: Record<string, Record<string, string>>; files?: Record<string, string> }
export type ProfileVariants = Partial<Record<Platform, ProfileVariant>>

const ADVANCED_KEYS = ['Encoder', 'RecEncoder', 'AudioEncoder', 'RecAudioEncoder']
const SIMPLE_KEYS = ['StreamEncoder', 'RecEncoder']
const ENCODER_FILES = ['streamEncoder.json', 'recordEncoder.json']
const isAudioDevice = (k: string) => /Device\d*$/.test(k)

/** The system-specific part of a profile: the lines of basic.ini and the encoder settings files. */
export function platformPart(basicIni: string | undefined, files: Record<string, string | undefined>): ProfileVariant {
  const ini: Record<string, Record<string, string>> = {}
  for (const e of basicIni ? parseIni(basicIni) : []) {
    const hit = (e.section === 'AdvOut' && ADVANCED_KEYS.includes(e.key)) || (e.section === 'SimpleOutput' && SIMPLE_KEYS.includes(e.key)) || (e.section === 'Audio' && isAudioDevice(e.key))
    if (hit) (ini[e.section] ??= {})[e.key] = e.value
  }
  const out: Record<string, string> = {}
  for (const f of ENCODER_FILES) if (files[f] !== undefined) out[f] = files[f]!
  return { ...(Object.keys(ini).length ? { ini } : {}), ...(Object.keys(out).length ? { files: out } : {}) }
}

/** basic.ini with a system's own part put in. */
export function applyPlatformPart(basicIni: string, v: ProfileVariant | undefined): string {
  let t = basicIni
  for (const [section, keys] of Object.entries(v?.ini ?? {})) for (const [k, val] of Object.entries(keys)) t = setIni(t, section, k, val)
  return t
}

export function parseProfileVariants(buf: Buffer | undefined): ProfileVariants {
  if (!buf) return {}
  try { const j = JSON.parse(buf.toString('utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} }
}
export const serializeProfileVariants = (v: ProfileVariants) => Buffer.from(JSON.stringify(v, null, 2) + '\n')

const text = (b: Bundle, path: string) => b.files.get(path)?.toString('utf8')

/** Write this system's copy into each profile of a bundle made from OBS right now. */
export function addProfileVariants(b: Bundle, platform: Platform): void {
  for (const p of b.manifest.profiles) {
    const part = platformPart(text(b, `${p.dir}/basic.ini`), Object.fromEntries(ENCODER_FILES.map((f) => [f, text(b, `${p.dir}/${f}`)])))
    if (Object.keys(part).length) b.files.set(`${p.dir}/${PROFILE_VARIANTS_FILE}`, serializeProfileVariants({ [platform]: part }))
  }
}

/**
 * Saving into a setup that already exists: this system's copy is replaced by what OBS has now, every other system's copy is
 * kept, and the profile file itself keeps the system-specific lines it already had (so a save on one system never rewrites
 * another system's way of doing it, and two systems saving never fight over those lines).
 */
export function mergeProfileVariants(live: Bundle, prev: Bundle, platform: Platform): void {
  for (const p of live.manifest.profiles) {
    const before = prev.manifest.profiles.find((x) => x.id === p.id)
    if (!before) continue
    const prevVariants = parseProfileVariants(prev.files.get(`${before.dir}/${PROFILE_VARIANTS_FILE}`))
    const mine = parseProfileVariants(live.files.get(`${p.dir}/${PROFILE_VARIANTS_FILE}`))[platform]
    const next: ProfileVariants = { ...prevVariants }
    if (mine) next[platform] = mine; else delete next[platform]
    if (Object.keys(next).length) live.files.set(`${p.dir}/${PROFILE_VARIANTS_FILE}`, serializeProfileVariants(next)); else live.files.delete(`${p.dir}/${PROFILE_VARIANTS_FILE}`)
    // the profile itself: what the setup already had for these lines wins
    const prevIni = text(prev, `${before.dir}/basic.ini`)
    const liveIni = text(live, `${p.dir}/basic.ini`)
    if (prevIni !== undefined && liveIni !== undefined) {
      live.files.set(`${p.dir}/basic.ini`, Buffer.from(applyPlatformPart(liveIni, platformPart(prevIni, {}))))
    }
    for (const f of ENCODER_FILES) {
      const was = prev.files.get(`${before.dir}/${f}`)
      if (was) live.files.set(`${p.dir}/${f}`, was)
    }
  }
}
