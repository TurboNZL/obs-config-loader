import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type { Host, InstallKind, ObsInstall } from './detect.js'

/**
 * A second OBS with its own settings and plugins, started from the same program. OBS finds its config in
 * `$XDG_CONFIG_HOME/obs-studio` (libobs/util/platform-nix.c) and user plugins in the config and data homes, and
 * `--multi` lets several run at once (frontend/obs-main.cpp), so a different XDG_CONFIG_HOME / XDG_DATA_HOME per
 * instance is all it takes. That only works where OBS reads those variables: Linux. Windows and macOS ask the OS for
 * the folder, so they cannot be redirected this way.
 */
export interface InstancePaths {
  /** Becomes XDG_CONFIG_HOME for the instance. */
  configHome: string
  /** Becomes XDG_DATA_HOME for the instance. */
  dataHome: string
  /** The OBS config folder inside it. */
  configDir: string
  /** Where this instance's own plugins go (other instances never load them). */
  pluginsDir: string
}

export type InstanceSupport = { ok: true; paths: InstancePaths } | { ok: false; reason: string }

const FLATPAK_ID = 'com.obsproject.Studio'

export function instanceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'obs'
}

const KINDS_WITH_SUPPORT: InstallKind[] = ['linux-native', 'flatpak']

/** Where an instance of `base` named `name` keeps its files, or why this kind of install cannot have instances. */
export function instancePaths(base: ObsInstall, host: Host, name: string): InstanceSupport {
  const slug = instanceSlug(name)
  if (host.platform !== 'linux') {
    return { ok: false, reason: `On ${host.platform === 'win32' ? 'Windows' : 'macOS'} OBS takes its settings folder from the system, so a second one cannot be redirected. Use a portable copy of OBS instead: each portable folder is its own instance (add it under OBS installs).` }
  }
  if (base.kind === 'linux-portable') return { ok: false, reason: 'A portable OBS folder is already its own instance. Copy the folder to make another.' }
  if (base.kind === 'snap') return { ok: false, reason: 'Snap runs OBS in its own sandbox that cannot be pointed at another settings folder.' }
  if (base.kind === 'instance') return { ok: false, reason: 'Make the instance from the OBS install it shares a program with, not from another instance.' }
  if (!KINDS_WITH_SUPPORT.includes(base.kind)) return { ok: false, reason: 'This kind of install cannot have separate instances.' }
  const p = nodePath.posix
  let configHome: string, dataHome: string
  if (base.kind === 'flatpak') {
    // Inside the Flatpak sandbox only ~/.var/app/<id>/{config,data,cache} are real, writable and at the same path: stay inside them.
    const app = p.join(host.home, '.var', 'app', FLATPAK_ID)
    configHome = p.join(app, 'config', 'instances', slug)
    dataHome = p.join(app, 'data', 'instances', slug)
  } else {
    const dataRoot = host.env.XDG_DATA_HOME || p.join(host.home, '.local', 'share')
    const root = p.join(dataRoot, 'obs-config-loader', 'instances', slug)
    configHome = p.join(root, 'config')
    dataHome = p.join(root, 'data')
  }
  return { ok: true, paths: { configHome, dataHome, configDir: p.join(configHome, 'obs-studio'), pluginsDir: p.join(configHome, 'obs-studio', 'plugins') } }
}

/** The install entry for an instance, with the command that starts it. */
export function buildInstance(base: ObsInstall, host: Host, name: string, paths: InstancePaths): ObsInstall {
  const env = { XDG_CONFIG_HOME: paths.configHome, XDG_DATA_HOME: paths.dataHome }
  let launch: ObsInstall['launch']
  if (base.kind === 'flatpak') {
    // `--env` is Flatpak's own way to set a variable in the app; whether it overrides the sandbox's XDG_CONFIG_HOME is
    // checked after launch (the instance's folder must appear), never assumed.
    launch = { command: 'flatpak', args: ['run', `--env=XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME}`, `--env=XDG_DATA_HOME=${env.XDG_DATA_HOME}`, FLATPAK_ID, '--multi'] }
  } else {
    launch = { command: base.launch?.command ?? 'obs', args: [...(base.launch?.args ?? []), '--multi'], env }
  }
  return {
    id: `instance:${paths.configDir}`, kind: 'instance', label: `${name} (separate OBS)`, platform: host.platform,
    configDir: paths.configDir, pluginDirs: [paths.pluginsDir, nodePath.posix.join(paths.dataHome, 'obs-studio', 'plugins')], configExists: host.exists(paths.configDir), custom: true, launch,
    instance: { name, of: base.id, baseKind: base.kind, configHome: paths.configHome, dataHome: paths.dataHome },
  }
}

/**
 * Start the instance with its own settings from the first launch: copy the scenes, profiles and global settings of an
 * existing install (never its plugins, which is the point of having a separate one). Does nothing if the instance already has settings.
 */
export function seedInstance(fromConfigDir: string, toConfigDir: string): { copied: boolean } {
  if (fs.existsSync(nodePath.join(toConfigDir, 'basic')) || fs.existsSync(nodePath.join(toConfigDir, 'global.ini')) || fs.existsSync(nodePath.join(toConfigDir, 'user.ini'))) return { copied: false }
  fs.mkdirSync(toConfigDir, { recursive: true })
  let copied = false
  const basic = nodePath.join(fromConfigDir, 'basic')
  if (fs.existsSync(basic)) { fs.cpSync(basic, nodePath.join(toConfigDir, 'basic'), { recursive: true }); copied = true }
  for (const name of ['global.ini', 'user.ini']) {
    const g = nodePath.join(fromConfigDir, name)
    if (fs.existsSync(g)) { fs.copyFileSync(g, nodePath.join(toConfigDir, name)); copied = true }
  }
  return { copied }
}

/** The command line of an instance as one copyable line (for the "what is this running" view). */
export function describeLaunch(i: ObsInstall): string {
  if (!i.launch) return ''
  const env = Object.entries(i.launch.env ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`)
  return [...env, i.launch.command, ...i.launch.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' ')
}
