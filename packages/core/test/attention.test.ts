import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { captureLive, commitAll, initRepo, markSynced, pendingForObs } from '../src/index.js'
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
