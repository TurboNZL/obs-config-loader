/**
 * Start options for OBS. Every flag in the list was read out of OBS Studio's own source (frontend/OBSApp.cpp and obs-main.cpp,
 * November 2026), so none of them is a guess. Anything else (for example browser-engine switches) goes in the free-text box,
 * which is passed on exactly as typed.
 */
export interface LaunchFlag { id: string; label: string; help: string }

export const LAUNCH_FLAGS: LaunchFlag[] = [
  { id: '--minimize-to-tray', label: 'Start minimised to the tray', help: 'OBS opens without showing its window.' },
  { id: '--studio-mode', label: 'Start in Studio Mode', help: 'Shows the preview and program side by side.' },
  { id: '--disable-updater', label: 'Do not check for OBS updates', help: 'Stops the built-in update prompt.' },
  { id: '--disable-missing-files-check', label: 'Skip the missing files check', help: 'OBS will not stop at start to list files it cannot find.' },
  { id: '--only-bundled-plugins', label: 'Only load the plugins that come with OBS', help: 'Useful to find out if a plugin causes a crash.' },
  { id: '--safe-mode', label: 'Safe mode', help: 'Starts without third-party plugins and scripts.' },
  { id: '--always-on-top', label: 'Keep the window on top', help: '' },
  { id: '--allow-opengl', label: 'Allow OpenGL (Windows)', help: 'Only for graphics cards that cannot use Direct3D.' },
  { id: '--startstreaming', label: 'Start streaming when OBS opens', help: 'Careful: this goes live straight away.' },
  { id: '--startrecording', label: 'Start recording when OBS opens', help: '' },
  { id: '--startvirtualcam', label: 'Start the virtual camera', help: '' },
  { id: '--verbose', label: 'Write a detailed log', help: 'For finding problems.' },
]

/** Split a typed line into arguments, keeping "quoted parts" together. */
export function splitArgs(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) out.push(m[1] ?? m[2])
  return out
}

/** The extra arguments to add when starting an OBS: the ticked known flags first, then the typed ones. */
export function launchArgs(o: { flags?: string[]; custom?: string } | undefined): string[] {
  if (!o) return []
  const known = new Set(LAUNCH_FLAGS.map((f) => f.id))
  return [...(o.flags ?? []).filter((f) => known.has(f)), ...splitArgs(o.custom ?? '')]
}
