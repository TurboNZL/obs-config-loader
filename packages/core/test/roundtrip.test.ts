import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import {
  exportBundle, planImport, applyImport, writeBundleZip, readBundleZip, writeBundleDir, readBundleDir,
  parseManifest, BundleError, type Host, type ObsInstall, type Platform,
} from '../src/index.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function host(platform: Platform, home: string): Host {
  return {
    platform, home, env: {},
    exists: (p) => fs.existsSync(p),
    isDir: (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } },
    listDir: (p) => { try { return fs.readdirSync(p) } catch { return [] } },
  }
}

function install(configDir: string): ObsInstall {
  return { id: 'x', kind: 'linux-native', label: 't', platform: 'linux', configDir, pluginDirs: [nodePath.join(configDir, 'plugins')], configExists: true }
}

/** A small but realistic OBS config dir. */
function makeSource(home: string) {
  const cfg = nodePath.join(home, '.config', 'obs-studio')
  const media = nodePath.join(home, 'Pictures', 'overlay.png')
  const big = nodePath.join(home, 'Music', 'mix.mp3')
  fs.mkdirSync(nodePath.dirname(media), { recursive: true })
  fs.mkdirSync(nodePath.dirname(big), { recursive: true })
  fs.writeFileSync(media, Buffer.from('PNGDATA'))
  fs.writeFileSync(big, Buffer.alloc(6 * 1024 * 1024, 1))
  const scenes = nodePath.join(cfg, 'basic', 'scenes')
  const prof = nodePath.join(cfg, 'basic', 'profiles', 'Main')
  fs.mkdirSync(scenes, { recursive: true })
  fs.mkdirSync(prof, { recursive: true })
  fs.writeFileSync(nodePath.join(scenes, 'Main.json'), JSON.stringify({
    name: 'Main',
    current_scene: 'Scene',
    sources: [
      { id: 'scene', name: 'Scene', uuid: 'u-scene', settings: { items: [
        { name: 'Window', source_uuid: 'u-win', visible: true },
        { name: 'Overlay', source_uuid: 'u-img', visible: true },
        { name: 'Chat', visible: true },
      ] } },
      { id: 'xcomposite_input', name: 'Window', uuid: 'u-win', settings: { capture_window: '0x123' } },
      { id: 'image_source', name: 'Overlay', uuid: 'u-img', settings: { file: media } },
      { id: 'ffmpeg_source', name: 'Music', uuid: 'u-mus', settings: { local_file: big } },
      { id: 'browser_source', name: 'Chat', uuid: 'u-chat', settings: { url: 'https://example.com/chat?x={{y}}', css: 'a{}' } },
      { id: 'text_ft2_source_v2', name: 'T', uuid: 'u-t', settings: { text: '/me waves' } },
      { id: 'pipewire_audio_application_capture', name: 'Game audio', uuid: 'u-pw', settings: {} },
    ],
  }, null, 4))
  fs.writeFileSync(nodePath.join(prof, 'basic.ini'), `[General]\nName=Main\n\n[SimpleOutput]\nFilePath=${nodePath.join(home, 'Videos')}\nStreamEncoder=x264\n`)
  fs.writeFileSync(nodePath.join(prof, 'service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', server: 'auto', key: 'live_SECRET123' } }))
  fs.writeFileSync(nodePath.join(prof, 'obs-multi-rtmp.json'), JSON.stringify({ targets: [{ name: 'YT', 'service-param': { server: 'rtmp://a', key: 'yt-SECRET456' } }] }))
  fs.writeFileSync(nodePath.join(cfg, 'global.ini'), '[General]\nFirstRun=true\n\n[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')
  return { cfg, media, big }
}

describe('export', () => {
  it('never writes secrets, tokenises paths, bundles small media only', () => {
    const home = nodePath.join(tmp, 'home')
    const { cfg } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'Test', now: new Date('2026-01-01T00:00:00Z') })
    const all = [...b.files.values()].map((x) => x.toString('utf8')).join('\n')
    expect(all).not.toContain('SECRET123')
    expect(all).not.toContain('SECRET456')
    expect(JSON.stringify(b.manifest)).not.toContain('SECRET')
    expect(all).not.toContain(home)
    const secrets = b.manifest.variables.filter((v) => v.kind === 'secret')
    expect(secrets.map((s) => s.name)).toContain('STREAM_KEY')
    expect(secrets).toHaveLength(2)
    const small = b.manifest.assets.find((a) => a.filename === 'overlay.png')!
    const bigA = b.manifest.assets.find((a) => a.filename === 'mix.mp3')!
    expect(small.mode).toBe('bundled')
    expect(b.files.has(`media/${small.id}/overlay.png`)).toBe(true)
    expect(bigA.mode).toBe('external')
    expect(bigA.sha256).toMatch(/^[0-9a-f]{64}$/)
    const rec = b.manifest.variables.find((v) => v.kind === 'path')!
    expect(rec.default).toBe('{{videos}}')
  })

  it('reports plugins: known with status, unknown ids, and the multi-rtmp hint', () => {
    const home = nodePath.join(tmp, 'home')
    const { cfg } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'T' })
    const ids = b.manifest.plugins.map((p) => p.id)
    expect(ids).toContain('obs-pipewire-audio-capture')
    expect(ids).toContain('obs-multi-rtmp')
    // browser_source, image_source, text_ft2_source_v2 are built in: no "unknown" noise
    expect(ids.filter((i) => i.startsWith('unknown:'))).toEqual([])
    expect(b.manifest.platformMap.map((e) => e.from)).toContain('xcomposite_input')
  })

  it('escapes literal {{ so a round trip keeps it', () => {
    const home = nodePath.join(tmp, 'home')
    const { cfg } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'T' })
    const col = b.files.get('collections/main.json')!.toString('utf8')
    expect(col).toContain('{{lbrace}}y}}')
  })
})

describe('import', () => {
  async function exported() {
    const home = nodePath.join(tmp, 'home')
    const { cfg, big } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'Test' })
    // through a real zip, as a user would share it
    const zip = await writeBundleZip(b)
    return { bundle: await readBundleZip(zip), big }
  }

  it('round-trips on Linux into a fresh OBS dir', async () => {
    const { bundle, big } = await exported()
    const home2 = nodePath.join(tmp, 'home2')
    const cfg2 = nodePath.join(home2, '.config', 'obs-studio')
    const plan = planImport({
      bundle, install: install(cfg2), host: host('linux', home2),
      variables: { STREAM_KEY: 'live_NEW', ...Object.fromEntries(bundle.manifest.variables.filter((v) => v.kind === 'secret' && v.name !== 'STREAM_KEY').map((v) => [v.name, 'other'])) },
      assetFiles: { 'mix': big }, activate: true,
    })
    expect(plan.report.blockers).toEqual([])
    expect(plan.report.missingVariables).toEqual([])
    expect(plan.report.missingAssets.map((a) => a.id)).toEqual(['mix'].filter(() => false))
    applyImport(plan)
    const col = JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'basic/scenes/Main.json'), 'utf8'))
    const img = col.sources.find((s: any) => s.name === 'Overlay')
    expect(fs.readFileSync(img.settings.file, 'utf8')).toBe('PNGDATA')
    expect(col.sources.find((s: any) => s.name === 'Music').settings.local_file).toBe(big)
    expect(col.sources.find((s: any) => s.name === 'Chat').settings.url).toBe('https://example.com/chat?x={{y}}')
    expect(col.sources.find((s: any) => s.name === 'T').settings.text).toBe('/me waves')
    expect(col.sources.find((s: any) => s.name === 'Window').id).toBe('xcomposite_input') // same platform: untouched
    const svc = JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'basic/profiles/Main/service.json'), 'utf8'))
    expect(svc.settings.key).toBe('live_NEW')
    const ini = fs.readFileSync(nodePath.join(cfg2, 'basic/profiles/Main/basic.ini'), 'utf8')
    expect(ini).toContain(`FilePath=${nodePath.join(home2, 'Videos')}`)
    expect(ini).toContain('StreamEncoder=x264') // untouched lines survive
    const g = fs.readFileSync(nodePath.join(cfg2, 'global.ini'), 'utf8')
    expect(g).toContain('SceneCollectionFile=Main')
    expect(g).toContain('ProfileDir=Main')
  })

  it('importing twice changes nothing the second time', async () => {
    const { bundle, big } = await exported()
    const home2 = nodePath.join(tmp, 'home2')
    const cfg2 = nodePath.join(home2, '.config', 'obs-studio')
    const opts = { bundle, install: install(cfg2), host: host('linux', home2), assetFiles: { mix: big }, variables: { STREAM_KEY: 'k' } }
    applyImport(planImport(opts))
    const snap = () => Object.fromEntries(['basic/scenes/Main.json', 'basic/profiles/Main/service.json', 'basic/profiles/Main/basic.ini'].map((f) => [f, fs.readFileSync(nodePath.join(cfg2, f), 'utf8')]))
    const first = snap()
    applyImport(planImport(opts))
    expect(snap()).toEqual(first)
  })

  it('backs up what it replaces and honours skip / keep-both', async () => {
    const { bundle, big } = await exported()
    const home2 = nodePath.join(tmp, 'home2')
    const cfg2 = nodePath.join(home2, '.config', 'obs-studio')
    fs.mkdirSync(nodePath.join(cfg2, 'basic/scenes'), { recursive: true })
    fs.writeFileSync(nodePath.join(cfg2, 'basic/scenes/Main.json'), '{"name":"Main","mine":true}')
    const base = { bundle, install: install(cfg2), host: host('linux', home2), assetFiles: { mix: big } }

    const skip = planImport({ ...base, conflict: 'skip' })
    applyImport(skip)
    expect(fs.readFileSync(nodePath.join(cfg2, 'basic/scenes/Main.json'), 'utf8')).toContain('mine')

    const both = planImport({ ...base, conflict: 'keep-both' })
    applyImport(both)
    expect(fs.existsSync(nodePath.join(cfg2, 'basic/scenes/Main (2).json'))).toBe(true)
    expect(fs.readFileSync(nodePath.join(cfg2, 'basic/scenes/Main.json'), 'utf8')).toContain('mine')

    const rep = planImport({ ...base, conflict: 'replace', now: new Date('2026-02-02T00:00:00Z') })
    const res = applyImport(rep)
    expect(res.backedUp.length).toBeGreaterThan(0)
    expect(fs.readFileSync(res.backedUp.find((b) => b.includes('Main.json'))!, 'utf8')).toContain('mine')
  })

  it('blocks while OBS is running and reports missing external media', async () => {
    const { bundle } = await exported()
    const home2 = nodePath.join(tmp, 'home2')
    const plan = planImport({ bundle, install: install(nodePath.join(home2, 'c')), host: host('linux', home2), obsRunning: true })
    expect(plan.report.blockers[0]).toMatch(/OBS is running/)
    expect(() => applyImport(plan)).toThrow(/OBS is running/)
    expect(plan.report.missingAssets.map((a) => a.id)).toContain('mix')
    expect(plan.report.missingVariables.map((v) => v.name)).toContain('STREAM_KEY')
  })

  it('Linux to Windows: substitutes capture, keeps unmappable hidden, converts paths', async () => {
    const { bundle } = await exported()
    const wHome = 'C:\\Users\\streamer'
    const wCfg = 'C:\\Users\\streamer\\AppData\\Roaming\\obs-studio'
    const plan = planImport({
      bundle, host: host('win32', wHome),
      install: { ...install(wCfg), kind: 'windows', platform: 'win32', pluginDirs: [] },
      assetFiles: { mix: 'D:\\Media\\mix.mp3' },
    })
    const colWrite = plan.writes.find((w) => w.kind === 'collection')!
    expect(colWrite.path).toBe('C:\\Users\\streamer\\AppData\\Roaming\\obs-studio\\basic\\scenes\\Main.json')
    const col = JSON.parse(colWrite.data.toString('utf8'))
    const win = col.sources.find((s: any) => s.name === 'Window')
    expect(win.id).toBe('window_capture')
    expect(win.settings).toEqual({})
    const overlay = col.sources.find((s: any) => s.name === 'Overlay')
    expect(overlay.settings.file).toMatch(/^C:\\Users\\streamer\\AppData\\Roaming\\obs-studio\\obs-config-loader\\.+\\media\\overlay\\overlay\.png$/)
    const pw = col.sources.find((s: any) => s.name === 'Game audio')
    expect(pw.id).toBe('pipewire_audio_application_capture') // a plugin source: untouched, reported
    expect(plan.report.substitutions).toEqual([expect.objectContaining({ source: 'Window', from: 'xcomposite_input', to: 'window_capture', result: 'substituted' })])
    const ini = plan.writes.find((w) => w.path.endsWith('basic.ini'))!.data.toString('utf8')
    expect(ini).toContain('FilePath=C:\\Users\\streamer\\Videos')
    expect(plan.report.warnings.join(' ')).toMatch(/Made on linux, importing on win32/)
  })

  it('hides a source with no equivalent instead of dropping it', () => {
    const bundle = {
      manifest: parseManifest({ format: 'obs-config-bundle', version: 1, id: 'i', name: 'n', collections: [{ id: 'c', name: 'C', file: 'collections/c.json' }] }),
      files: new Map([['collections/c.json', Buffer.from(JSON.stringify({
        name: 'C',
        sources: [
          { id: 'scene', name: 'S', settings: { items: [{ name: 'Game', visible: true }] } },
          { id: 'game_capture', name: 'Game', settings: { window: 'x' } },
        ],
      }))]]),
    }
    const home = nodePath.join(tmp, 'h')
    const plan = planImport({ bundle, install: install(nodePath.join(home, 'c')), host: host('linux', home) })
    const col = JSON.parse(plan.writes[0].data.toString('utf8'))
    expect(col.sources[1].id).toBe('game_capture')
    expect(col.sources[1].settings).toEqual({ window: 'x' })
    expect(col.sources[0].settings.items[0].visible).toBe(false)
    expect(plan.report.substitutions[0]).toMatchObject({ result: 'disabled', from: 'game_capture' })
  })
})

describe('bundle io', () => {
  it('refuses newer versions and wrong formats, keeps unknown fields', async () => {
    expect(() => parseManifest({ format: 'obs-config-bundle', version: 99, id: 'a', name: 'n' })).toThrow(/up to 1/)
    expect(() => parseManifest({ format: 'other', version: 1, id: 'a', name: 'n' })).toThrow(BundleError)
    const m = parseManifest({ format: 'obs-config-bundle', version: 1, id: 'a', name: 'n', futureField: { a: 1 } })
    expect(m.futureField).toEqual({ a: 1 })
  })

  it('rejects path traversal in zips', async () => {
    const JSZip = (await import('jszip')).default
    const z = new JSZip()
    z.file('manifest.json', JSON.stringify({ format: 'obs-config-bundle', version: 1, id: 'a', name: 'n' }))
    z.file('../evil.txt', 'x')
    const buf = await z.generateAsync({ type: 'nodebuffer' })
    // JSZip already folds ".." away on load; either way nothing may keep a path that climbs out.
    const b = await readBundleZip(buf).catch(() => undefined)
    for (const k of b?.files.keys() ?? []) expect(k.split('/')).not.toContain('..')
  })

  it('writes the directory form with placeholders instead of media, and reads it back', async () => {
    const home = nodePath.join(tmp, 'home')
    const { cfg } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'G' })
    const dir = nodePath.join(tmp, 'repo')
    writeBundleDir(b, dir)
    expect(fs.existsSync(nodePath.join(dir, 'media'))).toBe(false)
    const lock = JSON.parse(fs.readFileSync(nodePath.join(dir, 'assets.lock.json'), 'utf8'))
    expect(Object.keys(lock).length).toBe(b.manifest.assets.length)
    const back = readBundleDir(dir)
    expect(back.manifest.assets.every((a) => a.mode === 'external')).toBe(true)
    expect(back.manifest.assets.find((a) => a.filename === 'overlay.png')!.sha256).toBeTruthy()
    expect(back.files.get('collections/main.json')!.equals(b.files.get('collections/main.json')!)).toBe(true)
  })

  it('exports identical bytes twice', async () => {
    const home = nodePath.join(tmp, 'home')
    const { cfg } = makeSource(home)
    const o = { host: host('linux', home), install: install(cfg), name: 'D', id: 'fixed', now: new Date('2026-01-01T00:00:00Z') }
    const a = await writeBundleZip(exportBundle(o))
    const b = await writeBundleZip(exportBundle(o))
    expect(a.equals(b)).toBe(true)
  })
})
