import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import JSZip from 'jszip'
import { freshFolder, installPortableObs, extractZipSafe, AUTO_SUFFIX } from '../src/index.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obsinst-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

async function fakeObs(extra: Record<string, string> = {}) {
  const z = new JSZip()
  z.file('bin/64bit/obs64.exe', 'MZ'); z.file('data/x.txt', 'x')
  for (const [k, v] of Object.entries(extra)) z.file(k, v)
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }))
}
const fakeFetch = (zip: Buffer, digest?: string) => (async (url: string) => {
  if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ tag_name: '32.9', assets: [{ name: 'OBS-Studio-32.9-Windows-x64.zip', size: zip.length, browser_download_url: 'https://x/zip', digest: digest ?? 'sha256:' + crypto.createHash('sha256').update(zip).digest('hex') }, { name: 'OBS-Studio-32.9-Windows-x64-PDBs.zip', size: 1, browser_download_url: 'https://x/pdb' }] }), { status: 200 })
  return new Response(new Uint8Array(zip), { status: 200, headers: { 'content-length': String(zip.length) } })
}) as unknown as typeof fetch

describe('installing a portable OBS', () => {
  it('picks a folder name that is free, and never one that exists', () => {
    const exists = (p: string) => ['OBS Studio', 'OBS Studio' + AUTO_SUFFIX].some((n) => p.endsWith(n))
    expect(nodePath.basename(freshFolder('/d', 'OBS Studio', exists))).toBe('OBS Studio' + AUTO_SUFFIX + ' 2')
    expect(nodePath.basename(freshFolder('/d', 'Other', () => false))).toBe('Other')
  })
  it('downloads, checks, unpacks and switches portable mode on, leaving an existing folder alone', async () => {
    fs.mkdirSync(nodePath.join(tmp, 'OBS Studio')); fs.writeFileSync(nodePath.join(tmp, 'OBS Studio/mine.txt'), 'keep')
    const steps: string[] = []
    const r = await installPortableObs({ parent: tmp, fetchImpl: fakeFetch(await fakeObs()), onProgress: (p) => steps.push(p.phase) })
    expect(r.root).toContain(AUTO_SUFFIX)
    expect(fs.existsSync(nodePath.join(r.root, 'bin/64bit/obs64.exe'))).toBe(true)
    expect(fs.existsSync(nodePath.join(r.root, 'portable_mode.txt'))).toBe(true)
    expect(fs.readFileSync(nodePath.join(tmp, 'OBS Studio/mine.txt'), 'utf8')).toBe('keep')
    expect(steps).toEqual(expect.arrayContaining(['looking', 'downloading', 'checking', 'unpacking', 'done']))
    expect(fs.existsSync(nodePath.join(tmp, '.obs-download/OBS-Studio-32.9-Windows-x64.zip'))).toBe(false)
  })
  it('throws away a download that does not match its fingerprint, and leaves no folder behind', async () => {
    const before = fs.readdirSync(tmp)
    await expect(installPortableObs({ parent: tmp, fetchImpl: fakeFetch(await fakeObs(), 'sha256:' + '0'.repeat(64)) })).rejects.toThrow(/fingerprint/)
    expect(fs.readdirSync(tmp).filter((n) => !n.startsWith('.'))).toEqual(before.filter((n) => !n.startsWith('.')))
  })
  it('refuses a zip that would write outside its folder', async () => {
    const z = new JSZip(); z.file('../evil.txt', 'x')
    const f = nodePath.join(tmp, 'e.zip'); fs.writeFileSync(f, await z.generateAsync({ type: 'nodebuffer' }))
    await expect(extractZipSafe(f, nodePath.join(tmp, 'out'))).rejects.toThrow(/outside/)
  })
})
