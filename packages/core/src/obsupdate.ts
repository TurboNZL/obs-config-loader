import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import { OBS_RELEASE_API, downloadFile, extractZipSafe } from './obsinstall.js'
import type { InstallKind } from './detect.js'

export async function latestObsVersion(f: typeof fetch = fetch): Promise<string> {
  const res = await f(OBS_RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'obs-config-loader' } })
  if (!res.ok) throw new Error(`OBS's release page did not answer (${res.status}).`)
  const j = (await res.json()) as { tag_name?: string }
  if (!j.tag_name) throw new Error('OBS\'s release page did not say which version is newest.')
  return j.tag_name.replace(/^v/i, '')
}

export type UpdateMethod = 'portable-zip' | 'windows-installer' | 'apt' | 'flatpak' | 'snap' | 'manual'
export interface UpdatePlan { method: UpdateMethod; /** What pressing the button does, in words. */ explain: string; command?: { program: string; args: string[] } }

/** How each kind of OBS is brought up to date, without a terminal. Linux package managers ask for permission through the system's own prompt. */
export function updatePlan(kind: InstallKind): UpdatePlan {
  switch (kind) {
    case 'windows-portable': return { method: 'portable-zip', explain: 'Downloads the newest OBS and replaces the program files in this folder. Your settings, scenes and added plugins stay where they are.' }
    case 'windows': return { method: 'windows-installer', explain: 'Downloads OBS\'s own installer and starts it. Windows asks for permission, and OBS is updated in place.' }
    case 'flatpak': return { method: 'flatpak', explain: 'Updates the OBS Flatpak and its plugin extensions (no password needed for a user install).', command: { program: 'flatpak', args: ['update', '-y', 'com.obsproject.Studio'] } }
    case 'snap': return { method: 'snap', explain: 'Updates the OBS snap. Your system asks for permission.', command: { program: 'pkexec', args: ['snap', 'refresh', 'obs-studio'] } }
    case 'linux-native': return { method: 'apt', explain: 'Updates OBS through your system\'s package manager. Your system asks for permission. (Works on Ubuntu/Debian; other systems: update OBS with your usual tool.)', command: { program: 'pkexec', args: ['apt-get', 'install', '--only-upgrade', '-y', 'obs-studio'] } }
    default: return { method: 'manual', explain: 'This kind of OBS is updated by hand (download the new version from obsproject.com).' }
  }
}

/** Program folders replaced by an update; everything else in a portable OBS (config/, portable_mode.txt, added files) is left alone. */
const PROGRAM_DIRS = ['bin', 'data', 'obs-plugins']

function copyOver(from: string, to: string) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = nodePath.join(from, e.name), d = nodePath.join(to, e.name)
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyOver(s, d) } else { fs.mkdirSync(nodePath.dirname(d), { recursive: true }); fs.copyFileSync(s, d) }
  }
}

/** Update a portable OBS in place: new program files over the old ones, nothing deleted. */
export async function updatePortableObs(root: string, onProgress: (text: string, done?: number, total?: number) => void, f: typeof fetch = fetch): Promise<string> {
  const { latestWindowsPortable } = await import('./obsinstall.js')
  onProgress('Looking up the newest OBS Studio…')
  const rel = await latestWindowsPortable(f)
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obs-update-'))
  try {
    const zip = nodePath.join(tmp, rel.name)
    const sha = await downloadFile(rel.url, zip, (d, t) => onProgress(`Downloading OBS ${rel.version}…`, d, t || rel.size), f)
    if (rel.sha256 && rel.sha256.toLowerCase() !== sha) throw new Error('The download does not match the fingerprint OBS publishes, so it was thrown away. Try again.')
    const stage = nodePath.join(tmp, 'new')
    onProgress('Unpacking…')
    await extractZipSafe(zip, stage)
    if (!fs.existsSync(nodePath.join(stage, 'bin/64bit/obs64.exe'))) throw new Error('The download did not contain OBS.')
    onProgress('Replacing the program files…')
    for (const d of PROGRAM_DIRS) if (fs.existsSync(nodePath.join(stage, d))) { fs.mkdirSync(nodePath.join(root, d), { recursive: true }); copyOver(nodePath.join(stage, d), nodePath.join(root, d)) }
    return rel.version
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
