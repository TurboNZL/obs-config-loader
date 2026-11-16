/**
 * Building OBS from source for Linux and macOS, as a guided job in the app. The switches offered here were each read in OBS Studio's own
 * build files (CMakeLists.txt, cmake/linux/defaults.cmake, plugins/CMakeLists.txt, CMakePresets.json) in November 2026; anything not
 * listed can still be typed as a custom flag. A deprecated switch is not offered (ENABLE_PLUGINS was replaced by ENABLE_CORE_MODULES).
 * Nothing here runs a shell: every step is a program and its arguments.
 */
export interface CompileToggle {
  /** The CMake variable. */
  id: string
  label: string
  help: string
  /** The value the build uses when it is not set. */
  defaultOn: boolean
  platforms: ('linux' | 'darwin')[]
  /** Where it was read. */
  source: string
}

export const COMPILE_TOGGLES: CompileToggle[] = [
  { id: 'ENABLE_PORTABLE_CONFIG', label: 'Portable settings (keep OBS’s settings next to the program)', help: 'Linux only. Needed for an OBS that lives in its own folder and keeps its own settings.', defaultOn: false, platforms: ['linux'], source: 'cmake/linux/defaults.cmake' },
  { id: 'ENABLE_FRONTEND', label: 'The OBS window (needs Qt)', help: 'Off builds only the engine, with no window.', defaultOn: true, platforms: ['linux', 'darwin'], source: 'CMakeLists.txt' },
  { id: 'ENABLE_SCRIPTING', label: 'Scripts (Python and Lua)', help: 'Needed for Tools → Scripts.', defaultOn: true, platforms: ['linux', 'darwin'], source: 'CMakeLists.txt' },
  { id: 'ENABLE_HEVC', label: 'HEVC (H.265) encoders', help: '', defaultOn: true, platforms: ['linux', 'darwin'], source: 'CMakeLists.txt' },
  { id: 'ENABLE_WAYLAND', label: 'Wayland support', help: 'For desktops that use Wayland.', defaultOn: true, platforms: ['linux'], source: 'cmake/linux/defaults.cmake' },
  { id: 'ENABLE_PULSEAUDIO', label: 'PulseAudio support', help: '', defaultOn: true, platforms: ['linux'], source: 'cmake/linux/defaults.cmake' },
  { id: 'ENABLE_CORE_MODULES', label: 'The built-in plugins', help: 'Off leaves out every plugin that comes with OBS.', defaultOn: true, platforms: ['linux', 'darwin'], source: 'plugins/CMakeLists.txt' },
  { id: 'ENABLE_BROWSER', label: 'Browser sources', help: 'Needs the browser engine (CEF), which is large.', defaultOn: false, platforms: ['linux', 'darwin'], source: 'CMakePresets.json' },
  { id: 'ENABLE_VLC', label: 'VLC video source', help: '', defaultOn: false, platforms: ['linux', 'darwin'], source: 'CMakePresets.json' },
  { id: 'ENABLE_AJA', label: 'AJA capture cards', help: '', defaultOn: false, platforms: ['linux', 'darwin'], source: 'CMakePresets.json' },
  { id: 'ENABLE_WEBRTC', label: 'WebRTC output', help: '', defaultOn: false, platforms: ['linux', 'darwin'], source: 'CMakePresets.json' },
  { id: 'ENABLE_VST', label: 'VST plugins', help: '', defaultOn: false, platforms: ['linux', 'darwin'], source: 'CMakePresets.json' },
]

export interface CompileRequest {
  platform: 'linux' | 'darwin'
  /** Where the source is cloned (made if missing). */
  srcDir: string
  /** Where the finished OBS is put. */
  prefix: string
  buildType?: 'Release' | 'RelWithDebInfo' | 'Debug'
  /** Switch id -> on/off, for any of COMPILE_TOGGLES. */
  toggles?: Record<string, boolean>
  /** Extra CMake flags typed by hand, e.g. `-DENABLE_BROWSER=ON`. */
  custom?: string
}

export interface CompileStep { id: string; title: string; program: string; args: string[]; cwd?: string }

/** Only `-DNAME=value` flags are accepted from a typed line (and `-G`, `-Wno-dev`), so nothing else can ride along. */
export function parseCustomFlags(line: string): { flags: string[]; refused: string[] } {
  const parts = (line.match(/"[^"]*"|\S+/g) ?? []).map((p) => p.replace(/^"|"$/g, ''))
  const flags: string[] = [], refused: string[] = []
  for (const p of parts) (/^-D[A-Za-z_][A-Za-z0-9_]*(:[A-Z]+)?=[^\s;&|`$<>]*$/.test(p) || p === '-Wno-dev') ? flags.push(p) : refused.push(p)
  return { flags, refused }
}

export const presetFor = (platform: 'linux' | 'darwin') => (platform === 'darwin' ? 'macos' : 'ubuntu')

export function compileSteps(r: CompileRequest): CompileStep[] {
  const known = new Set(COMPILE_TOGGLES.filter((t) => t.platforms.includes(r.platform)).map((t) => t.id))
  const toggles = Object.entries(r.toggles ?? {}).filter(([k]) => known.has(k)).map(([k, v]) => `-D${k}=${v ? 'ON' : 'OFF'}`)
  const portable = r.platform === 'linux' && r.toggles?.ENABLE_PORTABLE_CONFIG
  const { flags } = parseCustomFlags(r.custom ?? '')
  const preset = presetFor(r.platform)
  const buildDir = r.platform === 'darwin' ? 'build_macos' : 'build_ubuntu' // the preset's own binaryDir
  const steps: CompileStep[] = [
    { id: 'clone', title: 'Getting the OBS source', program: 'git', args: ['clone', '--recursive', '--depth', '1', 'https://github.com/obsproject/obs-studio.git', r.srcDir] },
    { id: 'configure', title: 'Preparing the build', program: 'cmake', cwd: r.srcDir, args: ['--preset', preset, `-DCMAKE_BUILD_TYPE=${r.buildType ?? 'RelWithDebInfo'}`, ...toggles, ...flags] },
    { id: 'build', title: 'Building OBS (this is the slow part)', program: 'cmake', cwd: r.srcDir, args: ['--build', buildDir, '--parallel'] },
    { id: 'install', title: 'Putting OBS in its folder', program: 'cmake', cwd: r.srcDir, args: ['--install', buildDir, '--prefix', r.prefix] },
  ]
  void portable
  return steps
}

/** The lines that say what went wrong, from CMake or a compiler, for showing under the log. */
export function findBuildProblems(out: string): string[] {
  const lines = out.split(/\r?\n/)
  const hits = lines.filter((l) => /CMake Error|Could NOT find|Could not find|No package '|fatal error:|error:|undefined reference|Required submodule/i.test(l))
  return [...new Set(hits.map((l) => l.trim()))].slice(0, 12)
}
