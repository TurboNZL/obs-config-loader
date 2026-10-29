import type { Host, ObsInstall } from './detect.js'
import type { PluginRef } from './types.js'
import { CROSS_PLATFORM_BUILTIN_SOURCES, SOURCE_PLATFORMS } from './sources.js'

/** Source/filter/transition ids OBS Studio ships (from its own source tree, 2026-10-29). */
const BUILTIN_OTHER = [
  'async_delay_filter', 'basic_eq_filter', 'chroma_key_filter', 'clut_filter', 'color_filter', 'color_key_filter',
  'compressor_filter', 'crop_filter', 'expander_filter', 'gain_filter', 'gpu_delay', 'hdr_tonemap_filter',
  'invert_polarity_filter', 'limiter_filter', 'luma_key_filter', 'mask_filter', 'noise_gate_filter',
  'noise_suppress_filter', 'nv_background_blur_filter', 'nv_blur_filter', 'nv_greenscreen_filter',
  'nvidia_audiofx_filter', 'scale_filter', 'scroll_filter', 'sdr_on_hdr_filter', 'sharpness_filter',
  'upward_compressor_filter', 'vst_filter', 'render_delay', 'eq_filter',
  'cut_transition', 'fade_transition', 'fade_to_color_transition', 'obs_stinger_transition', 'slide_transition',
  'swipe_transition', 'wipe_transition', 'luma_wipe_transition',
]
const BUILTIN = new Set<string>([
  ...Object.keys(SOURCE_PLATFORMS), ...CROSS_PLATFORM_BUILTIN_SOURCES, ...BUILTIN_OTHER,
])

/** OBS appends _vN to versioned ids (color_source_v3, text_ft2_source_v2). */
export function unversioned(id: string): string {
  return id.replace(/_v\d+$/, '')
}

export function isBuiltinId(id: string): boolean {
  return BUILTIN.has(id) || BUILTIN.has(unversioned(id))
}

/**
 * Plugins we can name. Deliberately small and checked against each plugin's own source; a plugin that
 * is not here is still reported (as an unknown id) with no install instructions rather than a guess.
 */
export const KNOWN_PLUGINS: PluginRef[] = [
  {
    id: 'obs-pipewire-audio-capture',
    name: 'PipeWire Audio Capture',
    provides: [
      { kind: 'source', id: 'pipewire_audio_application_capture' },
      { kind: 'source', id: 'pipewire_audio_input_capture' },
      { kind: 'source', id: 'pipewire_audio_output_capture' },
    ],
    homepage: 'https://github.com/dimtpap/obs-pipewire-audio-capture',
    install: {
      'linux-flatpak': 'flatpak install flathub com.obsproject.Studio.Plugin.PipeWireAudioCapture',
      'linux-native': 'Download the release archive and extract it into ~/.config/obs-studio/plugins/ (see the project page).',
    },
  },
  {
    id: 'obs-multi-rtmp',
    name: 'Multiple RTMP outputs',
    provides: [{ kind: 'module', id: 'obs-multi-rtmp' }],
    homepage: 'https://github.com/sorayuki/obs-multi-rtmp',
    install: {
      'linux-flatpak': 'Install the Flatpak plugin extension if one is published, or follow FLATPAK.md in the project.',
      'linux-native': 'Install the package from the project releases page (see the project page).',
      windows: 'Run the installer from the project releases page.',
      macos: 'Follow the project page.',
    },
  },
  {
    id: 'aitum-multistream',
    name: 'Aitum Multistream',
    provides: [{ kind: 'module', id: 'aitum-multistream' }],
    homepage: 'https://github.com/Aitum/obs-aitum-multistream',
    install: {
      'linux-flatpak': 'flatpak install flathub com.obsproject.Studio.Plugin.AitumMultistream',
      windows: 'Download the installer from the project page.',
    },
  },
]

export interface UsedIds {
  sources: Set<string>
  filters: Set<string>
  transitions: Set<string>
}

/** Collect the ids a scene collection uses. */
export function usedIds(collection: any): UsedIds {
  const u: UsedIds = { sources: new Set(), filters: new Set(), transitions: new Set() }
  for (const s of collection?.sources ?? []) {
    if (typeof s?.id === 'string') u.sources.add(s.id)
    for (const f of s?.filters ?? []) if (typeof f?.id === 'string') u.filters.add(f.id)
  }
  for (const t of collection?.transitions ?? []) if (typeof t?.id === 'string') u.transitions.add(t.id)
  return u
}

/** Basenames of native plugin modules found under the install's plugin dirs (e.g. "obs-multi-rtmp"). */
export function installedModules(host: Host, install: ObsInstall): Set<string> {
  const found = new Set<string>()
  const norm = (n: string) => n.replace(/\.(so|dll|dylib)$/i, '').replace(/^lib/, '')
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return
    for (const name of host.listDir(dir)) {
      const full = `${dir}/${name}`
      if (/\.(so|dll|dylib)$/i.test(name)) found.add(norm(name).toLowerCase())
      else if (host.isDir(full)) {
        if (/\.plugin$/i.test(name)) found.add(name.replace(/\.plugin$/i, '').toLowerCase())
        walk(full, depth + 1)
      }
    }
  }
  for (const d of install.pluginDirs) walk(d, 0)
  return found
}

export type PluginStatus = 'present' | 'missing'
export interface PluginFinding {
  plugin: PluginRef
  status: PluginStatus | 'unverifiable'
  usedBy: string[]
}
export interface PluginReport {
  known: PluginFinding[]
  /** Ids that are neither built into OBS nor in the registry. Probably a plugin we cannot name. */
  unknownIds: { kind: 'source' | 'filter' | 'transition'; id: string }[]
}

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, '')

/** Profile files that prove a plugin is in use even though no scene id mentions it. */
export const FILE_HINTS: Record<string, string> = {
  'obs-multi-rtmp.json': 'obs-multi-rtmp',
}

export function pluginReport(used: UsedIds, modules: Set<string> | undefined, hinted: Set<string> = new Set()): PluginReport {
  const known: PluginFinding[] = []
  const claimed = new Set<string>()
  const moduleSet = modules ? new Set([...modules].map(norm)) : undefined
  for (const plugin of KNOWN_PLUGINS) {
    const usedBy: string[] = []
    for (const pr of plugin.provides) {
      if (pr.kind === 'source' && used.sources.has(pr.id)) { usedBy.push(pr.id); claimed.add(pr.id) }
      if (pr.kind === 'filter' && used.filters.has(pr.id)) { usedBy.push(pr.id); claimed.add(pr.id) }
    }
    if (hinted.has(plugin.id)) usedBy.push('profile settings')
    if (!usedBy.length) continue
    const modIds = plugin.provides.filter((p) => p.kind === 'module').map((p) => norm(p.id))
    const presentByModule = moduleSet ? modIds.some((m) => moduleSet.has(m)) : false
    // For plugins that only provide source ids we cannot see the module name: say so instead of guessing.
    const status = modIds.length ? (presentByModule ? 'present' : moduleSet ? 'missing' : 'unverifiable') : 'unverifiable'
    known.push({ plugin, status, usedBy })
  }
  const unknownIds: PluginReport['unknownIds'] = []
  for (const id of used.sources) if (!isBuiltinId(id) && !claimed.has(id)) unknownIds.push({ kind: 'source', id })
  for (const id of used.filters) if (!isBuiltinId(id) && !claimed.has(id)) unknownIds.push({ kind: 'filter', id })
  for (const id of used.transitions) if (!isBuiltinId(id) && !claimed.has(id)) unknownIds.push({ kind: 'transition', id })
  return { known, unknownIds }
}

/** Importer side: check the plugins a bundle declares against what the target has. */
export function checkPlugins(refs: PluginRef[], modules: Set<string> | undefined): PluginFinding[] {
  const moduleSet = modules ? new Set([...modules].map(norm)) : undefined
  return refs.map((plugin) => {
    const modIds = plugin.provides.filter((p) => p.kind === 'module').map((p) => norm(p.id))
    const status: PluginFinding['status'] = !modIds.length || !moduleSet
      ? 'unverifiable'
      : modIds.some((m) => moduleSet.has(m)) ? 'present' : 'missing'
    return { plugin, status, usedBy: plugin.provides.map((p) => p.id) }
  })
}

/** The manifest `plugins` list for a report: known plugins plus one entry per unknown id. */
export function manifestPlugins(report: PluginReport): PluginRef[] {
  const refs = report.known.map((f) => f.plugin)
  for (const u of report.unknownIds) {
    refs.push({ id: `unknown:${u.id}`, name: u.id, provides: [{ kind: u.kind === 'transition' ? 'filter' : u.kind, id: u.id }], required: false })
  }
  return refs
}
