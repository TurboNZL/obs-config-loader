import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import JSZip from 'jszip'
import { compareVersions, updatePlan, updatePortableObs } from '../src/index.js'

describe('OBS updates', () => {
  it('compares versions', () => {
    expect(compareVersions('32.0.1', '32.1')).toBe(-1)
    expect(compareVersions('v33.0.0', '33')).toBe(0)
    expect(compareVersions('33.0.1', '32.9.9')).toBe(1)
  })
  it('has a way for each kind of OBS that needs no terminal', () => {
    expect(updatePlan('flatpak').command?.program).toBe('flatpak')
    expect(updatePlan('windows-portable').method).toBe('portable-zip')
    expect(updatePlan('linux-portable').method).toBe('manual')
  })
  it('replaces the program files of a portable OBS and leaves its settings alone', async () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obsup-'))
    fs.mkdirSync(nodePath.join(root, 'bin/64bit'), { recursive: true }); fs.writeFileSync(nodePath.join(root, 'bin/64bit/obs64.exe'), 'OLD')
    fs.mkdirSync(nodePath.join(root, 'config/obs-studio'), { recursive: true }); fs.writeFileSync(nodePath.join(root, 'config/obs-studio/user.ini'), 'mine')
    fs.mkdirSync(nodePath.join(root, 'obs-plugins/64bit'), { recursive: true }); fs.writeFileSync(nodePath.join(root, 'obs-plugins/64bit/third-party.dll'), 'keep')
    const z = new JSZip(); z.file('bin/64bit/obs64.exe', 'NEW'); z.file('data/a.txt', 'a')
    const buf = Buffer.from(await z.generateAsync({ type: 'nodebuffer' }))
    const f = (async (url: string) => String(url).includes('api.github.com')
      ? new Response(JSON.stringify({ tag_name: '99.0', assets: [{ name: 'OBS-Studio-99.0-Windows-x64.zip', size: buf.length, browser_download_url: 'https://x/z', digest: 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex') }] }))
      : new Response(new Uint8Array(buf), { headers: { 'content-length': String(buf.length) } })) as unknown as typeof fetch
    expect(await updatePortableObs(root, () => {}, f)).toBe('99.0')
    expect(fs.readFileSync(nodePath.join(root, 'bin/64bit/obs64.exe'), 'utf8')).toBe('NEW')
    expect(fs.readFileSync(nodePath.join(root, 'config/obs-studio/user.ini'), 'utf8')).toBe('mine')
    expect(fs.readFileSync(nodePath.join(root, 'obs-plugins/64bit/third-party.dll'), 'utf8')).toBe('keep')
    fs.rmSync(root, { recursive: true, force: true })
  })
})
