import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import JSZip from 'jszip'
import {
  exportBundle, planImport, applyImport, writeBundleZip, readBundleZip, writeBundleDir, parseManifest, SECRETS_README_NAME, SECRETS_WARNING,
  BundleError,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-keys-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function fixture() {
  const home = nodePath.join(tmp, 'home')
  const { cfg, big } = makeSource(home)
  return { home, cfg, big, h: host('linux', home), inst: install(cfg) }
}
const allBytes = async (b: Awaited<ReturnType<typeof exportBundle>>) => (await writeBundleZip(b)).toString('latin1')

describe('stream keys are left out unless asked for', () => {
  it('by default no key is anywhere in the file, and nothing says it carries keys', async () => {
    const f = fixture()
    const b = exportBundle({ host: f.h, install: f.inst, name: 'Plain' })
    const zip = await JSZip.loadAsync(await writeBundleZip(b))
    for (const name of Object.keys(zip.files)) {
      const text = await zip.files[name].async('string')
      expect(text).not.toContain('live_SECRET123'); expect(text).not.toContain('yt-SECRET456')
    }
    expect(b.manifest.containsSecrets).toBeUndefined()
    expect(b.manifest.warning).toBeUndefined()
    expect(b.manifest.variables.every((v) => v.value === undefined)).toBe(true)
    expect(Object.keys(zip.files)).not.toContain(SECRETS_README_NAME)
  })

  it('every secret gets a label a person can recognise', () => {
    const f = fixture()
    const labels = exportBundle({ host: f.h, install: f.inst, name: 'x' }).manifest.variables.filter((v) => v.kind === 'secret').map((v) => v.label)
    expect(labels).toEqual(['Stream key for Twitch', 'Multiple RTMP outputs: “YT”'])
  })
})

describe('including the keys', () => {
  it('labels the file everywhere: manifest, a README inside the zip, and the values only in the variables', async () => {
    const f = fixture()
    const b = exportBundle({ host: f.h, install: f.inst, name: 'With keys', includeSecrets: true })
    expect(b.manifest).toMatchObject({ containsSecrets: true, warning: SECRETS_WARNING })
    const byLabel = Object.fromEntries(b.manifest.variables.filter((v) => v.kind === 'secret').map((v) => [v.label, v.value]))
    expect(byLabel).toEqual({ 'Stream key for Twitch': 'live_SECRET123', 'Multiple RTMP outputs: “YT”': 'yt-SECRET456' })
    // the keys are NOT left lying in the scene or profile files: only the variables hold them
    for (const [name, data] of b.files) {
      if (name === SECRETS_README_NAME) continue
      expect(data.toString('utf8'), name).not.toContain('live_SECRET123')
    }
    const zip = await JSZip.loadAsync(await writeBundleZip(b))
    expect(Object.keys(zip.files)).toContain(SECRETS_README_NAME)
    expect(await zip.files[SECRETS_README_NAME].async('string')).toMatch(/^WARNING: THIS FILE CONTAINS STREAM KEYS/)
    const back = await readBundleZip(await writeBundleZip(b))
    expect(back.manifest.containsSecrets).toBe(true)
    expect(back.manifest.variables.find((v) => v.name === 'STREAM_KEY')?.value).toBe('live_SECRET123')
  })

  it('asking for keys when there are none does not mislabel the file', () => {
    const f = fixture()
    fs.rmSync(nodePath.join(f.cfg, 'basic/profiles/Main/service.json')); fs.rmSync(nodePath.join(f.cfg, 'basic/profiles/Main/obs-multi-rtmp.json'))
    const b = exportBundle({ host: f.h, install: f.inst, name: 'No keys', includeSecrets: true })
    expect(b.manifest.containsSecrets).toBeUndefined()
  })

  it('can never be written into a folder for git', () => {
    const f = fixture()
    const b = exportBundle({ host: f.h, install: f.inst, name: 'x', includeSecrets: true })
    expect(() => writeBundleDir(b, nodePath.join(tmp, 'repo'))).toThrow(BundleError)
    expect(() => writeBundleDir(b, nodePath.join(tmp, 'repo2'))).toThrow(/only be saved as a single file/)
    expect(fs.existsSync(nodePath.join(tmp, 'repo2/manifest.json'))).toBe(false)
  })

  it('a stray secret value in a file that does not declare itself is ignored, not used', () => {
    const m = parseManifest({ format: 'obs-config-bundle', version: 1, id: 'a', name: 'n', variables: [{ name: 'STREAM_KEY', kind: 'secret', value: 'sneaky' }] })
    expect(m.variables[0].value).toBeUndefined()
    const ok = parseManifest({ format: 'obs-config-bundle', version: 1, id: 'a', name: 'n', containsSecrets: true, variables: [{ name: 'STREAM_KEY', kind: 'secret', value: 'fine' }] })
    expect(ok.variables[0].value).toBe('fine')
  })
})

describe('loading a file that carries keys', () => {
  async function bundleWithKeys() {
    const f = fixture()
    const b = exportBundle({ host: f.h, install: f.inst, name: 'K', includeSecrets: true })
    return { f, bundle: await readBundleZip(await writeBundleZip(b)) }
  }
  const target = (name: string) => {
    const home = nodePath.join(tmp, name)
    return { home, cfg: nodePath.join(home, '.config/obs-studio'), prof: nodePath.join(home, '.config/obs-studio/basic/profiles/Main') }
  }

  it('uses the keys from the file with nothing typed, and says so', async () => {
    const { f, bundle } = await bundleWithKeys()
    const t = target('t1')
    const plan = planImport({ bundle, install: install(t.cfg), host: host('linux', t.home), assetFiles: { mix: f.big } })
    expect(plan.report).toMatchObject({ containsSecrets: true, missingVariables: [] })
    expect(plan.report.includedSecrets.sort()).toEqual(bundle.manifest.variables.filter((v) => v.kind === 'secret').map((v) => v.name).sort())
    applyImport(plan)
    expect(JSON.parse(fs.readFileSync(nodePath.join(t.prof, 'service.json'), 'utf8')).settings.key).toBe('live_SECRET123')
    expect(JSON.parse(fs.readFileSync(nodePath.join(t.prof, 'obs-multi-rtmp.json'), 'utf8')).targets[0]['service-param'].key).toBe('yt-SECRET456')
  })

  it('what you type beats the file, and the file beats what OBS already has', async () => {
    const { f, bundle } = await bundleWithKeys()
    const t = target('t2')
    fs.mkdirSync(t.prof, { recursive: true })
    fs.writeFileSync(nodePath.join(t.prof, 'service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_OLD' } }))
    const plan = planImport({ bundle, install: install(t.cfg), host: host('linux', t.home), assetFiles: { mix: f.big }, variables: { STREAM_KEY: 'live_TYPED' } })
    applyImport(plan)
    expect(JSON.parse(fs.readFileSync(nodePath.join(t.prof, 'service.json'), 'utf8')).settings.key).toBe('live_TYPED')
    const other = bundle.manifest.variables.find((v) => v.kind === 'secret' && v.name !== 'STREAM_KEY')!.name
    expect(plan.report.includedSecrets).toEqual([other]) // only the one that really came from the file
    const t3 = target('t3')
    fs.mkdirSync(t3.prof, { recursive: true })
    fs.writeFileSync(nodePath.join(t3.prof, 'service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_OLD' } }))
    applyImport(planImport({ bundle, install: install(t3.cfg), host: host('linux', t3.home), assetFiles: { mix: f.big } }))
    expect(JSON.parse(fs.readFileSync(nodePath.join(t3.prof, 'service.json'), 'utf8')).settings.key).toBe('live_SECRET123')
  })

  it('a file without keys still never blanks the key OBS has', async () => {
    const f = fixture()
    const bundle = await readBundleZip(await writeBundleZip(exportBundle({ host: f.h, install: f.inst, name: 'P' })))
    const t = target('t4')
    fs.mkdirSync(t.prof, { recursive: true })
    fs.writeFileSync(nodePath.join(t.prof, 'service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', key: 'live_KEEP' } }))
    const plan = planImport({ bundle, install: install(t.cfg), host: host('linux', t.home), assetFiles: { mix: f.big } })
    expect(plan.report).toMatchObject({ containsSecrets: false, includedSecrets: [] })
    applyImport(plan)
    expect(JSON.parse(fs.readFileSync(nodePath.join(t.prof, 'service.json'), 'utf8')).settings.key).toBe('live_KEEP')
  })
})
