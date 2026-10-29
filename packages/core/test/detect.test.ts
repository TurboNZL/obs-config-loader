import { describe, it, expect } from 'vitest'
import { detectInstalls, portableInstall, installedModules, type Host, type Platform } from '../src/index.js'

/** A fake machine: `tree` maps a path to child names (a directory) or null (a file). */
function fake(platform: Platform, home: string, tree: Record<string, string[] | null>, env: Record<string, string> = {}): Host {
  return {
    platform, home, env,
    exists: (p) => p in tree,
    isDir: (p) => Array.isArray(tree[p]),
    listDir: (p) => tree[p] ?? [],
  }
}

describe('detectInstalls', () => {
  it('finds Flatpak, native and Snap on Linux, each with its own config dir', () => {
    const h = fake('linux', '/home/u', {
      '/usr/bin/obs': null,
      '/home/u/.local/share/flatpak/app/com.obsproject.Studio': [],
      '/home/u/.local/share/flatpak/app': ['com.obsproject.Studio', 'com.obsproject.Studio.Plugin.AitumMultistream'],
      '/home/u/.var/app/com.obsproject.Studio': [],
      '/home/u/snap/obs-studio': [],
    })
    const got = detectInstalls(h)
    expect(got.map((i) => i.kind)).toEqual(['linux-native', 'flatpak', 'snap'])
    expect(got[0].configDir).toBe('/home/u/.config/obs-studio')
    expect(got[1].configDir).toBe('/home/u/.var/app/com.obsproject.Studio/config/obs-studio')
    expect(got[1].pluginDirs).toContain('/home/u/.local/share/flatpak/app/com.obsproject.Studio.Plugin.AitumMultistream')
    expect(got[1].launch).toEqual({ command: 'flatpak', args: ['run', 'com.obsproject.Studio'] })
    expect(got[2].configDir).toBe('/home/u/snap/obs-studio/current/.config/obs-studio')
  })

  it('honours XDG_CONFIG_HOME for the native install', () => {
    const h = fake('linux', '/home/u', { '/usr/bin/obs': null }, { XDG_CONFIG_HOME: '/data/cfg' })
    expect(detectInstalls(h)[0].configDir).toBe('/data/cfg/obs-studio')
  })

  it('finds nothing on a bare machine', () => {
    expect(detectInstalls(fake('linux', '/home/u', {}))).toEqual([])
  })

  it('finds the default Windows install and its roaming config', () => {
    const h = fake('win32', 'C:\\Users\\u', {
      'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe': null,
    }, { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', ProgramFiles: 'C:\\Program Files' })
    const [i] = detectInstalls(h)
    expect(i.kind).toBe('windows')
    expect(i.configDir).toBe('C:\\Users\\u\\AppData\\Roaming\\obs-studio')
    expect(i.configExists).toBe(false)
  })

  it('finds macOS', () => {
    const h = fake('darwin', '/Users/u', { '/Applications/OBS.app': [] })
    expect(detectInstalls(h)[0].configDir).toBe('/Users/u/Library/Application Support/obs-studio')
  })
})

describe('portableInstall', () => {
  it('accepts a Linux self-build folder and a Windows portable folder, rejects others', () => {
    const lin = fake('linux', '/home/u', {
      '/opt/obs': ['bin', 'config'], '/opt/obs/bin/obs': null,
      '/opt/obs/config/obs-studio': ['basic'], '/opt/obs/config/obs-studio/basic': [],
    })
    const a = portableInstall(lin, '/opt/obs')
    expect(a).toMatchObject({ kind: 'linux-portable', configDir: '/opt/obs/config/obs-studio', custom: true })
    expect((a as any).launch).toEqual({ command: '/opt/obs/bin/obs', args: ['-p'] })

    const win = fake('win32', 'C:\\Users\\u', {
      'D:\\obs': [], 'D:\\obs\\portable_mode.txt': null, 'D:\\obs\\bin\\64bit\\obs64.exe': null,
    })
    expect(portableInstall(win, 'D:\\obs')).toMatchObject({ kind: 'windows-portable', configDir: 'D:\\obs\\config\\obs-studio' })

    expect(portableInstall(lin, '/tmp')).toHaveProperty('error')
  })
})

describe('installedModules', () => {
  it('lists native module basenames under plugin dirs', () => {
    const h = fake('linux', '/home/u', {
      '/p': ['obs-multi-rtmp', 'other'],
      '/p/obs-multi-rtmp': ['bin'], '/p/obs-multi-rtmp/bin': ['64bit'], '/p/obs-multi-rtmp/bin/64bit': ['obs-multi-rtmp.so'],
      '/p/other': ['libfoo.so'],
    })
    const mods = installedModules(h, { pluginDirs: ['/p'] } as any)
    expect([...mods].sort()).toEqual(['foo', 'obs-multi-rtmp'])
  })
})
