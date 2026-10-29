import * as os from 'node:os'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type { Platform } from './types.js'
import { pathModule } from './tokens.js'

/** Everything detection needs from the machine, so it can be tested with a fake one. */
export interface Host {
  platform: Platform
  home: string
  env: Record<string, string | undefined>
  exists(p: string): boolean
  isDir(p: string): boolean
  listDir(p: string): string[]
}

export function realHost(): Host {
  return {
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    home: os.homedir(),
    env: process.env,
    exists: (p) => fs.existsSync(p),
    isDir: (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } },
    listDir: (p) => { try { return fs.readdirSync(p) } catch { return [] } },
  }
}

export type InstallKind =
  | 'windows' | 'windows-portable'
  | 'macos'
  | 'linux-native' | 'flatpak' | 'snap' | 'linux-portable'

export interface ObsInstall {
  /** Stable id: kind + config dir. */
  id: string
  kind: InstallKind
  label: string
  platform: Platform
  /** The OBS config dir (the one that holds basic/, global.ini, plugin_config/). */
  configDir: string
  /** Where third-party plugins live for this install (may not exist yet). */
  pluginDirs: string[]
  /** Whether the config dir already exists (false = OBS installed but never started). */
  configExists: boolean
  /** Launch hint for the UI (informational). */
  launch?: { command: string; args: string[]; env?: Record<string, string> }
  /** User-added (portable) rather than auto-detected. */
  custom?: boolean
}

const FLATPAK_ID = 'com.obsproject.Studio'

function mk(host: Host, i: Omit<ObsInstall, 'id' | 'configExists' | 'platform'>): ObsInstall {
  return { ...i, platform: host.platform, id: `${i.kind}:${i.configDir}`, configExists: host.exists(i.configDir) }
}

/** Find OBS installs the normal way for the platform. Never throws. */
export function detectInstalls(host: Host = realHost()): ObsInstall[] {
  const out: ObsInstall[] = []
  const p = pathModule(host.platform)
  if (host.platform === 'win32') {
    const appdata = host.env.APPDATA ?? p.join(host.home, 'AppData', 'Roaming')
    const pf = host.env.ProgramFiles ?? 'C:\\Program Files'
    const exe = p.join(pf, 'obs-studio', 'bin', '64bit', 'obs64.exe')
    const cfg = p.join(appdata, 'obs-studio')
    if (host.exists(exe) || host.exists(cfg)) {
      out.push(mk(host, {
        kind: 'windows', label: 'OBS Studio (installed)', configDir: cfg,
        pluginDirs: [p.join(cfg, 'plugins'), p.join(pf, 'obs-studio', 'obs-plugins')],
        launch: host.exists(exe) ? { command: exe, args: [] } : undefined,
      }))
    }
  } else if (host.platform === 'darwin') {
    const cfg = p.join(host.home, 'Library', 'Application Support', 'obs-studio')
    const app = '/Applications/OBS.app'
    if (host.exists(app) || host.exists(cfg)) {
      out.push(mk(host, {
        kind: 'macos', label: 'OBS Studio (macOS)', configDir: cfg,
        pluginDirs: [p.join(cfg, 'plugins'), '/Library/Application Support/obs-studio/plugins'],
        launch: { command: 'open', args: ['-a', 'OBS'] },
      }))
    }
  } else {
    // Native (.deb, rpm, AUR, distro packages): XDG_CONFIG_HOME is honoured by OBS itself.
    const xdg = host.env.XDG_CONFIG_HOME || p.join(host.home, '.config')
    const nativeBin = ['/usr/bin/obs', '/usr/local/bin/obs'].find((b) => host.exists(b))
    const nativeCfg = p.join(xdg, 'obs-studio')
    if (nativeBin) {
      out.push(mk(host, {
        kind: 'linux-native', label: 'OBS Studio (system package)', configDir: nativeCfg,
        pluginDirs: [p.join(nativeCfg, 'plugins'), '/usr/lib/obs-plugins', '/usr/lib/x86_64-linux-gnu/obs-plugins'],
        launch: { command: nativeBin, args: [] },
      }))
    }
    // Flatpak: per-app data lives in ~/.var/app/<id>.
    const flatpakApp = [
      p.join(host.home, '.local', 'share', 'flatpak', 'app', FLATPAK_ID),
      '/var/lib/flatpak/app/' + FLATPAK_ID,
    ].find((d) => host.exists(d))
    const flatpakCfg = p.join(host.home, '.var', 'app', FLATPAK_ID, 'config', 'obs-studio')
    if (flatpakApp || host.exists(p.join(host.home, '.var', 'app', FLATPAK_ID))) {
      out.push(mk(host, {
        kind: 'flatpak', label: 'OBS Studio (Flatpak)', configDir: flatpakCfg,
        // Flatpak plugins are either dropped into the config dir or installed as Flatpak extensions.
        pluginDirs: [
          p.join(flatpakCfg, 'plugins'),
          ...extensionDirs(host, flatpakApp ? p.dirname(flatpakApp) : undefined),
        ],
        launch: { command: 'flatpak', args: ['run', FLATPAK_ID] },
      }))
    }
    // Snap
    const snapCfg = p.join(host.home, 'snap', 'obs-studio', 'current', '.config', 'obs-studio')
    if (host.exists(p.join(host.home, 'snap', 'obs-studio'))) {
      out.push(mk(host, {
        kind: 'snap', label: 'OBS Studio (Snap)', configDir: snapCfg,
        pluginDirs: [p.join(snapCfg, 'plugins')],
        launch: { command: 'snap', args: ['run', 'obs-studio'] },
      }))
    }
  }
  return out
}

/** Flatpak plugin extensions are separate refs named com.obsproject.Studio.Plugin.*. */
function extensionDirs(host: Host, appRoot: string | undefined): string[] {
  const roots = [
    appRoot,
    '/var/lib/flatpak/app',
    pathModule('linux').join(host.home, '.local/share/flatpak/app'),
  ].filter((x): x is string => !!x)
  const dirs: string[] = []
  for (const root of new Set(roots)) {
    for (const name of host.listDir(root)) {
      if (name.startsWith(FLATPAK_ID + '.Plugin.')) dirs.push(`${root}/${name}`)
    }
  }
  return dirs
}

/**
 * A portable install is a folder, not a place: the user picks it. We accept the folder that holds
 * the OBS tree (the one with `config/` and `portable_mode.txt`, or `bin/obs` for a Linux self-build)
 * or the config folder itself.
 */
export function portableInstall(host: Host, folder: string): ObsInstall | { error: string } {
  const p = pathModule(host.platform)
  const candidates = [
    p.join(folder, 'config', 'obs-studio'),
    p.join(folder, 'obs', 'config', 'obs-studio'), // this app's own Windows layout
    folder, // the config dir itself
  ]
  const cfg = candidates.find((c) => host.isDir(p.join(c, 'basic')) || host.exists(p.join(c, 'global.ini')))
  const root = cfg && cfg !== folder ? p.dirname(p.dirname(cfg)) : folder
  const cfgDir = cfg ?? candidates[0]
  const looksLikeObs =
    !!cfg ||
    host.exists(p.join(folder, 'portable_mode.txt')) ||
    host.exists(p.join(folder, 'bin', 'obs')) ||
    host.exists(p.join(folder, 'bin', '64bit', 'obs64.exe')) ||
    host.exists(p.join(folder, 'obs', 'bin', '64bit', 'obs64.exe'))
  if (!looksLikeObs) {
    return { error: 'That folder does not look like an OBS install: no config/obs-studio, portable_mode.txt or OBS binary found.' }
  }
  const win = host.platform === 'win32'
  const winExe = [p.join(root, 'bin', '64bit', 'obs64.exe'), p.join(root, 'obs', 'bin', '64bit', 'obs64.exe')].find((e) => host.exists(e))
  const linuxExe = p.join(root, 'bin', 'obs')
  return mk(host, {
    kind: win ? 'windows-portable' : 'linux-portable',
    label: `OBS Studio (portable: ${nodePath.basename(root)})`,
    configDir: cfgDir,
    pluginDirs: [p.join(cfgDir, 'plugins')],
    custom: true,
    launch: win
      ? winExe ? { command: winExe, args: ['--portable'] } : undefined
      : host.exists(linuxExe) ? { command: linuxExe, args: ['-p'] } : undefined,
  })
}
