import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  applyCloudSettings, applyExtras, buildPresetFile, captureLive, cloneRepo, commitAll, extrasContent, initRepo, localMediaPath, pushRepo, readBundleDir, readExtras, readLocalKeys,
  readLocalSettings, repoStatus, setRemote, writeBundleZip, readBundleZip, writeExtras, writeLocalSettings, type CaptureResult,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-local-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

function setup() {
  const home = nodePath.join(tmp, 'home')
  const { cfg, big } = makeSource(home)
  const dir = nodePath.join(tmp, 'preset')
  return { home, cfg, big, dir, h: host('linux', home), inst: install(cfg), scene: nodePath.join(cfg, 'basic/scenes/Main.json') }
}
const files = (r: CaptureResult) => ('files' in r ? r.files : [])

describe('the local save: a preset keeps everything on this computer, git sees only what can go online', () => {
  it('keeps stream keys and big files inside the preset, in local/, and never in git or its history', async () => {
    const { dir, h, inst, big } = setup()
    await initRepo(dir)
    const r = await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(r).toMatchObject({ status: 'committed', keys: 2, copied: 2 })

    // the keys are in the preset's own area
    const keys = readLocalKeys(dir)
    expect(Object.values(keys).sort()).toEqual(['live_SECRET123', 'yt-SECRET456'])
    // the big file is there too, byte for byte
    expect(fs.readFileSync(localMediaPath(dir, 'mix', 'mix.mp3')).equals(fs.readFileSync(big))).toBe(true)

    // git tracks none of it, in any commit
    expect(git(dir, 'ls-files')).not.toMatch(/local\//)
    expect(git(dir, 'log', '-p', '--all')).not.toMatch(/SECRET/)
    expect(git(dir, 'status', '--porcelain')).toBe('') // and it is not "changed by hand"
    expect(fs.readFileSync(nodePath.join(dir, '.gitignore'), 'utf8')).toContain('local/')
    // the manifest asks for the file by name, and has no key in it
    const m = readBundleDir(dir).manifest
    expect(m.assets.find((a) => a.id === 'mix')).toMatchObject({ mode: 'external', filename: 'mix.mp3' })
    expect(m.containsSecrets).toBeUndefined()
    expect(m.variables.every((v) => v.value === undefined)).toBe(true)
    expect(fs.readFileSync(nodePath.join(dir, 'manifest.json'), 'utf8')).not.toMatch(/SECRET/)
  })

  it('a changed key still counts as a change (nothing tracked changed), and is kept on the next save', async () => {
    const { dir, h, inst, cfg } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(await captureLive({ host: h, install: inst, dir })).toEqual({ status: 'unchanged' })

    const svc = nodePath.join(cfg, 'basic/profiles/Main/service.json')
    fs.writeFileSync(svc, JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', server: 'auto', key: 'live_NEWKEY' } }))
    const dry = await captureLive({ host: h, install: inst, dir, dryRun: true })
    expect(dry).toMatchObject({ status: 'changes', files: ['local/keys.json'], localChanges: ['local/keys.json'] })
    const saved = await captureLive({ host: h, install: inst, dir })
    expect(saved.status).toBe('committed')
    expect(Object.values(readLocalKeys(dir))).toContain('live_NEWKEY')
    expect(await captureLive({ host: h, install: inst, dir })).toEqual({ status: 'unchanged' })
  })

  it('can be told not to keep the keys, or a file', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    fs.mkdirSync(nodePath.join(dir, 'local'), { recursive: true })
    writeLocalSettings(dir, { keepKeys: false, skipLocalMedia: ['mix'] })
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(readLocalKeys(dir)).toEqual({})
    expect(fs.existsSync(localMediaPath(dir, 'mix', 'mix.mp3'))).toBe(false)
    expect(fs.existsSync(localMediaPath(dir, 'overlay', 'overlay.png'))).toBe(true)
  })

  it('shows what changed, file by file with the lines, for a preview', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const j = JSON.parse(fs.readFileSync(scene, 'utf8'))
    j.sources.push({ id: 'color_source', name: 'Backdrop', uuid: 'u-bd', settings: { color: 4278190335 } })
    fs.writeFileSync(scene, JSON.stringify(j))
    const dry = await captureLive({ host: h, install: inst, dir, dryRun: true, withDiff: true })
    if (dry.status !== 'changes') throw new Error('expected changes')
    const d = dry.details!.find((x) => x.file === 'collections/main.json')!
    expect(d).toMatchObject({ status: 'modified' })
    expect(d.added).toBeGreaterThan(5)
    expect(d.patch).toMatch(/^\+.*"Backdrop"/m)
    expect(d.patch).toMatch(/^@@/)
  })
})

describe('the cloud save: what is uploaded is chosen per preset', () => {
  it('a part kept on this computer is saved locally but never tracked, uploaded or asked for by a copy', async () => {
    const { dir, h, inst, scene } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(git(dir, 'ls-files')).toContain('collections/main.json')

    // switch it off for the cloud: the next save stops tracking it, but it stays here and keeps following OBS
    writeLocalSettings(dir, { cloud: { skip: { layouts: ['main'] } } })
    const j = JSON.parse(fs.readFileSync(scene, 'utf8'))
    j.sources.push({ id: 'color_source', name: 'Backdrop', uuid: 'u-bd', settings: { color: 1 } })
    fs.writeFileSync(scene, JSON.stringify(j))
    const dry = await captureLive({ host: h, install: inst, dir, dryRun: true })
    expect(dry).toMatchObject({ status: 'changes', localChanges: ['collections/main.json'] }) // a change in what only this computer holds
    expect(files(dry)).not.toContain('manifest.json') // nothing tracked changes (it was untracked first)

    const saved = await captureLive({ host: h, install: inst, dir })
    expect(saved.status).toBe('committed')
    expect(git(dir, 'ls-files')).not.toContain('collections/main.json')
    expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).toContain('Backdrop')
    expect(git(dir, 'status', '--porcelain')).toBe('')
    expect(await captureLive({ host: h, install: inst, dir })).toEqual({ status: 'unchanged' })

    // a copy made from the upload does not have it, and nothing breaks or asks for it
    const remote = nodePath.join(tmp, 'remote.git'); fs.mkdirSync(remote); git(remote, 'init', '-q', '--bare', '-b', 'main')
    await setRemote(dir, remote)
    expect((await pushRepo(dir)).status).toBe('pushed')
    const copy = nodePath.join(tmp, 'copy'); await cloneRepo(remote, copy)
    expect(fs.existsSync(nodePath.join(copy, 'collections/main.json'))).toBe(false)
    expect(readBundleDir(copy).manifest.collections).toEqual([]) // not listed: it was not uploaded
    expect(readBundleDir(dir).manifest.collections.map((c) => c.id)).toEqual(['main'])

    // choosing to upload it again: tracked from the next save
    writeLocalSettings(dir, {})
    const again = await captureLive({ host: h, install: inst, dir, dryRun: true })
    expect(files(again)).toContain('collections/main.json')
    await captureLive({ host: h, install: inst, dir })
    expect(git(dir, 'ls-files')).toContain('collections/main.json')
  })

  it('a chosen file is uploaded with the preset; the others stay as placeholders', async () => {
    const { dir, h, inst, big } = setup()
    await initRepo(dir)
    writeLocalSettings(dir, { cloud: { media: ['overlay'] } })
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    expect(git(dir, 'ls-files')).toContain('media/overlay/overlay.png')
    expect(git(dir, 'ls-files')).not.toContain('mix.mp3')
    const m = readBundleDir(dir).manifest
    expect(m.assets.find((a) => a.id === 'overlay')!.mode).toBe('bundled')
    expect(m.assets.find((a) => a.id === 'mix')!.mode).toBe('external')
    // and the local copy of the big one is still there
    expect(fs.statSync(localMediaPath(dir, 'mix', 'mix.mp3')).size).toBe(fs.statSync(big).size)
    // un-choosing it removes it from what git tracks at the next save
    writeLocalSettings(dir, {})
    await captureLive({ host: h, install: inst, dir })
    expect(git(dir, 'ls-files')).not.toContain('media/overlay')
    expect((await repoStatus(dir)).dirtyFiles).toEqual([])
  })
})

describe('changing what is uploaded, without OBS', () => {
  it('stops and starts tracking at once, in one step, and OBS still counts as matching', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    writeLocalSettings(dir, { cloud: { skip: { layouts: ['main'] }, media: ['overlay'] } })
    expect(await applyCloudSettings(dir)).toEqual({ ok: true, changed: true })
    const tracked = git(dir, 'ls-files')
    expect(tracked).not.toContain('collections/main.json')
    expect(tracked).toContain('media/overlay/overlay.png')
    expect(fs.existsSync(nodePath.join(dir, 'collections/main.json'))).toBe(true)
    expect(git(dir, 'status', '--porcelain')).toBe('')
    expect(readBundleDir(dir).manifest.assets.find((a) => a.id === 'overlay')!.mode).toBe('bundled')
    // OBS has not changed, so it must not look as if it had
    expect(await captureLive({ host: h, install: inst, dir, dryRun: true })).toEqual({ status: 'unchanged' })
    expect(await captureLive({ host: h, install: inst, dir })).toEqual({ status: 'unchanged' })
    expect(git(dir, 'ls-files')).not.toContain('collections/main.json')

    // and back
    writeLocalSettings(dir, {})
    expect(await applyCloudSettings(dir)).toEqual({ ok: true, changed: true })
    expect(git(dir, 'ls-files')).toContain('collections/main.json')
    expect(git(dir, 'ls-files')).not.toContain('media/overlay')
    expect(fs.existsSync(localMediaPath(dir, 'overlay', 'overlay.png'))).toBe(true)
    expect(await captureLive({ host: h, install: inst, dir })).toEqual({ status: 'unchanged' })
    expect(await applyCloudSettings(dir)).toEqual({ ok: true, changed: false })
  })

  it('refuses a file GitHub would refuse', async () => {
    const { dir, h, inst, big } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    fs.truncateSync(localMediaPath(dir, 'mix', 'mix.mp3'), 96 * 1024 * 1024)
    writeLocalSettings(dir, { cloud: { media: ['mix'] } })
    const r = await applyCloudSettings(dir)
    expect(r).toMatchObject({ ok: false })
    expect((r as { message: string }).message).toMatch(/100 MB/)
    void big
  })
})

describe('a setup from someone else cannot reach outside the preset', () => {
  it('file names with .. or separators are ignored when copying, removing or restoring', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const m = readBundleDir(dir).manifest
    m.assets.push({ id: '..', filename: 'x.bin', mode: 'bundled' }, { id: 'ok', filename: '../escape.bin', mode: 'bundled' })
    fs.writeFileSync(nodePath.join(dir, 'manifest.json'), JSON.stringify(m))
    await commitAll(dir, 'tampered')
    writeLocalSettings(dir, { cloud: { media: [] } })
    expect(await applyCloudSettings(dir)).toMatchObject({ ok: true })
    expect(fs.existsSync(nodePath.join(dir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(nodePath.join(dir, '.git'))).toBe(true)
    expect(() => localMediaPath(dir, '..', 'x')).toThrow()
    expect(() => localMediaPath(dir, 'a', '../b')).toThrow()
  })
})

describe('a setup file made from a preset', () => {
  async function savedPreset() {
    const s = setup()
    await initRepo(s.dir)
    await captureLive({ host: s.h, install: s.inst, dir: s.dir, name: 'Mine' })
    return s
  }

  it('has the keys only when asked, small files always, big files when chosen', async () => {
    const { dir } = await savedPreset()
    const plain = buildPresetFile({ dir })
    expect(plain.keys).toBe(0)
    expect(plain.bundle.manifest.containsSecrets).toBeUndefined()
    expect(plain.bundle.files.has('media/overlay/overlay.png')).toBe(true)
    expect(plain.bundle.files.has('media/mix/mix.mp3')).toBe(false)
    expect(plain.missingMedia).toEqual(['mix.mp3'])

    const full = buildPresetFile({ dir, includeKeys: true, bigFiles: ['mix'] })
    expect(full.keys).toBe(2)
    expect(full.bundle.manifest.containsSecrets).toBe(true)
    expect(full.bundle.files.has('media/mix/mix.mp3')).toBe(true)
    expect(full.missingMedia).toEqual([])
    const again = await readBundleZip(await writeBundleZip(full.bundle))
    expect(again.manifest.variables.filter((v) => v.value).length).toBe(2)
  })

  it('can be independent (a new identity, no link to the online copy) or stay linked', async () => {
    const { dir } = await savedPreset()
    const id = readBundleDir(dir).manifest.id
    const linked = buildPresetFile({ dir, repository: 'https://github.com/me/OBS-Config-x.git' })
    expect(linked.bundle.manifest.id).toBe(id)
    expect(linked.bundle.manifest.repository).toEqual({ url: 'https://github.com/me/OBS-Config-x.git' })
    const own = buildPresetFile({ dir, independent: true, repository: 'https://github.com/me/OBS-Config-x.git' })
    expect(own.bundle.manifest.id).not.toBe(id)
    expect(own.bundle.manifest.repository).toBeUndefined()
  })
})

describe('the extras file: only what the online copy does not have', () => {
  it('carries the kept-back parts, the files and (when asked) the keys, and restores them into a copy from online', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    writeLocalSettings(dir, { cloud: { skip: { layouts: ['main'] } } })
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const remote = nodePath.join(tmp, 'remote.git'); fs.mkdirSync(remote); git(remote, 'init', '-q', '--bare', '-b', 'main')
    await setRemote(dir, remote); await pushRepo(dir)

    const c = extrasContent(dir)
    expect(c.files).toEqual(['collections/main.json', 'collections/main.platforms.json'])
    expect(c.media.map((x) => x.id).sort()).toEqual(['mix', 'overlay'])
    expect(c.keys).toBe(2)

    const out = nodePath.join(tmp, 'p.obsextras')
    const none = await writeExtras({ dir }, out)
    expect(none).toMatchObject({ files: 2, media: 2, keys: 0 })
    expect(fs.readFileSync(out).includes('SECRET')).toBe(false)

    // another computer: the preset as it came from GitHub
    const copy = nodePath.join(tmp, 'copy'); await cloneRepo(remote, copy)
    expect(readBundleDir(copy).manifest.collections).toEqual([])
    const done = await applyExtras(copy, await readExtras(out))
    expect(done).toEqual({ files: 2, media: 2, keys: 0 })
    expect(readBundleDir(copy).manifest.collections.map((x) => x.id)).toEqual(['main'])
    expect(readLocalSettings(copy).cloud?.skip?.layouts).toEqual(['main'])
    expect((await repoStatus(copy)).dirtyFiles).toEqual([]) // it stays out of git on this side too
    expect(fs.existsSync(localMediaPath(copy, 'mix', 'mix.mp3'))).toBe(true)

    // with keys, only when chosen
    const withKeys = nodePath.join(tmp, 'k.obsextras')
    expect((await writeExtras({ dir, includeKeys: true, mediaIds: [] }, withKeys)).keys).toBe(2)
    const other = nodePath.join(tmp, 'copy2'); await cloneRepo(remote, other)
    expect((await applyExtras(other, await readExtras(withKeys))).keys).toBe(2)
    expect(Object.values(readLocalKeys(other)).sort()).toEqual(['live_SECRET123', 'yt-SECRET456'])
  })

  it('refuses a different preset, and a path that climbs out of the folder', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    const out = nodePath.join(tmp, 'p.obsextras')
    await writeExtras({ dir }, out)
    const other = nodePath.join(tmp, 'other'); await initRepo(other)
    fs.writeFileSync(nodePath.join(other, 'manifest.json'), JSON.stringify({ format: 'obs-config-bundle', version: 1, id: 'someone-else', name: 'Other', collections: [], profiles: [], variables: [], assets: [], plugins: [], platformMap: [] }))
    await commitAll(other, 'x')
    await expect(applyExtras(other, await readExtras(out))).rejects.toThrow(/belongs with the preset/)
  })
})

describe('a preset’s own settings are saved inside it', () => {
  it('travels through GitHub: a copy behaves like the original, and nothing else about git changes', async () => {
    const { dir, h, inst, cfg } = setup()
    const bare = nodePath.join(tmp, 'remote.git'); fs.mkdirSync(bare); git(bare, 'init', '-q', '--bare', '-b', 'main')
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    await setRemote(dir, bare); await pushRepo(dir)
    expect(fs.existsSync(nodePath.join(dir, 'preset-settings.json'))).toBe(false) // nothing chosen yet: nothing written

    // choose: keep one output off GitHub, stream keys not kept, a big file in the storage
    writeLocalSettings(dir, { keepKeys: false, skipLocalMedia: ['mix'], cloud: { skip: { outputs: ['main'] }, stored: ['mix'] }, storage: { endpoint: 's3.us-west-004.backblazeb2.com', region: 'us-west-004', bucket: 'my-files' } })
    const r = await applyCloudSettings(dir)
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(git(dir, 'status', '--porcelain')).toBe('')
    expect(git(dir, 'ls-files')).toContain('preset-settings.json')
    const shared = JSON.parse(fs.readFileSync(nodePath.join(dir, 'preset-settings.json'), 'utf8'))
    expect(shared).toMatchObject({ keepKeys: false, cloud: { skip: { outputs: ['main'] }, stored: ['mix'] }, storage: { bucket: 'my-files' } })
    expect(JSON.stringify(shared)).not.toMatch(/SECRET|secret_?access|accessKey/i)
    await pushRepo(dir)

    // another computer gets a copy: the choices come with it
    const copy = nodePath.join(tmp, 'copy'); await cloneRepo(bare, copy)
    expect(readLocalSettings(copy)).toMatchObject({ keepKeys: false, cloud: { skip: { outputs: ['main'] }, stored: ['mix'] }, storage: { bucket: 'my-files' } })

    // it changes a choice there; the original takes it over after getting the update
    writeLocalSettings(copy, { ...readLocalSettings(copy), keepKeys: true })
    expect((await applyCloudSettings(copy)).ok).toBe(true)
    await pushRepo(copy)
    git(dir, 'pull', '-q', '--no-rebase', 'origin', 'main')
    expect(readLocalSettings(dir).keepKeys).toBe(true)
    // and OBS saving does not turn that into a pending change or a dirty folder
    const again = await captureLive({ host: h, install: inst, dir })
    expect(['unchanged', 'committed']).toContain(again.status)
    expect(git(dir, 'status', '--porcelain')).toBe('')
    void cfg
  })

  it('a save from OBS commits a settings change made without applying it (renames, keys)', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    writeLocalSettings(dir, { ...readLocalSettings(dir), skipLocalMedia: ['mix'] })
    const r = await captureLive({ host: h, install: inst, dir })
    expect(r.status === 'unchanged' || r.status === 'committed').toBe(true)
    expect(git(dir, 'status', '--porcelain')).toBe('')
    expect(git(dir, 'show', 'HEAD:preset-settings.json')).toContain('"skipLocalMedia"')
    // OBS still counts as matching: the settings commit is not "changes the preset has that OBS does not"
    const { pendingForObs } = await import('../src/index.js')
    expect(await pendingForObs(dir, inst)).toEqual([])
  })

  it('a setup file made from a preset carries them too', async () => {
    const { dir, h, inst } = setup()
    await initRepo(dir)
    await captureLive({ host: h, install: inst, dir, name: 'Mine' })
    writeLocalSettings(dir, { ...readLocalSettings(dir), keepKeys: false })
    await applyCloudSettings(dir)
    expect([...buildPresetFile({ dir, includeKeys: false, independent: false }).bundle.files.keys()]).toContain('preset-settings.json')
    // a copy made for someone else does not dictate their choices, nor say where this person keeps big files
    expect([...buildPresetFile({ dir, includeKeys: false, independent: true }).bundle.files.keys()]).not.toContain('preset-settings.json')
  })
})
