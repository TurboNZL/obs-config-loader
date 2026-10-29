import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  captureLive, initRepo, repoStatus, repoLog, pullRepo, pushRepo, commitAll, cloneRepo, assetNeeds, preservePlatformSources,
  readBundleDir, markSynced, type Manifest,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-repo-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
// no global identity in CI: the app supplies its own, but the test's direct git calls need one
const ident = ['-c', 'user.name=T', '-c', 'user.email=t@example.com']

function setup() {
  const home = nodePath.join(tmp, 'home')
  const { cfg } = makeSource(home)
  const dir = nodePath.join(tmp, 'repo')
  return { home, cfg, dir, h: host('linux', home), inst: install(cfg), scene: nodePath.join(cfg, 'basic/scenes/Main.json') }
}

describe('captureLive', () => {
  it('commits the first capture, does nothing when OBS has not changed, commits real edits', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    const first = await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(first).toMatchObject({ status: 'committed', merged: false })
    expect((await repoLog(dir)).length).toBe(1)

    const again = await captureLive({ host: h, install: inst, dir })
    expect(again).toEqual({ status: 'unchanged' })
    expect((await repoLog(dir)).length).toBe(1)

    // the user edits a scene in OBS
    const j = JSON.parse(fs.readFileSync(scene, 'utf8'))
    j.sources.push({ id: 'color_source', name: 'Backdrop', uuid: 'u-bd', settings: { color: 4278190335 } })
    fs.writeFileSync(scene, JSON.stringify(j))
    const dry = await captureLive({ host: h, install: inst, dir, dryRun: true })
    expect(dry).toEqual({ status: 'changes', files: ['collections/main.json'] })
    expect((await repoLog(dir)).length).toBe(1) // a dry run commits nothing

    const second = await captureLive({ host: h, install: inst, dir })
    expect(second).toMatchObject({ status: 'committed', merged: false, files: ['collections/main.json'] })
    expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).toContain('Backdrop')
    expect((await repoLog(dir)).length).toBe(2)
  })

  it('keeps the repo identity and name, and never puts secrets or media in git', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const m1 = readBundleDir(dir).manifest
    await captureLive({ host: h, install: inst, dir, name: 'Renamed?' })
    expect(readBundleDir(dir).manifest.id).toBe(m1.id)
    expect(readBundleDir(dir).manifest.name).toBe('Mine')
    const tracked = git(dir, 'ls-files')
    expect(tracked).not.toMatch(/media\//)
    expect(() => git(dir, 'grep', '-q', 'SECRET')).toThrow() // grep exits 1: no match anywhere
  })

  it('refuses to overwrite uncommitted edits in the repo, or commits them first on request', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    // someone (an AI, the user) edits the repo working tree by hand
    const p = nodePath.join(dir, 'collections/main.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    j.current_scene = 'Edited elsewhere'
    fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n')
    const r = await captureLive({ host: h, install: inst, dir })
    expect(r).toEqual({ status: 'dirty', files: ['collections/main.json'] })
    expect(fs.readFileSync(p, 'utf8')).toContain('Edited elsewhere') // untouched

    const live = JSON.parse(fs.readFileSync(scene, 'utf8'))
    live.sources.push({ id: 'color_source', name: 'Backdrop', uuid: 'u-bd', settings: {} })
    fs.writeFileSync(scene, JSON.stringify(live))
    const r2 = await captureLive({ host: h, install: inst, dir, onDirty: 'commit-first' })
    expect(r2.status).toBe('committed')
    const log = await repoLog(dir)
    expect(log.map((l) => l.subject)).toContain('Changes made outside OBS Config Loader')
    // both edits survive: the hand edit and the live one
    const merged = fs.readFileSync(p, 'utf8')
    expect(merged).toContain('Edited elsewhere')
    expect(merged).toContain('Backdrop')
  })

  it('reports a folder that is not a repo of its own', async () => {
    const { dir, h, inst } = setup()
    fs.mkdirSync(dir, { recursive: true })
    expect(await captureLive({ host: h, install: inst, dir })).toMatchObject({ status: 'error' })
    expect((await repoStatus(dir)).isRepo).toBe(false)
  })
})

describe('merging live edits with changes made in the repo', () => {
  const edit = (dir: string, fn: (j: any) => void) => {
    const p = nodePath.join(dir, 'collections/main.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    fn(j)
    fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n')
  }

  it('an AI/hand edit committed in the repo and a live OBS edit both end up in the result', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })

    // 1. the repo moves on (an AI tweaks the scene collection and commits)
    edit(dir, (j) => { j.current_scene = 'AI renamed' })
    await commitAll(dir, 'AI tweak')
    // 2. meanwhile the user changed something in OBS
    const live = JSON.parse(fs.readFileSync(scene, 'utf8'))
    live.sources.push({ id: 'color_source', name: 'Backdrop', uuid: 'u-bd', settings: { color: 1 } })
    fs.writeFileSync(scene, JSON.stringify(live))

    const r = await captureLive({ host: h, install: inst, dir })
    expect(r).toMatchObject({ status: 'committed', merged: true })
    const out = fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')
    expect(out).toContain('AI renamed')   // not reverted by the live save
    expect(out).toContain('Backdrop')     // the live edit is kept too
    expect((await repoStatus(dir)).dirtyFiles).toEqual([])
  })

  it('a pending repo change is not mistaken for a live change, until it is applied', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    edit(dir, (j) => { j.current_scene = 'AI renamed' })
    await commitAll(dir, 'AI tweak')
    // OBS still has the old state: nothing live to save, so nothing reverts the repo
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toEqual({ status: 'unchanged' })
    expect(await captureLive({ host: h, install: inst, dir })).toEqual({ status: 'unchanged' })
    expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).toContain('AI renamed')
    await markSynced(dir, inst)
    // now OBS is considered to hold the AI's version: reverting that in OBS is a real live edit
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toMatchObject({ status: 'changes' })
  })

  it('reports a true conflict and leaves the repo exactly as it was', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    edit(dir, (j) => { j.current_scene = 'From the repo' })
    await commitAll(dir, 'repo edit')
    const before = git(dir, 'rev-parse', 'HEAD')
    const live = JSON.parse(fs.readFileSync(scene, 'utf8'))
    live.current_scene = 'From OBS'
    fs.writeFileSync(scene, JSON.stringify(live))

    const r = await captureLive({ host: h, install: inst, dir })
    expect(r).toEqual({ status: 'conflict', conflicts: ['collections/main.json'] })
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(dir, 'status', '--porcelain')).toBe('')
    expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).toContain('From the repo')
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(1) // scratch checkout cleaned up
  })

  it('keeps the other platform\'s capture source when a Linux machine saves', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    // the repo's Window source came from Windows
    edit(dir, (j) => { const s = j.sources.find((x: any) => x.name === 'Window'); s.id = 'window_capture'; s.settings = { window: 'Game:cls:game.exe' } })
    await commitAll(dir, 'from Windows')
    await markSynced(dir, inst)
    // on this Linux box the import turned it into its stand-in; the user then edits something else
    const live = JSON.parse(fs.readFileSync(scene, 'utf8'))
    live.sources.push({ id: 'color_source', name: 'Backdrop', uuid: 'u-bd', settings: {} })
    fs.writeFileSync(scene, JSON.stringify(live))
    const r = await captureLive({ host: h, install: inst, dir })
    expect(r.status).toBe('committed')
    const out = JSON.parse(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8'))
    expect(out.sources.find((x: any) => x.name === 'Window')).toMatchObject({ id: 'window_capture', settings: { window: 'Game:cls:game.exe' } })
    expect(out.sources.find((x: any) => x.name === 'Backdrop')).toBeTruthy()
  })
})

describe('remotes', () => {
  async function twoClones() {
    const bare = nodePath.join(tmp, 'remote.git')
    git(tmp, 'init', '--bare', '--initial-branch=main', bare)
    const { dir: a, h, inst, scene, cfg } = setup()
    await initRepo(a)
    git(a, 'remote', 'add', 'origin', bare)
    await captureLive({ host: h, install: inst, dir: a, name: 'Mine' })
    expect(await pushRepo(a)).toEqual({ status: 'pushed' })
    expect(await pushRepo(a)).toEqual({ status: 'nothing' })
    const b = nodePath.join(tmp, 'clone-b')
    await cloneRepo(bare, b)
    return { a, b, h, inst, scene, cfg, bare }
  }

  it('pulls another machine\'s change, and reports up to date', async () => {
    const { a, b } = await twoClones()
    expect(await pullRepo(b)).toEqual({ status: 'up-to-date' })
    const p = nodePath.join(b, 'collections/main.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    j.current_scene = 'From B'
    fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n')
    await commitAll(b, 'B edit')
    expect(await pushRepo(b)).toEqual({ status: 'pushed' })
    expect(await pullRepo(a)).toEqual({ status: 'updated', files: ['collections/main.json'] })
    expect(fs.readFileSync(nodePath.join(a, 'collections/main.json'), 'utf8')).toContain('From B')
    const st = await repoStatus(a)
    expect(st).toMatchObject({ isRepo: true, branch: 'main', ahead: 0, behind: 0, dirtyFiles: [] })
  })

  it('aborts a conflicting pull cleanly instead of leaving markers', async () => {
    const { a, b } = await twoClones()
    const edit = (dir: string, v: string) => {
      const p = nodePath.join(dir, 'collections/main.json')
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      j.current_scene = v
      fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n')
    }
    edit(b, 'B'); await commitAll(b, 'B'); await pushRepo(b)
    edit(a, 'A'); await commitAll(a, 'A')
    const r = await pullRepo(a)
    expect(r).toEqual({ status: 'conflict', conflicts: ['collections/main.json'] })
    expect(fs.readFileSync(nodePath.join(a, 'collections/main.json'), 'utf8')).not.toContain('<<<<<<<')
    expect((await repoStatus(a)).dirtyFiles).toEqual([])
  })

  it('refuses to pull over uncommitted changes, and says when there is no remote', async () => {
    const { a } = await twoClones()
    fs.writeFileSync(nodePath.join(a, 'collections/main.json'), '{}')
    expect(await pullRepo(a)).toMatchObject({ status: 'dirty' })
    const lone = nodePath.join(tmp, 'lone'); await initRepo(lone)
    expect(await pullRepo(lone)).toEqual({ status: 'no-remote' })
    expect(await pushRepo(lone)).toEqual({ status: 'no-remote' })
  })
})

describe('placeholders for big files', () => {
  it('asks for what is missing, accepts what is located, flags what changed', async () => {
    const f = nodePath.join(tmp, 'mix.mp3')
    fs.writeFileSync(f, 'v1')
    const sha = (await import('node:crypto')).createHash('sha256').update('v1').digest('hex')
    const m = { assets: [
      { id: 'mix', filename: 'mix.mp3', mode: 'external', sha256: sha, hint: 'big' },
      { id: 'logo', filename: 'logo.png', mode: 'bundled' },
    ] } as unknown as Manifest
    expect(await assetNeeds(m, {})).toEqual([{ id: 'mix', filename: 'mix.mp3', hint: 'big', reason: 'missing' }])
    expect(await assetNeeds(m, { mix: f })).toEqual([])
    fs.writeFileSync(f, 'v2')
    expect(await assetNeeds(m, { mix: f })).toEqual([expect.objectContaining({ id: 'mix', reason: 'changed', path: f })])
    fs.rmSync(f)
    expect((await assetNeeds(m, { mix: f }))[0].reason).toBe('missing')
  })
})

describe('preservePlatformSources', () => {
  const prev = { sources: [{ id: 'window_capture', name: 'Game', settings: { window: 'Fortnite:UnrealWindow:x.exe' } }, { id: 'image_source', name: 'Logo', settings: {} }] }

  it('keeps the other OS\'s original when the live one is only its stand-in', () => {
    const next = { sources: [{ id: 'xcomposite_input', name: 'Game', settings: {} }, { id: 'image_source', name: 'Logo', settings: { file: 'x' } }] }
    expect(preservePlatformSources(next, prev, 'linux')).toBe(1)
    expect(next.sources[0]).toBe(prev.sources[0])
    expect(next.sources[1].settings).toEqual({ file: 'x' }) // everything else is the live version
  })

  it('does not overrule a source the user deliberately changed to something else', () => {
    const next = { sources: [{ id: 'image_source', name: 'Game', settings: {} }] }
    expect(preservePlatformSources(next, prev, 'linux')).toBe(0)
    expect(next.sources[0].id).toBe('image_source')
  })

  it('does nothing when the original works on this platform', () => {
    const next = { sources: [{ id: 'window_capture', name: 'Game', settings: { window: 'other' } }] }
    expect(preservePlatformSources(next, prev, 'win32')).toBe(0)
  })
})
