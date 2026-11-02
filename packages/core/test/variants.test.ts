import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import {
  extractVariants, applyVariants, serializeVariants, parseVariants, variantsPathFor, exportBundle, planImport,
  captureLive, initRepo, readBundleDir, repoStatus, markSynced, type ObsInstall,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

describe('extractVariants', () => {
  const live = { sources: [
    { id: 'scene', name: 'Scene', settings: {} },
    { id: 'xcomposite_input', name: 'Game', settings: { capture_window: '0x1' } },
    { id: 'pulse_output_capture', name: 'Desktop audio', settings: { device_id: 'default' } },
    { id: 'image_source', name: 'Logo', settings: { file: '{{asset:logo}}' } },
  ] }

  it('records this platform\'s capture sources, and only those', () => {
    const v = extractVariants(live, 'linux')
    expect(Object.keys(v).sort()).toEqual(['Desktop audio', 'Game'])
    expect(v.Game!.linux).toEqual({ id: 'xcomposite_input', settings: { capture_window: '0x1' } })
  })

  it('keeps what other platforms saved, replaces only its own, drops what is gone', () => {
    const prev = {
      Game: { win32: { id: 'game_capture', settings: { window: 'Fortnite' } }, linux: { id: 'xcomposite_input', settings: { capture_window: 'OLD' } } },
      Removed: { win32: { id: 'window_capture', settings: {} } },
      Logo: { win32: { id: 'window_capture', settings: {} } }, // became an image source: not platform-specific any more
    }
    const v = extractVariants(live, 'linux', prev)
    expect(v.Game!.win32).toEqual({ id: 'game_capture', settings: { window: 'Fortnite' } })
    expect(v.Game!.linux!.settings).toEqual({ capture_window: '0x1' })
    expect(v.Removed).toBeUndefined()
    expect(v.Logo).toBeUndefined()
  })

  it('does not record an untouched stand-in that an import put there for another OS\'s source', () => {
    const canonical = { sources: [{ id: 'window_capture', name: 'Game', settings: { window: 'Fortnite' } }] }
    const standIn = { sources: [{ id: 'xcomposite_input', name: 'Game', settings: {} }] }
    expect(extractVariants(standIn, 'linux', {}, canonical)).toEqual({})
    // but once the user set it up here, it is theirs
    const setUp = { sources: [{ id: 'xcomposite_input', name: 'Game', settings: { capture_window: '0x9' } }] }
    expect(extractVariants(setUp, 'linux', {}, canonical).Game!.linux).toBeTruthy()
  })

  it('writes the same text however the object was built', () => {
    const a = serializeVariants({ B: { win32: { id: 'x', settings: {} }, linux: { id: 'y', settings: {} } }, A: { linux: { id: 'z', settings: {} } } })
    const b = serializeVariants({ A: { linux: { id: 'z', settings: {} } }, B: { linux: { id: 'y', settings: {} }, win32: { id: 'x', settings: {} } } })
    expect(a).toBe(b)
    expect(Object.keys(JSON.parse(a))).toEqual(['A', 'B'])
    expect(variantsPathFor('collections/main.json')).toBe('collections/main.platforms.json')
    expect(parseVariants('not json')).toEqual({})
  })
})

describe('applyVariants', () => {
  it('uses the platform\'s own version and leaves everything else about the source alone', () => {
    const c = { sources: [{ id: 'window_capture', name: 'Game', uuid: 'u', volume: 0.5, settings: { window: 'W' } }, { id: 'image_source', name: 'Logo', settings: {} }] }
    const used = applyVariants(c, { Game: { linux: { id: 'xcomposite_input', settings: { capture_window: '0x1' } } } }, 'linux')
    expect(used).toEqual([{ source: 'Game', id: 'xcomposite_input' }])
    expect(c.sources[0]).toMatchObject({ id: 'xcomposite_input', uuid: 'u', volume: 0.5, settings: { capture_window: '0x1' } })
    expect(c.sources[1].id).toBe('image_source')
    expect(applyVariants(c, {}, 'darwin')).toEqual([])
  })
})

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-var-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('a setup shared between a Linux and a Windows machine', () => {
  const scenePath = (cfg: string) => nodePath.join(cfg, 'basic/scenes/Main.json')
  const edit = (cfg: string, fn: (j: any) => void) => { const j = JSON.parse(fs.readFileSync(scenePath(cfg), 'utf8')); fn(j); fs.writeFileSync(scenePath(cfg), JSON.stringify(j)) }
  const collection = (dir: string) => JSON.parse(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8'))
  const variants = (dir: string) => JSON.parse(fs.readFileSync(nodePath.join(dir, 'collections/main.platforms.json'), 'utf8'))

  it('keeps one version per OS, never fights over the collection, and imports each OS\'s own', async () => {
    // machine A: Linux, with a window capture set up
    const homeA = nodePath.join(tmp, 'a'); const A = makeSource(homeA)
    const hA = host('linux', homeA), iA = install(A.cfg)
    const repo = nodePath.join(tmp, 'repo'); await initRepo(repo)
    await captureLive({ host: hA, install: iA, dir: repo, name: 'Mine' })
    expect(variants(repo).Window.linux).toMatchObject({ id: 'xcomposite_input', settings: { capture_window: '0x123' } })

    // machine B: Windows. Its OBS has the same collection, but the Window source is a Windows window capture
    const homeB = nodePath.join(tmp, 'b'); const B = makeSource(homeB)
    edit(B.cfg, (j) => { const s = j.sources.find((x: any) => x.name === 'Window'); s.id = 'window_capture'; s.settings = { window: 'Fortnite:UnrealWindow:FortniteClient.exe' } })
    const hB = host('win32', homeB), iB: ObsInstall = { ...install(B.cfg), id: 'win-box', platform: 'win32' }
    const r = await captureLive({ host: hB, install: iB, dir: repo })
    expect(r.status).toBe('committed')

    // the repo now holds both, and the collection file still has the first saver's version (no churn)
    expect(variants(repo).Window.linux.settings).toEqual({ capture_window: '0x123' })
    expect(variants(repo).Window.win32).toEqual({ id: 'window_capture', settings: { window: 'Fortnite:UnrealWindow:FortniteClient.exe' } })
    expect(collection(repo).sources.find((s: any) => s.name === 'Window').id).toBe('xcomposite_input')

    // each machine saving again with nothing changed adds nothing
    const second = await captureLive({ host: hB, install: iB, dir: repo })
    expect(second).toEqual({ status: 'unchanged' })
    await markSynced(repo, iA)
    const third = await captureLive({ host: hA, install: iA, dir: repo, dryRun: true })
    expect(third).toEqual({ status: 'unchanged' })
    expect((await repoStatus(repo)).dirtyFiles).toEqual([])

    // the Linux user changes their capture: only the Linux entry moves
    edit(A.cfg, (j) => { j.sources.find((x: any) => x.name === 'Window').settings = { capture_window: '0x999' } })
    expect((await captureLive({ host: hA, install: iA, dir: repo })).status).toBe('committed')
    expect(variants(repo).Window.linux.settings).toEqual({ capture_window: '0x999' })
    expect(variants(repo).Window.win32.settings.window).toContain('Fortnite')

    // importing: each OS gets its own version; a third OS (macOS) has none and gets a clearly reported stand-in
    const b = readBundleDir(repo)
    const homeC = nodePath.join(tmp, 'c')
    const forLinux = planImport({ bundle: b, install: install(nodePath.join(homeC, 'cfg')), host: host('linux', homeC), assetFiles: { mix: A.big } })
    const winL = JSON.parse(forLinux.writes.find((w) => w.kind === 'collection')!.data.toString()).sources.find((s: any) => s.name === 'Window')
    expect(winL).toMatchObject({ id: 'xcomposite_input', settings: { capture_window: '0x999' } })
    expect(forLinux.report.substitutions).toEqual([expect.objectContaining({ source: 'Window', result: 'variant' }), expect.objectContaining({ source: 'Game audio', result: 'variant' })])

    const forWin = planImport({ bundle: b, install: { ...install('C:\\cfg'), platform: 'win32' }, host: host('win32', 'C:\\Users\\u'), assetFiles: { mix: 'D:\\mix.mp3' } })
    const winW = JSON.parse(forWin.writes.find((w) => w.kind === 'collection')!.data.toString()).sources.find((s: any) => s.name === 'Window')
    expect(winW).toMatchObject({ id: 'window_capture', settings: { window: 'Fortnite:UnrealWindow:FortniteClient.exe' } })

    const forMac = planImport({ bundle: b, install: install(nodePath.join(homeC, 'm')), host: host('darwin', homeC), assetFiles: { mix: A.big } })
    expect(JSON.parse(forMac.writes.find((w) => w.kind === 'collection')!.data.toString()).sources.find((s: any) => s.name === 'Window').id).toBe('screen_capture')
    expect(forMac.report.substitutions).toContainEqual(expect.objectContaining({ source: 'Window', result: 'substituted' }))
  })

  it('a zip export carries the variants too', () => {
    const home = nodePath.join(tmp, 'z'); const { cfg } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'Z' })
    expect(JSON.parse(b.files.get('collections/main.platforms.json')!.toString()).Window.linux.id).toBe('xcomposite_input')
  })
})
