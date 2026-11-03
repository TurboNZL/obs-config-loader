import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { exportBundle, planImport, applyImport, readBundleDir, captureLive, initRepo, renameOutputSetting, renameSceneLayout, type Bundle } from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-proj-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

/** A script that finds the files around it (like many real OBS tools do), with its own images and a pipe it manages. */
function projectSetup() {
  const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
  const proj = nodePath.join(home, 'my-stream-tool')
  fs.mkdirSync(nodePath.join(proj, 'images'), { recursive: true })
  fs.writeFileSync(nodePath.join(proj, 'tool.py'), 'import os\nHERE = os.path.dirname(os.path.abspath(__file__))\nHELPER = os.path.join(HERE, "helper.py")\n')
  fs.writeFileSync(nodePath.join(proj, 'helper.py'), 'x = 1\n')
  fs.writeFileSync(nodePath.join(proj, 'images', 'bg.png'), 'PNG')
  const f = nodePath.join(cfg, 'basic/scenes/Main.json')
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  j.modules = { 'scripts-tool': [{ path: nodePath.join(proj, 'tool.py'), settings: { status: 'Stopped' } }], 'output-timer': { streamTimerSeconds: 30 } }
  j.sources.push({ id: 'image_source', name: 'Background', uuid: 'u-bg', settings: { file: nodePath.join(proj, 'images', 'bg.png') } })
  j.sources.push({ id: 'ffmpeg_source', name: 'Pipe', uuid: 'u-pipe', settings: { input: nodePath.join(proj, 'audio.fifo'), local_file: nodePath.join(proj, 'audio.fifo'), is_local_file: false } })
  fs.writeFileSync(f, JSON.stringify(j))
  return { home, cfg, proj, scenes: f }
}

describe('a script that needs the files around it', () => {
  it('is not copied away from them: the folder becomes one question, and everything inside stays relative to it', () => {
    const { home, cfg, proj } = projectSetup()
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    expect(b.manifest.assets.some((a) => a.role === 'script' || a.filename === 'bg.png')).toBe(false)
    const v = b.manifest.variables.find((x) => x.name === 'SCRIPT_FOLDER')!
    expect(v).toMatchObject({ kind: 'path', default: '{{home}}/my-stream-tool', mustContain: ['tool.py'] })
    expect(v.label).toContain('tool.py')
    const col = b.files.get('collections/main.json')!.toString()
    expect(col).toContain('{{var:SCRIPT_FOLDER}}/tool.py')
    expect(col).toContain('{{var:SCRIPT_FOLDER}}/images/bg.png')
    expect(col).toContain('{{var:SCRIPT_FOLDER}}/audio.fifo')
    expect(col).not.toContain(proj)

    // another computer where the folder is somewhere else: everything follows it, and nothing else changed
    const home2 = nodePath.join(tmp, 'home2'); const cfg2 = nodePath.join(home2, '.config/obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    const where = nodePath.join(home2, 'tools', 'stream')
    fs.mkdirSync(where, { recursive: true }); fs.writeFileSync(nodePath.join(where, 'tool.py'), '')
    const plan = planImport({ bundle: b, install: install(cfg2), host: host('linux', home2), variables: { SCRIPT_FOLDER: where } })
    expect(plan.report.warnings.join(' ')).not.toMatch(/was not found/)
    applyImport(plan)
    const got = JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'basic/scenes/Main.json'), 'utf8'))
    expect(got.modules['scripts-tool'][0].path).toBe(nodePath.join(where, 'tool.py'))
    expect(got.sources.find((s: any) => s.name === 'Background').settings.file).toBe(nodePath.join(where, 'images/bg.png'))
    expect(got.sources.find((s: any) => s.name === 'Pipe').settings.input).toBe(nodePath.join(where, 'audio.fifo'))
    expect(got.modules['output-timer']).toEqual({ streamTimerSeconds: 30 })
  })

  it('keeps the script and the code files beside it with the setup, and puts them back in a new or empty folder', () => {
    const { home, cfg } = projectSetup()
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    expect(b.manifest.projects).toEqual([{ variable: 'SCRIPT_FOLDER', files: ['helper.py', 'tool.py'] }]) // images are not code: not kept
    expect(b.files.get('scripts/projects/SCRIPT_FOLDER/tool.py')!.toString()).toContain('__file__')
    expect([...b.files.keys()].some((k) => k.endsWith('bg.png'))).toBe(false)

    const plan = planImport({ bundle: b, install: { ...install('C:\\cfg'), platform: 'win32' }, host: host('win32', 'C:\\Users\\u'), variables: { SCRIPT_FOLDER: 'C:\\Tools\\stream' } })
    expect(plan.report.warnings.join(' ')).not.toMatch(/was not found/) // it comes with the setup
    expect(plan.writes.filter((w) => w.kind === 'project').map((w) => w.path).sort()).toEqual(['C:\\Tools\\stream\\helper.py', 'C:\\Tools\\stream\\tool.py'])
    const col = JSON.parse(plan.writes.find((w) => w.kind === 'collection')!.data.toString())
    expect(col.modules['scripts-tool'][0].path).toBe('C:\\Tools\\stream\\tool.py')
    expect(col.sources.find((s: any) => s.name === 'Background').settings.file).toBe('C:\\Tools\\stream\\images\\bg.png')
  })

  it('never drops code into a folder that belongs to something else, and leaves identical files alone', () => {
    const { home, cfg, proj } = projectSetup()
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const other = nodePath.join(tmp, 'startup'); fs.mkdirSync(other); fs.writeFileSync(nodePath.join(other, 'something.txt'), 'mine')
    const home2 = nodePath.join(tmp, 'home2'); const cfg2 = nodePath.join(home2, '.config/obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    const blocked = planImport({ bundle: b, install: install(cfg2), host: host('linux', home2), variables: { SCRIPT_FOLDER: other } })
    expect(blocked.writes.some((w) => w.kind === 'project')).toBe(false)
    expect(blocked.report.warnings.join(' ')).toMatch(/already has other things in it/)
    // the real project folder: nothing to write when it already matches
    const same = planImport({ bundle: b, install: install(cfg2), host: host('linux', home2), variables: { SCRIPT_FOLDER: proj } })
    expect(same.writes.some((w) => w.kind === 'project')).toBe(false)
    // a changed copy is replaced, and the old one is backed up
    fs.writeFileSync(nodePath.join(proj, 'helper.py'), 'x = 2\n')
    const changed = planImport({ bundle: b, install: install(cfg2), host: host('linux', home2), variables: { SCRIPT_FOLDER: proj } })
    expect(changed.writes.filter((w) => w.kind === 'project').map((w) => [nodePath.basename(w.path), w.action])).toEqual([['helper.py', 'replace']])
    // a bundle cannot reach outside the folder or write something that is not code
    const evil: Bundle = { manifest: { ...b.manifest, projects: [{ variable: 'SCRIPT_FOLDER', files: ['../x.py', 'a.exe', '.hidden.py'] }] }, files: new Map(b.files) }
    for (const f of ['../x.py', 'a.exe', '.hidden.py']) evil.files.set(`scripts/projects/SCRIPT_FOLDER/${f}`, Buffer.from('x'))
    const none = planImport({ bundle: evil, install: install(cfg2), host: host('linux', home2), variables: { SCRIPT_FOLDER: nodePath.join(tmp, 'fresh') } })
    expect(none.writes.some((w) => w.kind === 'project')).toBe(false)
  })

  it('a script that stands alone is still copied with the setup (nothing else to lose)', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const py = nodePath.join(home, 'solo', 'solo.py'); fs.mkdirSync(nodePath.dirname(py), { recursive: true }); fs.writeFileSync(py, 'import os\nprint(os.path.dirname(__file__))\n')
    const f = nodePath.join(cfg, 'basic/scenes/Main.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.modules = { 'scripts-tool': [{ path: py }] }; fs.writeFileSync(f, JSON.stringify(j))
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    expect(b.manifest.variables.some((v) => v.name.startsWith('SCRIPT_FOLDER'))).toBe(false)
    expect(b.manifest.assets.find((a) => a.role === 'script')).toBeTruthy()
  })

  it('the suggested folder is the first saver\'s, so two computers never rewrite it back and forth', async () => {
    const A = projectSetup()
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    await captureLive({ host: host('linux', A.home), install: install(A.cfg), dir, name: 'Mine' })
    const first = readBundleDir(dir).manifest.variables.find((v) => v.name === 'SCRIPT_FOLDER')!.default
    // another computer keeps the same tool somewhere else
    const home2 = nodePath.join(tmp, 'other'); const { cfg: cfg2 } = makeSource(home2)
    const proj2 = nodePath.join(home2, 'elsewhere', 'tool'); fs.mkdirSync(proj2, { recursive: true })
    fs.writeFileSync(nodePath.join(proj2, 'tool.py'), 'import os\nos.path.dirname(__file__)\n'); fs.writeFileSync(nodePath.join(proj2, 'other.py'), '')
    const f2 = nodePath.join(cfg2, 'basic/scenes/Main.json'); const j2 = JSON.parse(fs.readFileSync(f2, 'utf8')); j2.modules = { 'scripts-tool': [{ path: nodePath.join(proj2, 'tool.py') }] }; fs.writeFileSync(f2, JSON.stringify(j2))
    await captureLive({ host: host('linux', home2), install: { ...install(cfg2), id: 'b' }, dir })
    expect(readBundleDir(dir).manifest.variables.find((v) => v.name === 'SCRIPT_FOLDER')!.default).toBe(first)
  })
})

describe('OBS file and folder names that differ from the shown name', () => {
  it('are put back exactly, because other tools may look for them', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.renameSync(nodePath.join(cfg, 'basic/profiles/Main'), nodePath.join(cfg, 'basic/profiles/Tool_Profile'))
    fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Tool_Profile/basic.ini'), '[General]\nName=Tool_Profile_2026_sep_22\n')
    fs.renameSync(nodePath.join(cfg, 'basic/scenes/Main.json'), nodePath.join(cfg, 'basic/scenes/Tool_Scenes.json'))
    const sc = nodePath.join(cfg, 'basic/scenes/Tool_Scenes.json'); const j = JSON.parse(fs.readFileSync(sc, 'utf8')); j.name = 'Shown name'; fs.writeFileSync(sc, JSON.stringify(j))
    fs.writeFileSync(nodePath.join(cfg, 'user.ini'), '[Basic]\nProfile=Tool_Profile_2026_sep_22\nProfileDir=Tool_Profile\nSceneCollection=Shown name\nSceneCollectionFile=Tool_Scenes\n')
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    expect(b.manifest.profiles[0]).toMatchObject({ name: 'Tool_Profile_2026_sep_22', dirName: 'Tool_Profile' })
    expect(b.manifest.collections[0]).toMatchObject({ name: 'Shown name', fileName: 'Tool_Scenes' })
    const cfg2 = nodePath.join(tmp, 'there', 'obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    applyImport(planImport({ bundle: b, install: install(cfg2), host: host('linux', home), activate: true }))
    expect(fs.existsSync(nodePath.join(cfg2, 'basic/profiles/Tool_Profile/basic.ini'))).toBe(true)
    expect(fs.existsSync(nodePath.join(cfg2, 'basic/scenes/Tool_Scenes.json'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(nodePath.join(cfg2, 'basic/scenes/Tool_Scenes.json'), 'utf8')).name).toBe('Shown name')
    expect(fs.readFileSync(nodePath.join(cfg2, 'user.ini'), 'utf8')).toMatch(/ProfileDir=Tool_Profile\b/)
    expect(fs.readFileSync(nodePath.join(cfg2, 'user.ini'), 'utf8')).toMatch(/SceneCollectionFile=Tool_Scenes\b/)
    // "keep both" never overwrites, and renaming makes OBS's own name the new name
    const both = planImport({ bundle: b, install: install(cfg2), host: host('linux', home), conflict: 'keep-both' })
    expect(both.writes.some((w) => w.path.endsWith(nodePath.join('Tool_Profile_2026_sep_22 (2)', 'basic.ini')))).toBe(true)
  })

  it('renaming in a preset gives OBS\'s own naming back', async () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.renameSync(nodePath.join(cfg, 'basic/profiles/Main'), nodePath.join(cfg, 'basic/profiles/Odd_Dir'))
    fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Odd_Dir/basic.ini'), '[General]\nName=Pretty\n')
    fs.writeFileSync(nodePath.join(cfg, 'user.ini'), '[Basic]\nProfile=Pretty\nProfileDir=Odd_Dir\nSceneCollection=Main\nSceneCollectionFile=Main\n')
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    await captureLive({ host: host('linux', home), install: install(cfg), dir, name: 'Mine' })
    const id = readBundleDir(dir).manifest.profiles[0].id
    renameOutputSetting(dir, id, 'Renamed')
    const p = readBundleDir(dir).manifest.profiles[0]
    expect(p.name).toBe('Renamed'); expect(p.dirName).toBeUndefined()
    void renameSceneLayout
  })
})

describe('remote-control password', () => {
  it('is not written back empty (that would lock every program out)', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    fs.mkdirSync(nodePath.join(cfg, 'plugin_config/obs-websocket'), { recursive: true })
    fs.writeFileSync(nodePath.join(cfg, 'plugin_config/obs-websocket/config.json'), JSON.stringify({ server_port: 4455, auth_required: true, server_password: 'pw' }))
    const b: Bundle = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const cfg2 = nodePath.join(tmp, 'there', 'obs-studio'); fs.mkdirSync(cfg2, { recursive: true })
    const none = planImport({ bundle: b, install: install(cfg2), host: host('linux', home) })
    expect(none.writes.some((w) => w.kind === 'websocket')).toBe(false)
    expect(none.report.warnings.join(' ')).toMatch(/remote-control settings.*not put back.*password/)
    const typed = planImport({ bundle: b, install: install(cfg2), host: host('linux', home), variables: { OBS_WEBSOCKET_SERVER_PASSWORD: 'typed' } })
    expect(typed.writes.some((w) => w.kind === 'websocket')).toBe(true)
  })
})
