import { getIni, setIni } from './ini.js'
import type { ObsInstall } from './detect.js'
import type { Platform } from './types.js'
import { readPluginManager } from './versions.js'

/**
 * Encoders depend on the computer: hardware ones (NVENC, AMD, Intel, VAAPI, VideoToolbox) only exist where the right
 * hardware and system are, and OBS leaves the encoder boxes in Settings empty (and the OK button off) when a profile names
 * one that is not there. So a profile loaded on another computer has its encoders checked, and any that this OBS does not
 * have are swapped for ones every OBS has.
 */
export interface EncoderFix { section: string; key: string; label: string; from: string; to: string; resets?: 'streamEncoder.json' | 'recordEncoder.json' }

const VIDEO_DEFAULT = 'obs_x264'
const AUDIO_DEFAULT = 'ffmpeg_aac'

const ADVANCED: { key: string; label: string; kind: 'video' | 'audio'; resets?: EncoderFix['resets'] }[] = [
  { key: 'Encoder', label: 'video encoder for streaming', kind: 'video', resets: 'streamEncoder.json' },
  { key: 'RecEncoder', label: 'video encoder for recording', kind: 'video', resets: 'recordEncoder.json' },
  { key: 'AudioEncoder', label: 'audio encoder for streaming', kind: 'audio' },
  { key: 'RecAudioEncoder', label: 'audio encoder for recording', kind: 'audio' },
]
const SIMPLE_VIDEO: { key: string; label: string }[] = [
  { key: 'StreamEncoder', label: 'video encoder for streaming' },
  { key: 'RecEncoder', label: 'video encoder for recording' },
]

/** Encoder ids this OBS has, from its own list of modules (OBS 31 and newer). Undefined when that list is missing or not believable. */
export function availableEncoders(install: ObsInstall): Set<string> | undefined {
  const set = new Set<string>()
  for (const m of readPluginManager(install)) {
    if (m.enabled === false) continue
    for (const e of m.encoders ?? []) if (typeof e === 'string') set.add(e)
  }
  // every OBS has the x264 and AAC encoders: a list without them is not a list to trust
  return set.has(VIDEO_DEFAULT) && set.has(AUDIO_DEFAULT) ? set : undefined
}

/** Without a list: ids that only exist on one system, wrong for the system loading them. */
function wrongForSystem(id: string, target: Platform): boolean {
  const mac = /^com\.apple\.|videotoolbox|^apple_|^CoreAudio/i.test(id)
  const win = /texture_amf|^amd$/i.test(id)
  const linux = /vaapi/i.test(id)
  return (target !== 'darwin' && mac) || (target !== 'win32' && win) || (target !== 'linux' && linux)
}

export function fixEncoders(ini: string, o: { available?: Set<string>; target: Platform }): { text: string; fixes: EncoderFix[] } {
  let text = ini
  const fixes: EncoderFix[] = []
  const unavailable = (id: string) => (o.available ? !o.available.has(id) : wrongForSystem(id, o.target))
  for (const k of ADVANCED) {
    const v = getIni(text, 'AdvOut', k.key)?.trim()
    if (!v || v === 'none' || !unavailable(v)) continue
    const to = k.kind === 'video' ? VIDEO_DEFAULT : AUDIO_DEFAULT
    text = setIni(text, 'AdvOut', k.key, to)
    fixes.push({ section: 'AdvOut', key: k.key, label: k.label, from: v, to, resets: k.resets })
  }
  // Simple mode names its video encoders loosely ("x264", "nvenc", "amd", "apple_h264"): only what cannot exist here is changed
  for (const k of SIMPLE_VIDEO) {
    const v = getIni(text, 'SimpleOutput', k.key)?.trim()
    if (!v || v === 'x264' || v === 'none' || !wrongForSystem(v, o.target)) continue
    text = setIni(text, 'SimpleOutput', k.key, 'x264')
    fixes.push({ section: 'SimpleOutput', key: k.key, label: k.label, from: v, to: 'x264' })
  }
  return { text, fixes }
}
