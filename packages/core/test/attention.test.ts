import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { captureLive, commitAll, findRenamedAssets, initRepo, markSynced, missingFilesInObs, pendingForObs, readBundleDir, replacePathInObs } from '../src/index.js'
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
