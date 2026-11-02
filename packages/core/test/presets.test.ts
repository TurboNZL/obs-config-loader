import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import {
  captureLive, initRepo, repoLog, exportBundle, planImport, applyImport, readBundleDir, writeBundleDir,
  parseObsVersion, compareVersions, applyVersions, parseFlatpakPlugins, parsePlistVersion,
  renamePreset, renameSceneLayout, renameOutputSetting, renameSceneOrSource, listNames, RenameError, type Manifest,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-pre-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function setup() {
  const home = nodePath.join(tmp, 'home')
  const { cfg } = makeSource(home)
  return { home, cfg, dir: nodePath.join(tmp, 'repo'), h: host('linux', home), inst: install(cfg) }
}
const addScript = (home: string, cfg: string) => {
  const py = nodePath.join(home, 'tools', 'switcher.py')
  fs.mkdirSync(nodePath.dirname(py), { recursive: true })
  fs.writeFileSync(py, 'print("hi")\n')
  const f = nodePath.join(cfg, 'basic/scenes/Main.json')
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  j.modules = { 'scripts-tool': [{ path: py, settings: { status: 'Stopped' } }] }
  fs.writeFileSync(f, JSON.stringify(j))
  return py
}
const addWebsocket = (cfg: string, pw = 'ws-SECRET789') => {
  const d = nodePath.join(cfg, 'plugin_config', 'obs-websocket')
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(nodePath.join(d, 'config.json'), JSON.stringify({ server_enabled: true, server_port: 4455, auth_required: true, server_password: pw, first_load: false }))
}

describe('versions', () => {
  it('reads the OBS version from global.ini, compares, and never goes backwards', () => {
    expect(parseObsVersion('[General]\nLastVersion=520093697\n')).toBe('31.0.1') // 31<<24 | 0<<16 | 1
    expect(parseObsVersion('[General]\nLastVersion=5\n')).toBeUndefined()
    expect(parseObsVersion('')).toBeUndefined()
    expect(compareVersions('31.0.2', '30.2.3')).toBe(1)
    expect(compareVersions('30.2', '30.2.0')).toBe(0)
    const m = { plugins: [{ id: 'obs-multi-rtmp', name: 'x', provides: [{ kind: 'module', id: 'obs-multi-rtmp' }] }] } as unknown as Manifest
    applyVersions(m, { savedWithObs: '31.0.0', plugins: [{ id: 'obs-multi-rtmp', version: '0.7.0' }] } as unknown as Manifest, { obs: '30.2.0', plugins: { obsmultirtmp: '0.6.0' } })
    expect(m.savedWithObs).toBe('31.0.0')
    expect(m.plugins[0].version).toBe('0.7.0')
    expect(parseFlatpakPlugins('com.obsproject.Studio.Plugin.AitumMultistream\t1.2.3\norg.x\t1\n')).toEqual({ aitummultistream: '1.2.3' })
    expect(parsePlistVersion('<key>CFBundleShortVersionString</key>\n<string>2.4.0</string>')).toBe('2.4.0')
  })

  it('is recorded in the setup, kept stable across saves, and warns on a computer with older OBS', async () => {
    const { dir, h, inst, cfg } = setup()
    fs.appendFileSync(nodePath.join(cfg, 'global.ini'), '')
    await initRepo(dir)
    const versions = { obs: '31.0.2', plugins: { obsmultirtmp: '0.6.4' } }
    await captureLive({ host: h, install: inst, dir, name: 'Mine', versions })
    const m = readBundleDir(dir).manifest
    expect(m.savedWithObs).toBe('31.0.2')
    expect(m.plugins.find((p) => p.id === 'obs-multi-rtmp')?.version).toBe('0.6.4')
    // another computer, older OBS and plugin, saves the same setup: nothing changes, so no commit
    expect(await captureLive({ host: h, install: inst, dir, versions: { obs: '30.1.0', plugins: { obsmultirtmp: '0.5.0' } } })).toEqual({ status: 'unchanged' })
    expect((await repoLog(dir)).length).toBe(1)

    const notes = planImport({ bundle: readBundleDir(dir), install: inst, host: h, installed: { obs: '30.1.0', plugins: { obsmultirtmp: '0.5.0' } } }).report.warnings.join('\n')
    expect(notes).toContain('saved with OBS 31.0.2')
    expect(notes).toContain('Multiple RTMP outputs: saved with version 0.6.4')
    const quiet = planImport({ bundle: readBundleDir(dir), install: inst, host: h, installed: { obs: '31.0.2', plugins: { obsmultirtmp: '0.6.4' } } }).report.warnings.join('\n')
    expect(quiet).not.toContain('saved with')
  })
})

describe('scripts and remote control', () => {
  it('keeps an OBS script with the setup, even in a git folder, and puts it back with the path fixed', async () => {
    const { home, cfg, dir, h, inst } = setup()
    const py = addScript(home, cfg)
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const m = readBundleDir(dir).manifest
    const a = m.assets.find((x) => x.filename === 'switcher.py')!
    expect(a).toMatchObject({ role: 'script', mode: 'bundled' })
    expect(fs.readFileSync(nodePath.join(dir, `scripts/${a.id}/switcher.py`), 'utf8')).toContain('print')
    expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).not.toContain(py)

    // a different computer
    const home2 = nodePath.join(tmp, 'home2'); const cfg2 = nodePath.join(home2, '.config', 'obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    const inst2 = install(cfg2)
    const plan = planImport({ bundle: readBundleDir(dir), install: inst2, host: host('linux', home2) })
    applyImport(plan)
    const col = JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'basic/scenes/Main.json'), 'utf8'))
    const path = col.modules['scripts-tool'][0].path as string
    expect(path.startsWith(cfg2)).toBe(true)
    expect(fs.readFileSync(path, 'utf8')).toContain('print')
    expect(plan.report.warnings.join('\n')).toMatch(/runs a script \(switcher\.py\)/)
  })

  it('saves the remote-control settings with the password as a secret, and keeps the password already in OBS on load', async () => {
    const { cfg, dir, h, inst } = setup()
    addWebsocket(cfg)
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const raw = fs.readFileSync(nodePath.join(dir, 'global/obs-websocket.json'), 'utf8')
    expect(raw).not.toContain('SECRET789')
    expect(raw).toContain('4455')
    const v = readBundleDir(dir).manifest.variables.find((x) => x.target?.startsWith('global/obs-websocket.json#'))!
    expect(v.kind).toBe('secret')
    expect(v.label).toMatch(/controlling OBS/)

    // loading on a computer that already has a different password keeps that password and takes the port
    const home2 = nodePath.join(tmp, 'home2'); const cfg2 = nodePath.join(home2, '.config', 'obs-studio')
    addWebsocket(cfg2, 'other-PW'); fs.writeFileSync(nodePath.join(cfg2, 'plugin_config/obs-websocket/config.json'), JSON.stringify({ server_port: 1234, server_password: 'other-PW' }))
    const plan = planImport({ bundle: readBundleDir(dir), install: install(cfg2), host: host('linux', home2) })
    applyImport(plan)
    const out = JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'plugin_config/obs-websocket/config.json'), 'utf8'))
    expect(out).toMatchObject({ server_port: 4455, server_password: 'other-PW' })
    // typed beats what is there
    const typed = planImport({ bundle: readBundleDir(dir), install: install(cfg2), host: host('linux', home2), variables: { [v.name]: 'typed-PW' } })
    applyImport(typed)
    expect(JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'plugin_config/obs-websocket/config.json'), 'utf8')).server_password).toBe('typed-PW')
    // and it can be left out
    expect(planImport({ bundle: readBundleDir(dir), install: install(cfg2), host: host('linux', home2), websocket: false }).writes.some((w) => w.kind === 'websocket')).toBe(false)
  })

  it('never writes the password into a git folder, but a file can carry it when asked', () => {
    const { cfg, h, inst, dir } = setup()
    addWebsocket(cfg)
    const b = exportBundle({ host: h, install: inst, name: 'T', includeSecrets: true })
    expect(b.files.get('global/obs-websocket.json')!.toString()).toContain('{{var:')
    expect(b.manifest.variables.some((x) => x.value === 'ws-SECRET789')).toBe(true)
    expect(() => writeBundleDir(b, dir)).toThrow()
  })
})

describe('renaming inside a preset', () => {
  async function preset() {
    const s = setup()
    await initRepo(s.dir)
    await captureLive({ host: s.h, install: s.inst, dir: s.dir, name: 'Mine' })
    return s
  }

  it('renames the preset, a scene layout and output settings, keeping files and the active choice in step', async () => {
    const { dir } = await preset()
    expect(renamePreset(dir, 'Evening show')).toEqual(['manifest.json'])
    expect(readBundleDir(dir).manifest.name).toBe('Evening show')

    renameSceneLayout(dir, 'main', 'Main stream')
    let m = readBundleDir(dir).manifest
    expect(m.collections[0]).toMatchObject({ id: 'main-stream', name: 'Main stream', file: 'collections/main-stream.json' })
    expect(m.activeCollection).toBe('main-stream')
    expect(fs.existsSync(nodePath.join(dir, 'collections/main.json'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(nodePath.join(dir, 'collections/main-stream.json'), 'utf8')).name).toBe('Main stream')

    renameOutputSetting(dir, 'main', 'High quality')
    m = readBundleDir(dir).manifest
    expect(m.profiles[0]).toMatchObject({ id: 'high-quality', name: 'High quality', dir: 'profiles/high-quality' })
    expect(m.activeProfile).toBe('high-quality')
    expect(fs.readFileSync(nodePath.join(dir, 'profiles/high-quality/basic.ini'), 'utf8')).toContain('Name=High quality')
    expect(fs.existsSync(nodePath.join(dir, 'profiles/main'))).toBe(false)

    // loading it into a fresh OBS gives the new names
    const home2 = nodePath.join(tmp, 'h2'); const cfg2 = nodePath.join(home2, '.config', 'obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    applyImport(planImport({ bundle: readBundleDir(dir), install: install(cfg2), host: host('linux', home2), activate: true }))
    expect(fs.existsSync(nodePath.join(cfg2, 'basic/scenes/Main stream.json'))).toBe(true)
    expect(fs.existsSync(nodePath.join(cfg2, 'basic/profiles/High quality/basic.ini'))).toBe(true)
  })

  it('renaming a scene updates everything that points at it, and the per-OS file', async () => {
    const { dir } = await preset()
    const f = nodePath.join(dir, 'collections/main.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    j.scene_order = [{ name: 'Scene' }]; j.current_program_scene = 'Scene'
    j.sources.push({ id: 'scene', name: 'Other', uuid: 'u-o', settings: { items: [{ name: 'Scene', source_uuid: 'u-scene', visible: true }] } })
    fs.writeFileSync(f, JSON.stringify(j))
    fs.writeFileSync(nodePath.join(dir, 'collections/main.platforms.json'), JSON.stringify({ Window: { linux: { id: 'xcomposite_input', settings: {} } } }))

    expect(listNames(dir, 'main').scenes).toEqual(['Scene', 'Other'])
    const changed = renameSceneOrSource(dir, 'main', 'Scene', 'Gameplay')
    expect(changed).toEqual(['collections/main.json'])
    const out = JSON.parse(fs.readFileSync(f, 'utf8'))
    expect(out.sources.find((s: any) => s.uuid === 'u-scene').name).toBe('Gameplay')
    expect(out.sources.find((s: any) => s.name === 'Other').settings.items[0].name).toBe('Gameplay')
    expect(out.scene_order[0].name).toBe('Gameplay')
    expect(out.current_program_scene).toBe('Gameplay')

    renameSceneOrSource(dir, 'main', 'Window', 'Game window')
    const v = JSON.parse(fs.readFileSync(nodePath.join(dir, 'collections/main.platforms.json'), 'utf8'))
    expect(Object.keys(v)).toEqual(['Game window'])
  })

  it('refuses names that clash or are unusable, without changing anything', async () => {
    const { dir } = await preset()
    const before = fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')
    expect(() => renameSceneOrSource(dir, 'main', 'Scene', 'Overlay')).toThrow(RenameError)
    expect(() => renameSceneOrSource(dir, 'main', 'Nope', 'X')).toThrow(/not in this scene layout/)
    expect(() => renamePreset(dir, '   ')).toThrow(/Type a name/)
    expect(() => renameSceneLayout(dir, 'main', 'a/b')).toThrow(/cannot contain/)
    expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).toBe(before)
  })

  it('a later save from OBS under the new names does not recreate the old ones', async () => {
    const s = await preset()
    renameSceneLayout(s.dir, 'main', 'Show')
    // (the user loads the preset into OBS, which now has the new name; here OBS is simulated by renaming its files)
    const scenes = nodePath.join(s.cfg, 'basic/scenes')
    const j = JSON.parse(fs.readFileSync(nodePath.join(scenes, 'Main.json'), 'utf8')); j.name = 'Show'
    fs.writeFileSync(nodePath.join(scenes, 'Show.json'), JSON.stringify(j)); fs.rmSync(nodePath.join(scenes, 'Main.json'))
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['add', '-A'], { cwd: s.dir }); execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', 'commit', '-qm', 'rename'], { cwd: s.dir })
    const r = await captureLive({ host: s.h, install: s.inst, dir: s.dir })
    expect(['unchanged', 'committed']).toContain(r.status)
    expect(readBundleDir(s.dir).manifest.collections.map((c) => c.name)).toEqual(['Show'])
  })
})

describe('where plugins are found', () => {
  const entry = {
    display_name: '', enabled: true, encoders: [], id: '', module_name: 'linux-pipewire-audio', outputs: [], services: [],
    sources: ['pipewire_audio_input_capture', 'pipewire_audio_output_capture', 'pipewire_audio_application_capture'], version: '',
  }
  const withPipewireAudio = (cfg: string) => {
    const f = nodePath.join(cfg, 'basic/scenes/Main.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    j.sources.push({ id: 'pipewire_audio_output_capture', name: 'Desktop audio', uuid: 'u-pa', settings: {} })
    fs.writeFileSync(f, JSON.stringify(j))
  }

  it('knows the PipeWire audio plugin from OBS\'s own plugin list, wherever its files are, and says when OBS gives no version', async () => {
    const { home, cfg, dir, h, inst } = setup()
    withPipewireAudio(cfg)
    fs.mkdirSync(nodePath.join(cfg, 'plugin_manager'), { recursive: true })
    fs.writeFileSync(nodePath.join(cfg, 'plugin_manager/modules.json'), JSON.stringify([entry]))
    const { installedModules, detectVersions, checkPlugins } = await import('../src/index.js')
    expect(installedModules(h, inst).has('linux-pipewire-audio')).toBe(true)
    expect(detectVersions(inst, h).plugins).toEqual({}) // version is "": nothing invented

    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const pw = readBundleDir(dir).manifest.plugins.find((p) => p.id === 'obs-pipewire-audio-capture')!
    expect(pw.provides.some((x) => x.kind === 'module' && x.id === 'linux-pipewire-audio')).toBe(true)
    expect(checkPlugins([pw], installedModules(h, inst))[0].status).toBe('present')
    void home
  })

  it('finds it in the newer user folder (OBS 33+) and in a Flatpak extension, and not when it is simply absent', async () => {
    const { installedModules } = await import('../src/index.js')
    const { home, cfg, h, inst } = setup()
    expect(installedModules(h, inst).has('linux-pipewire-audio')).toBe(false)
    // OBS 33+ native: ~/.local/share/obs-studio/plugins/<name>/<name>.so
    const data = nodePath.join(home, '.local/share/obs-studio/plugins/linux-pipewire-audio')
    fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(nodePath.join(data, 'linux-pipewire-audio.so'), '')
    const { detectInstalls } = await import('../src/index.js')
    const fake = { ...h, exists: (p: string) => p === '/usr/bin/obs' || fs.existsSync(p) }
    const native = detectInstalls(fake).find((i) => i.kind === 'linux-native')!
    expect(native.pluginDirs).toContain(nodePath.join(home, '.local/share/obs-studio/plugins'))
    expect(installedModules(h, native).has('linux-pipewire-audio')).toBe(true)
    void cfg; void inst
  })

  it('finds a Flatpak extension under runtime/', async () => {
    const { installedModules, detectInstalls } = await import('../src/index.js')
    const home = nodePath.join(tmp, 'fh')
    const ext = nodePath.join(home, '.local/share/flatpak/runtime/com.obsproject.Studio.Plugin.PipeWireAudioCapture/x86_64/stable/abc123/files/lib/obs-plugins')
    fs.mkdirSync(ext, { recursive: true }); fs.writeFileSync(nodePath.join(ext, 'linux-pipewire-audio.so'), '')
    fs.mkdirSync(nodePath.join(home, '.local/share/flatpak/app/com.obsproject.Studio'), { recursive: true })
    const h = host('linux', home)
    const fp = detectInstalls(h).find((i) => i.kind === 'flatpak')!
    expect(installedModules(h, fp).has('linux-pipewire-audio')).toBe(true)
  })

  it('warns when a plugin is switched off in OBS, and for a plugin that does report a version', async () => {
    const { detectVersions } = await import('../src/index.js')
    const { cfg, h, inst } = setup()
    fs.mkdirSync(nodePath.join(cfg, 'plugin_manager'), { recursive: true })
    fs.writeFileSync(nodePath.join(cfg, 'plugin_manager/modules.json'), JSON.stringify([{ ...entry, enabled: false }, { module_name: 'obs-multi-rtmp', version: '0.6.4', enabled: true }]))
    const v = detectVersions(inst, h)
    expect(v.plugins).toEqual({ obsmultirtmp: '0.6.4' })
    expect(v.disabled).toEqual(['linuxpipewireaudio'])
    const { versionNotes } = await import('../src/index.js')
    const m = { plugins: [{ id: 'obs-pipewire-audio-capture', name: 'PipeWire Audio Capture', provides: [{ kind: 'module', id: 'linux-pipewire-audio' }] }] } as unknown as Manifest
    expect(versionNotes(m, v).join()).toMatch(/PipeWire Audio Capture is installed but switched off/)
  })
})

describe('remembered stream keys', () => {
  it('can be attached to a file made from a saved preset, and are ignored when not asked for', async () => {
    const { attachSecrets } = await import('../src/index.js')
    const { cfg, dir, h, inst } = setup()
    addWebsocket(cfg)
    // what the app remembers on the computer: every secret OBS has, by variable name
    const live = exportBundle({ host: h, install: inst, name: 'k', includeSecrets: true })
    const remembered = Object.fromEntries(live.manifest.variables.filter((v) => v.kind === 'secret' && v.value).map((v) => [v.name, v.value!]))
    expect(Object.values(remembered)).toEqual(expect.arrayContaining(['live_SECRET123', 'yt-SECRET456', 'ws-SECRET789']))

    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const folder = readBundleDir(dir)
    expect(JSON.stringify([...folder.files.keys()])).not.toContain('READ-ME')
    const plain = readBundleDir(dir)
    expect(plain.manifest.containsSecrets).toBeUndefined()
    const n = attachSecrets(folder, { ...remembered, NOT_IN_THIS_SETUP: 'x' })
    expect(n).toBe(3)
    expect(folder.manifest.containsSecrets).toBe(true)
    expect(folder.files.has('READ-ME-FIRST-CONTAINS-STREAM-KEYS.txt')).toBe(true)
    expect(folder.manifest.variables.some((v) => v.value === 'x')).toBe(false)
    // and loading that file somewhere else puts the key in
    const home2 = nodePath.join(tmp, 'h2'); const cfg2 = nodePath.join(home2, '.config', 'obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    applyImport(planImport({ bundle: folder, install: install(cfg2), host: host('linux', home2) }))
    expect(fs.readFileSync(nodePath.join(cfg2, 'basic/profiles/Main/service.json'), 'utf8')).toContain('live_SECRET123')
    expect(attachSecrets(plain, {})).toBe(0)
  })
})

describe('renaming in OBS itself', () => {
  it('renames a scene layout, output settings and a scene in an OBS settings folder, and the active choice follows', async () => {
    const { renameLayoutInObs, renameOutputInObs, renameSourceInObs, obsHasLayout, obsHasOutput } = await import('../src/index.js')
    const { cfg } = setup()
    renameLayoutInObs(cfg, 'Main', 'Show')
    renameOutputInObs(cfg, 'Main', 'High quality')
    expect(obsHasLayout(cfg, 'Show')).toBe(true); expect(obsHasLayout(cfg, 'Main')).toBe(false)
    expect(obsHasOutput(cfg, 'High quality')).toBe(true)
    const g = fs.readFileSync(nodePath.join(cfg, 'global.ini'), 'utf8')
    expect(g).toContain('SceneCollection=Show'); expect(g).toContain('SceneCollectionFile=Show'); expect(g).toContain('ProfileDir=High quality')
    expect(JSON.parse(fs.readFileSync(nodePath.join(cfg, 'basic/scenes/Show.json'), 'utf8')).name).toBe('Show')
    expect(fs.readFileSync(nodePath.join(cfg, 'basic/profiles/High quality/basic.ini'), 'utf8')).toContain('Name=High quality')
    expect(renameSourceInObs(cfg, 'Show', 'Scene', 'Gameplay')).toBe(true)
    expect(renameSourceInObs(cfg, 'Show', 'Nope', 'X')).toBe(false)
    const j = JSON.parse(fs.readFileSync(nodePath.join(cfg, 'basic/scenes/Show.json'), 'utf8'))
    expect(j.current_scene).toBe('Gameplay')
    expect(() => renameLayoutInObs(cfg, 'Show', 'Show')).not.toThrow()
    expect(() => renameLayoutInObs(cfg, 'Missing', 'X')).toThrow(/no scene layout/)
  })
})
