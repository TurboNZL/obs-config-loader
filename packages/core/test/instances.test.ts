import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import {
  instancePaths, buildInstance, seedInstance, instanceSlug, describeLaunch, findObsProcessesLinux, isInstallRunning, parseEnviron,
  detectInstalls, type Host, type ObsInstall, type Platform,
} from '../src/index.js'

const fake = (platform: Platform, home: string, tree: Record<string, string[] | null>, env: Record<string, string> = {}): Host => ({
  platform, home, env, exists: (p) => p in tree, isDir: (p) => Array.isArray(tree[p]), listDir: (p) => tree[p] ?? [],
})
const linuxBoth = fake('linux', '/home/u', {
  '/usr/bin/obs': null,
  '/home/u/.var/app/com.obsproject.Studio': [], '/home/u/.local/share/flatpak/app/com.obsproject.Studio': [], '/home/u/.local/share/flatpak/app': [],
})
const [native, flatpak] = detectInstalls(linuxBoth)

describe('instance folders', () => {
  it('a system-package instance lives under the app\'s data folder with its own config and data homes', () => {
    const r = instancePaths(native, linuxBoth, 'Light & fast')
    expect(r).toEqual({ ok: true, paths: {
      configHome: '/home/u/.local/share/obs-config-loader/instances/light-fast/config',
      dataHome: '/home/u/.local/share/obs-config-loader/instances/light-fast/data',
      configDir: '/home/u/.local/share/obs-config-loader/instances/light-fast/config/obs-studio',
      pluginsDir: '/home/u/.local/share/obs-config-loader/instances/light-fast/config/obs-studio/plugins',
    } })
  })
  it('honours XDG_DATA_HOME', () => {
    const h = fake('linux', '/home/u', { '/usr/bin/obs': null }, { XDG_DATA_HOME: '/data' })
    const r = instancePaths(detectInstalls(h)[0], h, 'x')
    expect(r.ok && r.paths.configHome).toBe('/data/obs-config-loader/instances/x/config')
  })
  it('a Flatpak instance stays inside the folders the sandbox really shares', () => {
    const r = instancePaths(flatpak, linuxBoth, 'Heavy')
    expect(r).toMatchObject({ ok: true, paths: {
      configHome: '/home/u/.var/app/com.obsproject.Studio/config/instances/heavy',
      dataHome: '/home/u/.var/app/com.obsproject.Studio/data/instances/heavy',
    } })
  })
  it('says why where it cannot work, and never offers to', () => {
    const win = fake('win32', 'C:\\Users\\u', {})
    const mac = fake('darwin', '/Users/u', {})
    const winInstall = { kind: 'windows', id: 'w' } as ObsInstall
    expect(instancePaths(winInstall, win, 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('portable') })
    expect(instancePaths({ kind: 'macos', id: 'm' } as ObsInstall, mac, 'x')).toMatchObject({ ok: false })
    expect(instancePaths({ kind: 'linux-portable', id: 'p' } as ObsInstall, linuxBoth, 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('already its own instance') })
    expect(instancePaths({ kind: 'snap', id: 's' } as ObsInstall, linuxBoth, 'x')).toMatchObject({ ok: false })
    expect(instancePaths({ kind: 'instance', id: 'i' } as ObsInstall, linuxBoth, 'x')).toMatchObject({ ok: false })
  })
  it('makes safe folder names', () => {
    expect(instanceSlug('  My OBS / Aitum!! ')).toBe('my-obs-aitum')
    expect(instanceSlug('!!!')).toBe('obs')
    expect(instanceSlug('../../etc')).toBe('etc') // never escapes the instances folder
  })
})

describe('starting an instance', () => {
  it('native: the same program, --multi, and its own config and data homes in the environment', () => {
    const p = instancePaths(native, linuxBoth, 'Light'); if (!p.ok) throw new Error()
    const i = buildInstance(native, linuxBoth, 'Light', p.paths)
    expect(i).toMatchObject({ kind: 'instance', custom: true, configDir: p.paths.configDir, pluginDirs: [p.paths.pluginsDir], instance: { name: 'Light', of: native.id, baseKind: 'linux-native' } })
    expect(i.launch).toEqual({ command: '/usr/bin/obs', args: ['--multi'], env: { XDG_CONFIG_HOME: p.paths.configHome, XDG_DATA_HOME: p.paths.dataHome } })
    expect(describeLaunch(i)).toBe('XDG_CONFIG_HOME="/home/u/.local/share/obs-config-loader/instances/light/config" XDG_DATA_HOME="/home/u/.local/share/obs-config-loader/instances/light/data" /usr/bin/obs --multi')
  })
  it('flatpak: the variables go through flatpak\'s own --env, before the app id', () => {
    const p = instancePaths(flatpak, linuxBoth, 'Heavy'); if (!p.ok) throw new Error()
    const i = buildInstance(flatpak, linuxBoth, 'Heavy', p.paths)
    expect(i.launch).toEqual({ command: 'flatpak', args: [
      'run', `--env=XDG_CONFIG_HOME=${p.paths.configHome}`, `--env=XDG_DATA_HOME=${p.paths.dataHome}`, 'com.obsproject.Studio', '--multi',
    ] })
    expect(i.launch!.env).toBeUndefined()
  })
  it('two instances never share an id or a folder', () => {
    const a = instancePaths(native, linuxBoth, 'A'), b = instancePaths(native, linuxBoth, 'B')
    if (!a.ok || !b.ok) throw new Error()
    expect(buildInstance(native, linuxBoth, 'A', a.paths).id).not.toBe(buildInstance(native, linuxBoth, 'B', b.paths).id)
  })
})

describe('seeding', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-inst-')) })
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

  it('copies scenes, profiles and global settings but never plugins, and never over existing settings', () => {
    const from = nodePath.join(tmp, 'from'), to = nodePath.join(tmp, 'to/obs-studio')
    fs.mkdirSync(nodePath.join(from, 'basic/scenes'), { recursive: true }); fs.writeFileSync(nodePath.join(from, 'basic/scenes/Main.json'), '{}')
    fs.mkdirSync(nodePath.join(from, 'plugins/heavy'), { recursive: true }); fs.writeFileSync(nodePath.join(from, 'plugins/heavy/x.so'), 'bin')
    fs.writeFileSync(nodePath.join(from, 'global.ini'), '[Basic]\n')
    expect(seedInstance(from, to)).toEqual({ copied: true })
    expect(fs.existsSync(nodePath.join(to, 'basic/scenes/Main.json'))).toBe(true)
    expect(fs.existsSync(nodePath.join(to, 'global.ini'))).toBe(true)
    expect(fs.existsSync(nodePath.join(to, 'plugins'))).toBe(false)
    fs.writeFileSync(nodePath.join(to, 'global.ini'), '[Basic]\nMine=1\n')
    expect(seedInstance(from, to)).toEqual({ copied: false })
    expect(fs.readFileSync(nodePath.join(to, 'global.ini'), 'utf8')).toContain('Mine=1')
  })
  it('an empty source gives an empty instance (OBS makes its own defaults)', () => {
    expect(seedInstance(nodePath.join(tmp, 'nothing'), nodePath.join(tmp, 'new/obs-studio'))).toEqual({ copied: false })
  })
})

describe('which OBS is running', () => {
  let proc: string
  beforeEach(() => { proc = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-proc-')) })
  afterEach(() => { fs.rmSync(proc, { recursive: true, force: true }) })
  const addProc = (pid: number, comm: string, env: Record<string, string> | null, exe?: string) => {
    const d = nodePath.join(proc, String(pid)); fs.mkdirSync(d)
    fs.writeFileSync(nodePath.join(d, 'comm'), comm + '\n')
    if (env) fs.writeFileSync(nodePath.join(d, 'environ'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\0') + '\0')
    if (exe) fs.symlinkSync(exe, nodePath.join(d, 'exe'))
  }
  const h = { home: '/home/u', platform: 'linux' as const }
  const inst = (configDir: string, kind: ObsInstall['kind'] = 'linux-native'): ObsInstall => ({ id: configDir, kind, configDir } as ObsInstall)

  it('parses an environ block', () => {
    expect(parseEnviron('A=1\0XDG_CONFIG_HOME=/x y\0B=\0')).toMatchObject({ A: '1', XDG_CONFIG_HOME: '/x y' })
  })
  it('finds only OBS processes, with their settings folder', () => {
    addProc(100, 'obs', { XDG_CONFIG_HOME: '/data/inst/config' }, '/usr/bin/obs'); addProc(200, 'firefox', { HOME: '/home/u' }); fs.mkdirSync(nodePath.join(proc, 'self'))
    const p = findObsProcessesLinux(proc)
    expect(p).toEqual([{ pid: 100, configHome: '/data/inst/config', envReadable: true, exe: '/usr/bin/obs' }])
  })
  it('a running instance does not block the main install, and the other way round', () => {
    addProc(1, 'obs', { XDG_CONFIG_HOME: '/data/inst/config' })
    const procs = findObsProcessesLinux(proc)
    expect(isInstallRunning(inst('/data/inst/config/obs-studio', 'instance'), procs, h)).toBe(true)
    expect(isInstallRunning(inst('/home/u/.config/obs-studio'), procs, h)).toBe(false)
    fs.rmSync(nodePath.join(proc, '1'), { recursive: true }); addProc(2, 'obs', {})
    const main = findObsProcessesLinux(proc)
    expect(isInstallRunning(inst('/home/u/.config/obs-studio'), main, h)).toBe(true)
    expect(isInstallRunning(inst('/data/inst/config/obs-studio', 'instance'), main, h)).toBe(false)
  })
  it('a Flatpak OBS counts for the Flatpak install only', () => {
    addProc(3, 'obs', { XDG_CONFIG_HOME: '/home/u/.var/app/com.obsproject.Studio/config' })
    const procs = findObsProcessesLinux(proc)
    expect(isInstallRunning(inst('/home/u/.var/app/com.obsproject.Studio/config/obs-studio', 'flatpak'), procs, h)).toBe(true)
    expect(isInstallRunning(inst('/home/u/.config/obs-studio'), procs, h)).toBe(false)
  })
  it('when nothing can be read about a process, it is assumed to be the one in question (never import over a live OBS)', () => {
    addProc(4, 'obs', null)
    expect(isInstallRunning(inst('/anything'), findObsProcessesLinux(proc), h)).toBe(true)
  })
  it('nothing running means not running; other systems keep the any-OBS rule', () => {
    expect(isInstallRunning(inst('/x'), [], h)).toBe(false)
    expect(isInstallRunning(inst('C:\\x'), [{ pid: 1 }], { home: 'C:\\u', platform: 'win32' })).toBe(true)
  })
})
