import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  exportBundle, planImport, applyImport, readBundleDir, captureLive, initRepo, repoStatus, fetchRepo, pullRepo, pushRepo, setRemote,
  publicRemoteUrl, readActive, fixEncoders, availableEncoders, parseManifest, type Bundle,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-on-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', ...a], { cwd, encoding: 'utf8' }).trim()

describe('which profile OBS opens with (user.ini on OBS 31 and newer)', () => {
  const setupNew = () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    // OBS 31+: the choice is in user.ini; global.ini only has app settings
    fs.writeFileSync(nodePath.join(cfg, 'user.ini'), '[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')
    fs.writeFileSync(nodePath.join(cfg, 'global.ini'), '[General]\nLastVersion=520093697\n')
    return { home, cfg }
  }

  it('is read from user.ini when there is one', () => {
    const { cfg } = setupNew()
    expect(readActive(cfg)).toMatchObject({ profileDir: 'Main', collectionFile: 'Main' })
    // two profiles: the chosen one is the active one in the file
    fs.mkdirSync(nodePath.join(cfg, 'basic/profiles/Other'), { recursive: true }); fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Other/basic.ini'), '[General]\nName=Other\n')
    fs.writeFileSync(nodePath.join(cfg, 'user.ini'), '[Basic]\nProfile=Other\nProfileDir=Other\nSceneCollection=Main\nSceneCollectionFile=Main\n')
    const b = exportBundle({ host: host('linux', nodePath.dirname(cfg)), install: install(cfg), name: 'x' })
    expect(b.manifest.profiles.find((p) => p.id === b.manifest.activeProfile)!.name).toBe('Other')
  })

  it('is written to user.ini (and to global.ini only when it exists), never creating a global.ini', () => {
    const { cfg, home } = setupNew()
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    // a fresh OBS that has already run once (Untitled is its choice)
    const cfg2 = nodePath.join(tmp, 'win', 'obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    fs.writeFileSync(nodePath.join(cfg2, 'user.ini'), '[Basic]\nProfile=Untitled\nProfileDir=Untitled\n')
    fs.writeFileSync(nodePath.join(cfg2, 'global.ini'), '[General]\nLastVersion=520093697\n')
    applyImport(planImport({ bundle: b, install: install(cfg2), host: host('linux', home), activate: true }))
    expect(readActive(cfg2)).toMatchObject({ profile: 'Main', profileDir: 'Main' })
    expect(fs.readFileSync(nodePath.join(cfg2, 'global.ini'), 'utf8')).toContain('LastVersion=520093697') // untouched facts kept
    // an OBS that never ran: user.ini only
    const cfg3 = nodePath.join(tmp, 'never', 'obs-studio'); fs.mkdirSync(cfg3, { recursive: true })
    applyImport(planImport({ bundle: b, install: install(cfg3), host: host('linux', home), activate: true }))
    expect(fs.existsSync(nodePath.join(cfg3, 'user.ini'))).toBe(true)
    expect(fs.existsSync(nodePath.join(cfg3, 'global.ini'))).toBe(false)
    expect(readActive(cfg3).profileDir).toBe('Main')
    // an older OBS (global.ini only): that one
    const cfg4 = nodePath.join(tmp, 'old', 'obs-studio'); fs.mkdirSync(cfg4, { recursive: true }); fs.writeFileSync(nodePath.join(cfg4, 'global.ini'), '[Basic]\nProfile=Untitled\n')
    applyImport(planImport({ bundle: b, install: install(cfg4), host: host('linux', home), activate: true }))
    expect(fs.readFileSync(nodePath.join(cfg4, 'global.ini'), 'utf8')).toContain('ProfileDir=Main')
    expect(fs.existsSync(nodePath.join(cfg4, 'user.ini'))).toBe(false)
  })
})

describe('encoders that this OBS does not have', () => {
  const ini = '[General]\nName=Main\n\n[AdvOut]\nEncoder=obs_nvenc_h264_tex\nRecEncoder=none\nAudioEncoder=ffmpeg_aac\nRecAudioEncoder=libfdk_aac\n\n[SimpleOutput]\nStreamEncoder=apple_h264\nRecEncoder=x264\n'
  const list = new Set(['obs_x264', 'ffmpeg_aac', 'ffmpeg_opus'])

  it('are swapped for ones every OBS has, using OBS\'s own list when it has one', () => {
    const r = fixEncoders(ini, { available: list, target: 'win32' })
    expect(r.fixes.map((f) => `${f.key}:${f.from}>${f.to}`)).toEqual(['Encoder:obs_nvenc_h264_tex>obs_x264', 'RecAudioEncoder:libfdk_aac>ffmpeg_aac', 'StreamEncoder:apple_h264>x264'])
    expect(r.fixes[0].resets).toBe('streamEncoder.json')
    expect(r.text).toContain('Encoder=obs_x264')
    expect(r.text).toContain('RecEncoder=none') // "use the stream encoder" stays
    expect(r.text).toContain('AudioEncoder=ffmpeg_aac')
  })

  it('without a list, only what cannot exist on this system changes; a list that cannot be right is not trusted', () => {
    const win = fixEncoders('[AdvOut]\nEncoder=ffmpeg_vaapi_tex264\nRecAudioEncoder=CoreAudio_AAC\nAudioEncoder=ffmpeg_aac\n', { target: 'win32' })
    expect(win.fixes.map((f) => f.from)).toEqual(['ffmpeg_vaapi_tex264', 'CoreAudio_AAC'])
    expect(fixEncoders('[AdvOut]\nEncoder=jim_nvenc\n', { target: 'win32' }).fixes).toEqual([]) // could be fine: not guessed
    const dir = nodePath.join(tmp, 'cfg'); fs.mkdirSync(nodePath.join(dir, 'plugin_manager'), { recursive: true })
    fs.writeFileSync(nodePath.join(dir, 'plugin_manager/modules.json'), JSON.stringify([{ module_name: 'x', enabled: true, encoders: ['something'] }]))
    expect(availableEncoders(install(dir))).toBeUndefined()
    fs.writeFileSync(nodePath.join(dir, 'plugin_manager/modules.json'), JSON.stringify([{ module_name: 'obs-ffmpeg', enabled: true, encoders: ['ffmpeg_aac', 'obs_x264'] }, { module_name: 'off', enabled: false, encoders: ['jim_nvenc'] }]))
    expect([...availableEncoders(install(dir))!].sort()).toEqual(['ffmpeg_aac', 'obs_x264'])
  })

  it('a loaded profile gets them fixed, says so in plain words, and drops that encoder\'s old settings', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Main/basic.ini'), ini)
    fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Main/streamEncoder.json'), JSON.stringify({ preset2: 'p5', rate_control: 'CBR' }))
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const cfg2 = nodePath.join(tmp, 'there', 'obs-studio'); fs.mkdirSync(nodePath.join(cfg2, 'plugin_manager'), { recursive: true })
    fs.writeFileSync(nodePath.join(cfg2, 'plugin_manager/modules.json'), JSON.stringify([{ module_name: 'obs-ffmpeg', enabled: true, encoders: ['ffmpeg_aac', 'obs_x264'] }]))
    const plan = planImport({ bundle: b, install: install(cfg2), host: host('linux', home) })
    const w = (n: string) => plan.writes.find((x) => x.path.endsWith(n))!.data.toString()
    expect(w('basic.ini')).toContain('Encoder=obs_x264')
    expect(w('streamEncoder.json').trim()).toBe('{}')
    const text = plan.report.warnings.join('\n')
    expect(text).toContain('video encoder for streaming (obs_nvenc_h264_tex) is not available in this OBS, so obs_x264 is used instead')
    expect(text).not.toContain('AudioEncoder (ffmpeg_aac)')
  })
})

describe('a file that knows where its preset lives online', () => {
  it('carries the address, without a password', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    expect(publicRemoteUrl('https://user:ghp_SECRET@github.com/me/set.git')).toBe('https://github.com/me/set.git')
    expect(publicRemoteUrl('git@github.com:me/set.git')).toBe('git@github.com:me/set.git')
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x', repository: publicRemoteUrl('https://u:p@github.com/me/set.git') })
    expect(b.manifest.repository).toEqual({ url: 'https://github.com/me/set.git' })
    expect(JSON.stringify(b.manifest)).not.toContain(':p@')
  })

  it('"behind" is only true after asking the online copy; pulling then brings the changes', async () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const bare = nodePath.join(tmp, 'bare.git'); git(tmp, 'init', '-q', '--bare', '--initial-branch=main', bare)
    const a = nodePath.join(tmp, 'a'); await initRepo(a)
    await captureLive({ host: host('linux', home), install: install(cfg), dir: a, name: 'Mine' })
    expect((await setRemote(a, bare)).ok).toBe(true)
    expect((await pushRepo(a)).status).toBe('pushed')
    // someone else (another computer) pushes
    const other = nodePath.join(tmp, 'other'); git(tmp, 'clone', '-q', bare, other)
    fs.appendFileSync(nodePath.join(other, 'manifest.json'), '\n'); git(other, 'commit', '-qam', 'their change'); git(other, 'push', '-q')
    expect((await repoStatus(a)).behind).toBe(0) // nothing has asked yet
    expect((await fetchRepo(a)).ok).toBe(true)
    expect((await repoStatus(a)).behind).toBe(1)
    expect((await pullRepo(a)).status).toBe('updated')
    expect((await repoStatus(a)).behind).toBe(0)
    // an unreachable address says so instead of pretending
    git(a, 'remote', 'set-url', 'origin', nodePath.join(tmp, 'gone.git'))
    expect((await fetchRepo(a)).ok).toBe(false)
  })
})
