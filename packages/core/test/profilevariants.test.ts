import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { captureLive, initRepo, readBundleDir, planImport, exportBundle, repoStatus, type ObsInstall } from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-pv-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function machine(name: string, ini: string, stream: object) {
  const home = nodePath.join(tmp, name); const { cfg } = makeSource(home)
  fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Main/basic.ini'), ini)
  fs.writeFileSync(nodePath.join(cfg, 'basic/profiles/Main/streamEncoder.json'), JSON.stringify(stream))
  return { home, cfg }
}
const LINUX_INI = '[General]\nName=Main\n\n[AdvOut]\nEncoder=obs_nvenc_h264_tex\nRecAudioEncoder=ffmpeg_aac\nTrack1Bitrate=160\n\n[Audio]\nDesktopDevice1=alsa_output.pci-1\n'
const WIN_INI = '[General]\nName=Main\n\n[AdvOut]\nEncoder=h264_texture_amf\nRecAudioEncoder=ffmpeg_aac\nTrack1Bitrate=192\n\n[Audio]\nDesktopDevice1={0.0.0.00000000}.{abc}\n'

describe('each system keeps its own encoders and audio devices in one setup', () => {
  it('a Linux and a Windows computer saving into the same preset keep both, never fight, and each loads its own', async () => {
    const A = machine('a', LINUX_INI, { preset2: 'p5' })
    const B = machine('b', WIN_INI, { usage: 'quality' })
    const hA = host('linux', A.home), iA: ObsInstall = { ...install(A.cfg), id: 'linux-box' }
    const hB = host('win32', B.home), iB: ObsInstall = { ...install(B.cfg), id: 'win-box', platform: 'win32' }
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    await captureLive({ host: hA, install: iA, dir, name: 'Mine' })
    expect((await captureLive({ host: hB, install: iB, dir })).status).toBe('committed')

    const b = readBundleDir(dir)
    const canon = b.files.get('profiles/main/basic.ini')!.toString()
    expect(canon).toContain('Encoder=obs_nvenc_h264_tex') // the first saver's lines stay the profile's own
    expect(canon).toContain('Track1Bitrate=192') // everything that is not system-specific follows the latest save
    const variants = JSON.parse(b.files.get('profiles/main/platforms.json')!.toString())
    expect(variants.linux.ini.AdvOut.Encoder).toBe('obs_nvenc_h264_tex')
    expect(variants.win32.ini.AdvOut.Encoder).toBe('h264_texture_amf')
    expect(variants.win32.ini.Audio.DesktopDevice1).toContain('{0.0.0')
    expect(JSON.parse(variants.linux.files['streamEncoder.json'])).toEqual({ preset2: 'p5' })
    expect(JSON.parse(variants.win32.files['streamEncoder.json'])).toEqual({ usage: 'quality' })
    expect(JSON.parse(b.files.get('profiles/main/streamEncoder.json')!.toString())).toEqual({ preset2: 'p5' })

    // saving again with nothing changed changes nothing, on either computer
    expect((await captureLive({ host: hA, install: iA, dir })).status).toBe('unchanged')
    expect((await captureLive({ host: hB, install: iB, dir })).status).toBe('unchanged')
    expect((await repoStatus(dir)).dirtyFiles).toEqual([])

    // each computer loads its own, even though the profile file holds the other's lines
    const load = (plat: 'linux' | 'win32' | 'darwin') => {
      const home = nodePath.join(tmp, 'load-' + plat)
      const plan = planImport({ bundle: readBundleDir(dir), install: { ...install(nodePath.join(home, 'cfg')), platform: plat }, host: host(plat, home) })
      const get = (n: string) => plan.writes.find((w) => w.path.endsWith(n))?.data.toString()
      return { ini: get('basic.ini')!, enc: get('streamEncoder.json')!, platformsFile: plan.writes.some((w) => w.path.endsWith('platforms.json')) }
    }
    const w = load('win32'), l = load('linux')
    expect(w.ini).toContain('Encoder=h264_texture_amf'); expect(JSON.parse(w.enc)).toEqual({ usage: 'quality' })
    expect(w.ini).toContain('DesktopDevice1={0.0.0')
    expect(l.ini).toContain('Encoder=obs_nvenc_h264_tex'); expect(JSON.parse(l.enc)).toEqual({ preset2: 'p5' })
    expect(w.platformsFile || l.platformsFile).toBe(false) // never written into OBS's own folders
    // a system that never saved gets the profile's own lines, with anything that cannot exist there swapped
    const m = load('darwin')
    expect(m.ini).toContain('Encoder=obs_nvenc_h264_tex')
  })

  it('a file made from OBS carries this system\'s copy, and a file made from a preset carries all of them', async () => {
    const A = machine('a', LINUX_INI, { preset2: 'p5' })
    const hA = host('linux', A.home), iA = install(A.cfg)
    const file = exportBundle({ host: hA, install: iA, name: 'x' })
    expect(Object.keys(JSON.parse(file.files.get('profiles/main/platforms.json')!.toString()))).toEqual(['linux'])
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    await captureLive({ host: hA, install: iA, dir, name: 'Mine' })
    const B = machine('b', WIN_INI, { usage: 'quality' })
    await captureLive({ host: host('win32', B.home), install: { ...install(B.cfg), id: 'w', platform: 'win32' }, dir })
    const fromPreset = readBundleDir(dir) // what "save to a file" starts from
    expect(Object.keys(JSON.parse(fromPreset.files.get('profiles/main/platforms.json')!.toString())).sort()).toEqual(['linux', 'win32'])
  })
})
