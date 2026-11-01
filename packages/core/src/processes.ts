import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type { Host, ObsInstall } from './detect.js'

/**
 * Which OBS is running, per settings folder. With several OBS around (a Flatpak one, a system one, separate instances),
 * "some OBS is running" must not stop an import into a different one: OBS only rewrites the files of the folder it uses.
 */
export interface ObsProcess {
  pid: number
  /** XDG_CONFIG_HOME of that process, when it was set. */
  configHome?: string
  /** Its environment could be read (so no XDG_CONFIG_HOME in it means the default folder, not "unknown"). */
  envReadable?: boolean
  /** The program file it runs, when it could be read. */
  exe?: string
}

export function parseEnviron(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const kv of raw.split('\0')) {
    const i = kv.indexOf('=')
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1)
  }
  return out
}

/** Linux: walk /proc for processes named obs. Unreadable details are left out, never guessed. */
export function findObsProcessesLinux(procRoot = '/proc'): ObsProcess[] {
  const out: ObsProcess[] = []
  let names: string[] = []
  try { names = fs.readdirSync(procRoot) } catch { return out }
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue
    const dir = nodePath.join(procRoot, n)
    let comm = ''
    try { comm = fs.readFileSync(nodePath.join(dir, 'comm'), 'utf8').trim() } catch { continue }
    if (comm !== 'obs') continue
    const p: ObsProcess = { pid: Number(n) }
    try {
      p.configHome = parseEnviron(fs.readFileSync(nodePath.join(dir, 'environ'), 'utf8')).XDG_CONFIG_HOME || undefined
      p.envReadable = true
    } catch { /* not ours to read */ }
    try { p.exe = fs.readlinkSync(nodePath.join(dir, 'exe')) } catch { /* idem */ }
    out.push(p)
  }
  return out
}

/** Is an OBS running that uses this install's settings folder? Where that cannot be told, any OBS counts (the safe answer). */
export function isInstallRunning(install: ObsInstall, procs: ObsProcess[], host: Pick<Host, 'home' | 'platform'>): boolean {
  if (!procs.length) return false
  if (host.platform !== 'linux') return true
  const posix = nodePath.posix
  return procs.some((p) => {
    if (install.kind === 'linux-portable') return !p.exe || !install.launch?.command || p.exe === install.launch.command
    if (!p.envReadable && !p.exe) return true // nothing readable about it: assume it might be this one
    const dir = posix.join(p.configHome || posix.join(host.home, '.config'), 'obs-studio')
    return dir === install.configDir
  })
}
