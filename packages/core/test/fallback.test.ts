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

import { isBlankDefault } from '../src/export.js'
describe('OBS starter layout', () => {
  it('is recognised when it is the empty Untitled layout only', () => {
    expect(isBlankDefault({ name: 'Untitled', sources: [{ id: 'scene', settings: { items: [] } }] })).toBe(true)
    expect(isBlankDefault({ name: 'Untitled', sources: [{ id: 'scene', settings: { items: [{ name: 'x' }] } }] })).toBe(false)
    expect(isBlankDefault({ name: 'Untitled', sources: [{ id: 'image_source' }] })).toBe(false)
    expect(isBlankDefault({ name: 'My layout', sources: [] })).toBe(false)
  })
})

import { planSetup } from '../src/index.js'
describe('{{obs}} in a setup step', () => {
  it('gives the portable folder of the linked OBS', () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obsstep-'))
    fs.writeFileSync(nodePath.join(dir, 'go.sh'), '#!/bin/sh\n')
    const m = { setup: { steps: [{ id: 'a', title: 'A', run: { linux: { program: '{{bundle}}/go.sh', args: ['--obs', '{{obs}}', '--kind', '{{obskind}}'] } } }] } } as never
    const base = { platform: 'linux' as const, home: '/h', presetDir: dir, folders: {} }
    const a = planSetup(m, { ...base, obs: { kind: 'portable', configDir: '/p/prismalite obs/config/obs-studio' } })[0]
    expect(a.command?.args).toEqual(['--obs', '/p/prismalite obs', '--kind', 'portable'])
    const b = planSetup(m, { ...base, obs: { kind: 'flatpak', configDir: '/x' } })[0]
    expect(b.command?.args).toEqual(['--obs', '', '--kind', 'installed'])
    expect(planSetup(m, base)[0].command?.args).toEqual(['--obs', '', '--kind', ''])
  })
})

describe('OBS starter profile', () => {
  it('is left out when it is empty and there are real profiles next to it', async () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'untp-'))
    const { host, install, makeSource } = await import('./helpers.js')
    const home = nodePath.join(dir, 'home'); const { cfg } = makeSource(home)
    const u = nodePath.join(cfg, 'basic/profiles/Untitled'); fs.mkdirSync(u, { recursive: true }); fs.writeFileSync(nodePath.join(u, 'basic.ini'), '[General]\nName=Untitled\n')
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    expect(b.manifest.profiles.map((p) => p.name)).not.toContain('Untitled')
    expect(b.manifest.profiles.length).toBeGreaterThan(0)
  })
})
