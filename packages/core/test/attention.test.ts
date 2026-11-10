import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { captureLive, commitAll, findRenamedAssets, initRepo, markSynced, missingFilesInObs, obsLastChanged, pendingForObs, presetLastSaved, readBundleDir, replacePathInObs } from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-attn-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function setup() {
  const home = nodePath.join(tmp, 'home')
  const { cfg } = makeSource(home)
  const dir = nodePath.join(tmp, 'preset')
  return { home, cfg, dir, h: host('linux', home), inst: install(cfg), mp3: nodePath.join(home, 'Music', 'mix.mp3') }
}

describe('a preset only asks for attention when something really changed', () => {
  it('a big file that was only touched (same bytes, newer date) is not a change, now or on the next check', async () => {
    const { dir, h, inst, mp3 } = setup()
    await initRepo(dir)
    expect((await captureLive({ host: h, install: inst, dir, name: 'M' })).status).toBe('committed')
    const t = new Date(Date.now() + 60_000); fs.utimesSync(mp3, t, t)
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toEqual({ status: 'unchanged' })
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toEqual({ status: 'unchanged' })
  })

  it('a big file whose bytes really changed is a change, but the preset\'s own copy is never listed as one', async () => {
    const { dir, h, inst, mp3 } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    const copy = nodePath.join(dir, 'local/media/mix/mix.mp3')
    const bytes = fs.readFileSync(mp3); bytes[0] = bytes[0] ^ 0xff
    fs.writeFileSync(mp3, bytes); const t = new Date(Date.now() + 60_000); fs.utimesSync(mp3, t, t)
    const dry = await captureLive({ host: h, install: inst, dir, dryRun: true })
    expect(dry.status).toBe('changes')
    expect('files' in dry && dry.files.some((f) => f.startsWith('local/media/'))).toBe(false)
    expect(fs.readFileSync(copy).equals(bytes)).toBe(false) // a check never touches the copy
    expect((await captureLive({ host: h, install: inst, dir })).status).toBe('committed')
    expect(fs.readFileSync(copy).equals(bytes)).toBe(true)
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toEqual({ status: 'unchanged' })
  })

  it('another system\'s version of a source or an encoder is not an update for this OBS', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    await markSynced(dir, inst)
    expect(await pendingForObs(dir, inst)).toEqual([])
    const f = nodePath.join(dir, 'profiles/main/platforms.json')
    fs.mkdirSync(nodePath.dirname(f), { recursive: true })
    const base = { linux: { ini: { AdvOut: { Encoder: 'x264' } } }, win32: { ini: { AdvOut: { Encoder: 'ffmpeg_nvenc' } } } }
    fs.writeFileSync(f, JSON.stringify(base)); await commitAll(dir, 'platforms')
    await markSynced(dir, inst)
    // a Windows computer saved
    fs.writeFileSync(f, JSON.stringify({ ...base, win32: { ini: { AdvOut: { Encoder: 'obs_x264' } } } })); await commitAll(dir, 'windows save')
    expect(await pendingForObs(dir, inst)).toEqual([])
    // a Linux computer saved
    fs.writeFileSync(f, JSON.stringify({ ...base, linux: { ini: { AdvOut: { Encoder: 'vaapi' } } } })); await commitAll(dir, 'linux save')
    expect(await pendingForObs(dir, inst)).toEqual(['profiles/main/platforms.json'])
  })
})

describe('a media file renamed outside the app', () => {
  const rename = (from: string, to: string) => { fs.renameSync(from, to); return to }

  it('is recognised by its contents, in the folder it was in', async () => {
    const { dir, h, inst, mp3, home } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    const manifest = readBundleDir(dir).manifest
    const locations = { mix: mp3 }
    expect(await findRenamedAssets(manifest, locations)).toEqual([]) // nothing moved
    const now = rename(mp3, nodePath.join(home, 'Music', 'mix v2.mp3'))
    expect(await findRenamedAssets(manifest, locations)).toEqual([{ id: 'mix', filename: 'mix.mp3', from: mp3, to: now }])
    // a different file of the same size is not it
    const other = Buffer.alloc(fs.statSync(now).size, 7); fs.writeFileSync(nodePath.join(home, 'Music', 'other.mp3'), other)
    expect((await findRenamedAssets(manifest, locations)).map((r) => r.to)).toEqual([now])
    // two identical copies: no guess
    fs.copyFileSync(now, nodePath.join(home, 'Music', 'mix copy.mp3'))
    expect(await findRenamedAssets(manifest, locations)).toEqual([])
  })

  it('is found from OBS\'s own scenes even when the app only remembers its own copy of the file', async () => {
    const { dir, h, inst, mp3, home, cfg } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    const manifest = readBundleDir(dir).manifest
    const ownCopy = nodePath.join(dir, 'local/media/mix/mix.mp3') // what the app used to remember instead of the real place
    expect(missingFilesInObs(cfg)).toEqual([])
    const now = rename(mp3, nodePath.join(home, 'Music', 'a better name.mp3'))
    expect(missingFilesInObs(cfg)).toEqual([mp3])
    expect(await findRenamedAssets(manifest, { mix: ownCopy }, missingFilesInObs(cfg))).toEqual([{ id: 'mix', filename: 'mix.mp3', from: mp3, to: now }])
  })

  it('keeps its identity in the preset when it is saved under the new name, and the old copy goes', async () => {
    const { dir, h, inst, mp3, home, cfg } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    expect(fs.existsSync(nodePath.join(dir, 'local/media/mix/mix.mp3'))).toBe(true)
    const now = rename(mp3, nodePath.join(home, 'Music', 'mix v2.mp3'))
    expect(replacePathInObs(cfg, mp3, now)).toBeGreaterThan(0) // OBS's scenes follow the file
    expect(replacePathInObs(cfg, mp3, now)).toBe(0)           // and only once
    // without the hint the file would be a brand new one
    expect((await captureLive({ host: h, install: inst, dir, dryRun: true })).status).toBe('changes')
    const r = await captureLive({ host: h, install: inst, dir, assetIdHints: { [now]: 'mix' } })
    expect(r.status).toBe('committed')
    const assets = readBundleDir(dir).manifest.assets.filter((a) => /mix/.test(a.id))
    expect(assets.map((a) => [a.id, a.filename])).toEqual([['mix', 'mix v2.mp3']])
    expect(fs.readdirSync(nodePath.join(dir, 'local/media/mix'))).toEqual(['mix v2.mp3'])
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true, assetIdHints: { [now]: 'mix' } })).toEqual({ status: 'unchanged' })
  })
})

describe('an OBS that was never compared with the preset', () => {
  /** A preset made from one OBS (with two scene layouts); a second OBS that only has one of them. */
  async function twoComputers() {
    const { dir, h, inst, cfg, home } = setup()
    fs.writeFileSync(nodePath.join(cfg, 'basic/scenes/Extra.json'), JSON.stringify({ name: 'Extra', current_scene: 'S', sources: [{ id: 'scene', name: 'S', uuid: 'u-s', settings: { items: [] } }] }))
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    // the other computer: the same preset (cloned), its OBS has the first layout only
    const home2 = nodePath.join(tmp, 'home2'); const cfg2 = nodePath.join(home2, 'obs'); fs.mkdirSync(nodePath.join(cfg2, 'basic/scenes'), { recursive: true }); fs.mkdirSync(nodePath.join(cfg2, 'basic/profiles'), { recursive: true })
    fs.copyFileSync(nodePath.join(cfg, 'basic/scenes/Main.json'), nodePath.join(cfg2, 'basic/scenes/Main.json'))
    fs.cpSync(nodePath.join(cfg, 'basic/profiles'), nodePath.join(cfg2, 'basic/profiles'), { recursive: true })
    const inst2 = { ...install(cfg2), id: 'second-pc' }
    return { dir, h, inst, inst2 }
  }

  it('says so instead of calling the preset\'s own content "OBS changes"', async () => {
    const { dir, h, inst, inst2 } = await twoComputers()
    const a = await captureLive({ host: h, install: inst2, dir, dryRun: true })
    expect(a).toMatchObject({ status: 'changes', unsynced: true })
    expect('files' in a && a.files).toContain('collections/extra.json') // the layout the preset has and this OBS lacks
    // the OBS that made the preset is matched: no such claim
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toEqual({ status: 'unchanged' })
  })

  it('will not remove the preset\'s layouts without a clear yes, and then it is matched', async () => {
    const { dir, h, inst2 } = await twoComputers()
    const ask = await captureLive({ host: h, install: inst2, dir })
    expect(ask).toEqual({ status: 'would-remove', removes: ['collections/extra.json'] })
    expect(fs.existsSync(nodePath.join(dir, 'collections/extra.json'))).toBe(true) // nothing was touched by asking
    const done = await captureLive({ host: h, install: inst2, dir, confirmRemoval: true })
    expect(done.status).toBe('committed')
    expect(fs.existsSync(nodePath.join(dir, 'collections/extra.json'))).toBe(false)
    const after = await captureLive({ host: h, install: inst2, dir, dryRun: true })
    expect(after.status === 'unchanged' || !('unsynced' in after && after.unsynced)).toBe(true)
  })

  it('applying the preset matches it too (nothing left to ask)', async () => {
    const { dir, h, inst2 } = await twoComputers()
    await markSynced(dir, inst2) // what Apply does
    expect((await captureLive({ host: h, install: inst2, dir, dryRun: true })).status).toBe('changes') // now they ARE OBS's changes: the preset has an extra layout OBS lacks
    const r = await captureLive({ host: h, install: inst2, dir, dryRun: true })
    expect('unsynced' in r && r.unsynced).toBeFalsy()
  })

  it('tells when each side was last changed', async () => {
    const { dir, inst2 } = await twoComputers()
    const saved = await presetLastSaved(dir)
    expect(saved?.date).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(obsLastChanged(inst2.configDir)).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(obsLastChanged(nodePath.join(tmp, 'nothing-here'))).toBeNull()
  })
})

describe('a preset\'s setup steps survive saves from OBS', () => {
  it('manifest.setup is still there, and still tracked, after OBS changes and is saved again', async () => {
    const { dir, h, inst, cfg } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'M' })
    const mf = nodePath.join(dir, 'manifest.json')
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'))
    m.setup = { steps: [{ id: 'go', title: 'Go', run: { any: { program: '{{python}}' } } }] }
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n'); await commitAll(dir, 'add a step')
    await markSynced(dir, inst)
    const scenes = nodePath.join(cfg, 'basic/scenes'); const f = nodePath.join(scenes, fs.readdirSync(scenes).find((x) => x.endsWith('.json'))!)
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.current_scene = 'changed'; fs.writeFileSync(f, JSON.stringify(j))
    expect((await captureLive({ host: h, install: inst, dir })).status).toBe('committed')
    expect(readBundleDir(dir).manifest.setup?.steps?.[0]?.id).toBe('go')
  })
})
