import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { exportBundle, planImport, parseManifest, captureLive, initRepo, readBundleDir, listPlatformSources, type Bundle } from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-tr-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function windowsSetup(extra: Record<string, unknown> = {}): Bundle {
  const sources = [
    { id: 'scene', name: 'Game scene', uuid: 'u-scene', settings: { id_counter: 1, items: [{ name: 'Game window', source_uuid: 'u-w', visible: true, id: 1 }] } },
    { id: 'window_capture', name: 'Game window', uuid: 'u-w', settings: { window: 'Fortnite:UnrealWindow:FortniteClient.exe', capture_audio: true } },
    { id: 'wasapi_process_output_capture', name: 'Music app', uuid: 'u-m', settings: { window: 'Spotify:Chrome_WidgetWin_1:Spotify.exe' } },
    { id: 'wasapi_input_capture', name: 'Mic', uuid: 'u-mic', settings: { device_id: 'default' } },
    { id: 'wasapi_output_capture', name: 'Desktop', uuid: 'u-d', settings: {} },
  ]
  return {
    manifest: parseManifest({ format: 'obs-config-bundle', version: 1, id: 'i', name: 'n', source: { platform: 'win32' }, collections: [{ id: 'c', name: 'C', file: 'collections/c.json' }], ...extra }),
    files: new Map([['collections/c.json', Buffer.from(JSON.stringify({ name: 'C', sources }))]]),
  }
}
const toLinux = (b: Bundle, opts: Record<string, unknown> = {}, cfgName = 'cfg') => {
  const home = nodePath.join(tmp, 'h')
  const plan = planImport({ bundle: b, install: install(nodePath.join(home, cfgName)), host: host('linux', home), ...opts })
  const col = JSON.parse(plan.writes.find((w) => w.kind === 'collection')!.data.toString())
  return { plan, col, byName: (n: string) => col.sources.find((s: any) => s.name === n) }
}

describe('Windows to Linux, with the PipeWire plugins', () => {
  it('window capture becomes PipeWire screen capture; its "capture audio" becomes a real application audio source in the same scene', () => {
    const { col, byName, plan } = toLinux(windowsSetup(), { installed: { obs: '33.0.0' } })
    expect(byName('Game window')).toMatchObject({ id: 'pipewire-screen-capture-source', settings: {} })
    const audio = byName('Game window (audio)')
    expect(audio).toMatchObject({ id: 'pipewire_audio_application_capture', versioned_id: 'pipewire_audio_application_capture' })
    expect(audio.uuid).toMatch(/^[0-9a-f-]{36}$/)
    const items = col.sources.find((s: any) => s.id === 'scene').settings.items
    expect(items.map((i: any) => i.name)).toEqual(['Game window', 'Game window (audio)'])
    expect(items[1]).toMatchObject({ source_uuid: audio.uuid, visible: true, id: 2 })
    const added = plan.report.substitutions.find((s) => s.result === 'added')!
    expect(added.note).toContain('FortniteClient.exe')
    // and the other audio sources
    expect(byName('Music app')).toMatchObject({ id: 'pipewire_audio_application_capture' })
    expect(plan.report.substitutions.find((s) => s.source === 'Music app')!.note).toContain('Spotify.exe')
    // not installed on this OBS: the plugin is named, with how to get it; mic and desktop audio fall back to PulseAudio
    expect(plan.report.warnings.join(' ')).toMatch(/PipeWire Audio Capture plugin/)
    expect(byName('Mic').id).toBe('pulse_input_capture')
    expect(byName('Desktop').id).toBe('pulse_output_capture')
  })

  it('uses the PipeWire audio plugin for microphones and desktop audio when it is installed, and stays quiet', () => {
    const home = nodePath.join(tmp, 'h'); const cfg = nodePath.join(home, 'cfg')
    fs.mkdirSync(nodePath.join(cfg, 'plugin_manager'), { recursive: true })
    fs.writeFileSync(nodePath.join(cfg, 'plugin_manager/modules.json'), JSON.stringify([{ module_name: 'linux-pipewire-audio', version: '', enabled: true }]))
    const { byName, plan } = toLinux(windowsSetup(), {})
    expect(byName('Mic').id).toBe('pipewire_audio_input_capture')
    expect(byName('Desktop').id).toBe('pipewire_audio_output_capture')
    expect(plan.report.warnings.join(' ')).not.toMatch(/PipeWire Audio Capture plugin/)
  })

  it('older OBS (before 30.2) gets the two older PipeWire capture sources instead', () => {
    const { byName } = toLinux(windowsSetup(), { installed: { obs: '30.1.2' } })
    expect(byName('Game window').id).toBe('pipewire-window-capture-source')
  })

  it('with PipeWire preferred off, X11 capture is used and the audio stays separate', () => {
    const { byName } = toLinux(windowsSetup(), { preferPipewire: false })
    expect(byName('Game window').id).toBe('xcomposite_input')
    expect(byName('Mic').id).toBe('pulse_input_capture')
  })

  it('no "capture audio" means no extra source', () => {
    const b = windowsSetup()
    const j = JSON.parse(b.files.get('collections/c.json')!.toString()); j.sources[1].settings.capture_audio = false
    b.files.set('collections/c.json', Buffer.from(JSON.stringify(j)))
    const { col } = toLinux(b)
    expect(col.sources.some((s: any) => s.name === 'Game window (audio)')).toBe(false)
  })
})

describe('Linux to Windows and macOS', () => {
  it('PipeWire audio and screen capture have Windows and macOS equivalents', () => {
    const b: Bundle = {
      manifest: parseManifest({ format: 'obs-config-bundle', version: 1, id: 'i', name: 'n', collections: [{ id: 'c', name: 'C', file: 'collections/c.json' }] }),
      files: new Map([['collections/c.json', Buffer.from(JSON.stringify({ name: 'C', sources: [
        { id: 'pipewire-screen-capture-source', name: 'Screen', settings: { ShowCursor: true } },
        { id: 'pipewire_audio_application_capture', name: 'App audio', settings: {} },
        { id: 'pipewire_audio_input_capture', name: 'Mic', settings: {} },
        { id: 'pipewire_audio_output_capture', name: 'Desktop', settings: {} },
      ] }))]]),
    }
    const w = planImport({ bundle: b, install: { ...install('C:\\cfg'), platform: 'win32' }, host: host('win32', 'C:\\Users\\u') })
    const wc = JSON.parse(w.writes.find((x) => x.kind === 'collection')!.data.toString()).sources
    expect(wc.map((s: any) => s.id)).toEqual(['monitor_capture', 'wasapi_process_output_capture', 'wasapi_input_capture', 'wasapi_output_capture'])
    const m = planImport({ bundle: b, install: install(nodePath.join(tmp, 'm')), host: host('darwin', tmp) })
    const mc = JSON.parse(m.writes.find((x) => x.kind === 'collection')!.data.toString()).sources
    expect(mc.map((s: any) => s.id)).toEqual(['display_capture', 'sck_audio_capture', 'coreaudio_input_capture', 'coreaudio_output_capture'])
  })
})

describe('editing how sources are translated', () => {
  it('a person\'s own choice wins, including hiding a source', () => {
    const b = windowsSetup({ platformOverrides: {
      window_capture: { 'linux-pipewire': 'pipewire-window-capture-source' },
      wasapi_input_capture: { linux: null, 'linux-pipewire': null },
      wasapi_process_output_capture: { 'linux-pipewire': 'pulse_output_capture' },
    } })
    const { byName, col } = toLinux(b, { installed: { obs: '33.0.0' } })
    expect(byName('Game window').id).toBe('pipewire-window-capture-source')
    expect(byName('Music app').id).toBe('pulse_output_capture')
    expect(byName('Mic').id).toBe('wasapi_input_capture') // kept as it is, but hidden
    expect(col.sources.find((s: any) => s.id === 'scene').settings.items.some((i: any) => i.name === 'Mic')).toBe(false) // never in a scene here
  })

  it('hiding a source sets its scene items to hidden', () => {
    const b = windowsSetup({ platformOverrides: { window_capture: { 'linux-pipewire': null, linux: null } } })
    const { col, plan } = toLinux(b)
    const item = col.sources.find((s: any) => s.id === 'scene').settings.items.find((i: any) => i.name === 'Game window')
    expect(item.visible).toBe(false)
    expect(plan.report.substitutions.find((s) => s.source === 'Game window')).toMatchObject({ result: 'disabled', note: expect.stringContaining('preset settings') })
  })

  it('overrides survive saving from OBS, and are not rewritten by it', async () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    await captureLive({ host: host('linux', home), install: install(cfg), dir, name: 'Mine' })
    const mf = nodePath.join(dir, 'manifest.json')
    const m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.platformOverrides = { window_capture: { linux: null } }; m.exclude = { remoteControl: true }
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n')
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', 'commit', '-qam', 'prefs'], { cwd: dir })
    const j = JSON.parse(fs.readFileSync(nodePath.join(cfg, 'basic/scenes/Main.json'), 'utf8')); j.sources.push({ id: 'color_source', name: 'New', uuid: 'u-new', settings: {} })
    fs.writeFileSync(nodePath.join(cfg, 'basic/scenes/Main.json'), JSON.stringify(j))
    expect((await captureLive({ host: host('linux', home), install: install(cfg), dir })).status).toBe('committed')
    expect(readBundleDir(dir).manifest.platformOverrides).toEqual({ window_capture: { linux: null } })
  })
})

describe('choosing for one source, not for every source of its kind', () => {
  const twoCaptures = (extra: Record<string, unknown> = {}) => {
    const b = windowsSetup(extra)
    const j = JSON.parse(b.files.get('collections/c.json')!.toString())
    j.sources.push({ id: 'window_capture', name: 'Browser window', uuid: 'u-b', settings: { window: 'Chrome:Chrome_WidgetWin_1:chrome.exe' } })
    b.files.set('collections/c.json', Buffer.from(JSON.stringify(j)))
    return b
  }
  it('a saved choice for one source leaves the other of the same kind alone, and beats the choice for the kind', () => {
    const { byName, plan } = toLinux(twoCaptures({ sourceOverrides: { 'u:u-b': { linux: null, 'linux-pipewire': null } } }))
    expect(byName('Game window').id).toBe('pipewire-screen-capture-source') // the built-in choice
    expect(byName('Browser window').id).toBe('window_capture') // hidden, kept as it is
    expect(plan.report.substitutions.find((x) => x.source === 'Browser window')).toMatchObject({ result: 'disabled', sourceKey: 'u:u-b', key: 'window_capture' })
    // the kind-wide choice is still used by sources without their own
    const both = toLinux(twoCaptures({ platformOverrides: { window_capture: { linux: 'xcomposite_input', 'linux-pipewire': 'xcomposite_input' } }, sourceOverrides: { 'u:u-b': { 'linux-pipewire': 'pipewire-window-capture-source' } } }))
    expect(both.byName('Game window').id).toBe('xcomposite_input')
    expect(both.byName('Browser window').id).toBe('pipewire-window-capture-source')
  })
  it('on the import screen a choice for one source changes only that source', () => {
    const plain = toLinux(twoCaptures(), { sourceChoices: { 'u:u-b': null } })
    expect(plain.byName('Game window').id).toBe('pipewire-screen-capture-source')
    expect(plain.byName('Browser window').id).toBe('window_capture')
    // a choice keyed by the kind still works for everything of that kind (older callers)
    expect(toLinux(twoCaptures(), { sourceChoices: { window_capture: 'xcomposite_input' } }).byName('Browser window').id).toBe('xcomposite_input')
  })
  it('lists the sources a person can choose for, per layout', async () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    const b = twoCaptures(); const j = JSON.parse(b.files.get('collections/c.json')!.toString())
    fs.mkdirSync(nodePath.join(dir, 'collections'), { recursive: true })
    fs.writeFileSync(nodePath.join(dir, 'collections/c.json'), JSON.stringify(j))
    fs.writeFileSync(nodePath.join(dir, 'manifest.json'), JSON.stringify({ ...b.manifest }))
    expect(listPlatformSources(dir, 'c').map((x) => [x.name, x.kind, x.key])).toEqual([
      ['Game window', 'window_capture', 'u:u-w'], ['Music app', 'wasapi_process_output_capture', 'u:u-m'], ['Mic', 'wasapi_input_capture', 'u:u-mic'], ['Desktop', 'wasapi_output_capture', 'u:u-d'], ['Browser window', 'window_capture', 'u:u-b'],
    ])
    void cfg
  })
})

describe('what a save includes', () => {
  it('leaves out what a preset says to leave out, and keeps the rest of OBS', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.writeFileSync(nodePath.join(cfg, 'basic/scenes/Other.json'), JSON.stringify({ name: 'Other', sources: [] }))
    fs.mkdirSync(nodePath.join(cfg, 'basic/profiles/Alt'), { recursive: true }); fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Alt/basic.ini'), '[General]\nName=Alt\n')
    fs.mkdirSync(nodePath.join(cfg, 'plugin_config/obs-websocket'), { recursive: true }); fs.writeFileSync(nodePath.join(cfg, 'plugin_config/obs-websocket/config.json'), '{"server_port":1}')
    const all = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    expect(all.manifest.collections.map((c) => c.name).sort()).toEqual(['Main', 'Other'])
    const some = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x', exclude: { collections: ['Other'], profiles: ['Alt'], remoteControl: true } })
    expect(some.manifest.collections.map((c) => c.name)).toEqual(['Main'])
    expect(some.manifest.profiles.map((p) => p.name)).toEqual(['Main'])
    expect(some.files.has('global/obs-websocket.json')).toBe(false)
    expect(all.files.has('global/obs-websocket.json')).toBe(true)
  })

  it('can leave scripts out', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const py = nodePath.join(home, 's.py'); fs.writeFileSync(py, 'x')
    const f = nodePath.join(cfg, 'basic/scenes/Main.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.modules = { 'scripts-tool': [{ path: py }], 'auto-scene-switcher': { interval: 5 } }; fs.writeFileSync(f, JSON.stringify(j))
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x', exclude: { scripts: true } })
    expect(b.manifest.assets.some((a) => a.role === 'script')).toBe(false)
    expect(JSON.parse(b.files.get('collections/main.json')!.toString()).modules).toEqual({ 'auto-scene-switcher': { interval: 5 } })
  })
})

describe('big files in a file', () => {
  it('are listed with their size without being read into the file, and go in only when chosen', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg, big } = makeSource(home)
    const scan = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x', bundleBelowBytes: 0 })
    const a = scan.manifest.assets.find((x) => x.filename === 'mix.mp3')!
    expect(a).toMatchObject({ mode: 'external', size: 6 * 1024 * 1024 })
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect([...scan.files.keys()].some((k) => k.startsWith('media/'))).toBe(false)
    const withIt = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x', alsoBundle: [a.id] })
    expect(withIt.manifest.assets.find((x) => x.id === a.id)!.mode).toBe('bundled')
    expect(withIt.files.get(`media/${a.id}/mix.mp3`)!.length).toBe(fs.statSync(big).size)
    // the same hash whether it was streamed or not
    expect(withIt.manifest.assets.find((x) => x.id === a.id)!.sha256).toBe(a.sha256)
  })
})

describe('changing what a preset leaves out', () => {
  it('takes effect at the next save, both ways, even though OBS was last matched before the change', async () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.writeFileSync(nodePath.join(cfg, 'basic/scenes/Other.json'), JSON.stringify({ name: 'Other', sources: [] }))
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    const h = host('linux', home), inst = install(cfg)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(fs.existsSync(nodePath.join(dir, 'collections/other.json'))).toBe(true)
    const { execFileSync } = await import('node:child_process')
    const setExclude = (ex: unknown) => {
      const m = JSON.parse(fs.readFileSync(nodePath.join(dir, 'manifest.json'), 'utf8')); if (ex) m.exclude = ex; else delete m.exclude
      fs.writeFileSync(nodePath.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n')
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', 'commit', '-qam', 'settings'], { cwd: dir })
    }
    setExclude({ collections: ['Other'] })
    expect((await captureLive({ host: h, install: inst, dir, dryRun: true })).status).toBe('changes') // the person is told a save would change things
    expect((await captureLive({ host: h, install: inst, dir })).status).toBe('committed')
    expect(fs.existsSync(nodePath.join(dir, 'collections/other.json'))).toBe(false)
    expect(readBundleDir(dir).manifest.collections.map((c) => c.name)).toEqual(['Main'])
    expect((await captureLive({ host: h, install: inst, dir })).status).toBe('unchanged')
    setExclude(undefined)
    expect((await captureLive({ host: h, install: inst, dir })).status).toBe('committed')
    expect(fs.existsSync(nodePath.join(dir, 'collections/other.json'))).toBe(true)
    expect(readBundleDir(dir).manifest.exclude).toBeUndefined()
  })
})

describe('what a person sees when loading', () => {
  it('a Linux-only plugin is "not needed" on Windows, and nothing blocks the load', () => {
    const b: Bundle = {
      manifest: parseManifest({
        format: 'obs-config-bundle', version: 1, id: 'i', name: 'n', source: { platform: 'linux' },
        collections: [{ id: 'c', name: 'C', file: 'collections/c.json' }],
        plugins: [{ id: 'obs-pipewire-audio-capture', name: 'PipeWire Audio Capture', provides: [{ kind: 'module', id: 'linux-pipewire-audio' }] }],
      }),
      files: new Map([['collections/c.json', Buffer.from(JSON.stringify({ name: 'C', sources: [{ id: 'pipewire_audio_output_capture', name: 'Desktop', settings: {} }] }))]]),
    }
    const plan = planImport({ bundle: b, install: { ...install('C:\\cfg'), platform: 'win32' }, host: host('win32', 'C:\\Users\\u') })
    expect(plan.report.plugins).toEqual([expect.objectContaining({ status: 'not-needed' })])
    expect(plan.report.blockers).toEqual([])
    expect(plan.writes.length).toBeGreaterThan(0)
    const col = JSON.parse(plan.writes.find((w) => w.kind === 'collection')!.data.toString())
    expect(col.sources[0].id).toBe('wasapi_output_capture')
    // on Linux it is still checked
    const lin = planImport({ bundle: b, install: install(nodePath.join(tmp, 'c')), host: host('linux', tmp) })
    expect(lin.report.plugins[0].status).not.toBe('not-needed')
  })

  it('Aitum Stream Suite is recognised from its own files and source, and its stream keys are kept out', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Main/aitum.json'), JSON.stringify({ outputs: [{ name: 'Vertical Stream', type: 'stream', server: 'rtmp://a', key: 'AITUM-SECRET-1' }], canvas: { name: 'Vertical' } }))
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const p = b.manifest.plugins.find((x) => x.id === 'aitum-stream-suite')!
    expect(p.name).toBe('Aitum Stream Suite')
    expect([...b.files.values()].map((x) => x.toString()).join('\n')).not.toContain('AITUM-SECRET-1')
    expect(b.manifest.variables.find((v) => v.target?.includes('aitum.json'))!.label).toBe('Aitum Stream Suite: “Vertical Stream”')
    // not installed here: said plainly, with how to get it
    const plan = planImport({ bundle: b, install: install(nodePath.join(tmp, 'o')), host: host('linux', tmp) })
    expect(plan.report.plugins.find((f) => f.plugin.id === 'aitum-stream-suite')!.status).toBe('missing')
    // a setup that uses only its source (no profile file) is recognised too
    fs.rmSync(nodePath.join(cfg, 'basic/profiles/Main/aitum.json'))
    const sc = nodePath.join(cfg, 'basic/scenes/Main.json'); const j = JSON.parse(fs.readFileSync(sc, 'utf8')); j.sources.push({ id: 'component_source', name: 'Comp', uuid: 'u-c', settings: {} }); fs.writeFileSync(sc, JSON.stringify(j))
    expect(exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' }).manifest.plugins.map((x) => x.id)).toContain('aitum-stream-suite')
  })

  it('the person can choose, for this load, what a source becomes or that it is hidden', () => {
    const b = windowsSetup()
    const { byName, plan } = toLinux(b, { installed: { obs: '33.0.0' }, sourceChoices: { window_capture: 'xcomposite_input', wasapi_input_capture: null } })
    expect(byName('Game window').id).toBe('xcomposite_input')
    expect(byName('Mic').id).toBe('wasapi_input_capture')
    const row = plan.report.substitutions.find((s) => s.source === 'Mic')!
    expect(row).toMatchObject({ result: 'disabled', fromName: 'Audio Input Capture (Windows)' })
    expect(row.options!.map((o) => o.id)).toContain('pulse_input_capture')
    const win = plan.report.substitutions.find((s) => s.source === 'Game window')!
    expect(win.options!.map((o) => o.name)).toContain('Screen Capture (PipeWire)')
    expect(win.toName).toBe('Window Capture (X11)')
  })
})
