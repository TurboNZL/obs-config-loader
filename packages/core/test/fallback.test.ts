import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { applyImport, exportBundle, fallbackFolder, planImport } from '../src/index.js'
import { fwd, host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-fb-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('a suggested folder from another computer', () => {
  it('goes inside the same kind of folder at home, or at home under its own name', () => {
    const f = { home: '/home/me', videos: '/home/me/Videos', music: '/home/me/Music' }
    expect(fallbackFolder('/mnt/TurboFILES/Videos/OBS', f, nodePath.posix)).toBe('/home/me/Videos/OBS')
    expect(fallbackFolder('D:\\Recordings\\OBS', f, nodePath.posix)).toBe('/home/me/OBS')
    expect(fallbackFolder('/media/x/music', f, nodePath.posix)).toBe('/home/me/Music')
  })

  it('is used on import when the suggestion cannot exist here, and a usable suggestion is left alone', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const prof = [...b.files.keys()].find((k) => /profiles\/[^/]+\/basic\.ini$/.test(k))!
    b.files.set(prof, Buffer.from(b.files.get(prof)!.toString() + '\n[X]\nA={{var:FAR}}\nB={{var:NEAR}}\n'))
    b.manifest.variables.push(
      { name: 'FAR', kind: 'path', default: '/mnt/TurboFILES/Videos/OBS' },        // a disk this computer does not have
      { name: 'NEAR', kind: 'path', default: '{{home}}/Recordings' },               // the home folder exists, so this folder can be made
    )
    const home2 = nodePath.join(tmp, 'home2'); const cfg2 = nodePath.join(home2, 'obs'); fs.mkdirSync(cfg2, { recursive: true })
    const plan = planImport({ bundle: b, install: install(cfg2), host: host('linux', home2) })
    applyImport(plan)
    const ini = fs.readFileSync(fs.readdirSync(nodePath.join(cfg2, 'basic/profiles')).map((d) => nodePath.join(cfg2, 'basic/profiles', d, 'basic.ini')).find((f) => fs.existsSync(f))!, 'utf8')
    expect(fwd(ini)).toContain(`A=${fwd(nodePath.join(home2, 'Videos', 'OBS'))}`)
    expect(fwd(ini)).toContain(`B=${fwd(nodePath.join(home2, 'Recordings'))}`)
    expect(plan.report.warnings.join(' ')).toMatch(/\/mnt\/TurboFILES\/Videos\/OBS does not exist on this computer/)
  })
})
