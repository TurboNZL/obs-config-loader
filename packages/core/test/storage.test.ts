import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as http from 'node:http'
import * as crypto from 'node:crypto'
import * as nodePath from 'node:path'
import { signV4, objectKey, putFile, getFile, hasObject, testStorage, validateTarget, regionFromEndpoint, sha256OfFile, StorageError, type StorageTarget } from '../src/index.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-st-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('AWS Signature V4', () => {
  it('matches the published example (GET Object with a Range header)', () => {
    const h = signV4({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
      headers: { Range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      keys: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }, now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(h.Authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })
})

describe('target checks', () => {
  it('asks for what is missing, and reads a Backblaze region from its address', () => {
    expect(validateTarget({})).toMatch(/address/)
    expect(validateTarget({ endpoint: 's3.us-west-004.backblazeb2.com', bucket: 'ab' })).toMatch(/bucket/)
    expect(validateTarget({ endpoint: 's3.us-west-004.backblazeb2.com', bucket: 'my-obs-files' })).toBeNull()
    expect(validateTarget({ endpoint: 'abc.r2.cloudflarestorage.com', bucket: 'my-obs-files' })).toMatch(/region/)
    expect(regionFromEndpoint('https://s3.eu-central-003.backblazeb2.com')).toBe('eu-central-003')
  })
  it('keeps a file under its fingerprint, with a plain name after it', () => {
    expect(objectKey({ endpoint: 'x', region: 'r', bucket: 'bbb' }, 'abc123', 'My Video (final).mp4')).toBe('obs-config-loader/abc123/My_Video_final_.mp4')
  })
})

/** A tiny S3 stand-in that checks the request is signed with the keys it expects, and the payload hash is true. */
function fakeS3(keys: { id: string; secret: string }, bucket: string) {
  const store = new Map<string, Buffer>()
  let corrupt = false
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const host = req.headers.host!
      const given = String(req.headers.authorization)
      const claimed = String(req.headers['x-amz-content-sha256'])
      const sent: Record<string, string> = {}
      for (const n of /SignedHeaders=([^,]+)/.exec(given)![1].split(';')) if (n !== 'host' && n !== 'x-amz-content-sha256' && n !== 'x-amz-date') sent[n] = String(req.headers[n])
      const expect_ = signV4({ method: req.method!, host, path: req.url!.split('?')[0], region: 'test-1', headers: sent, payloadHash: claimed, keys: { accessKeyId: keys.id, secretAccessKey: keys.secret }, now: parseDate(String(req.headers['x-amz-date'])) })
      const fail = (s: number, code: string) => { res.statusCode = s; res.end(`<Error><Code>${code}</Code><Message>no</Message></Error>`) }
      if (expect_.Authorization !== given) return fail(403, 'SignatureDoesNotMatch')
      if (body.length && crypto.createHash('sha256').update(body).digest('hex') !== claimed) return fail(400, 'XAmzContentSHA256Mismatch')
      const m = /^\/([^/]+)(?:\/(.+))?$/.exec(req.url!)!
      if (m[1] !== bucket) return fail(404, 'NoSuchBucket')
      const key = m[2] ? decodeURIComponent(m[2]) : ''
      if (!key) { res.statusCode = 200; return res.end() }
      if (req.method === 'PUT') { store.set(key, body); res.statusCode = 200; return res.end() }
      if (req.method === 'DELETE') { store.delete(key); res.statusCode = 204; return res.end() }
      const v = store.get(key)
      if (!v) return fail(404, 'NoSuchKey')
      res.setHeader('content-length', v.length); res.statusCode = 200
      if (req.method === 'HEAD') return res.end()
      res.end(corrupt ? Buffer.from(v.toString().toUpperCase()) : v)
    })
  })
  return { server, store, corrupt: (on: boolean) => { corrupt = on } }
}
const parseDate = (a: string) => new Date(`${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}T${a.slice(9, 11)}:${a.slice(11, 13)}:${a.slice(13, 15)}Z`)

describe('keeping a big file in storage and getting it back', () => {
  const keys = { accessKeyId: 'KEYID', secretAccessKey: 'SECRET/secret' }
  let s: ReturnType<typeof fakeS3>; let t: StorageTarget
  beforeEach(async () => {
    s = fakeS3({ id: 'KEYID', secret: 'SECRET/secret' }, 'my-obs-files')
    await new Promise<void>((r) => s.server.listen(0, '127.0.0.1', r))
    t = { endpoint: `http://127.0.0.1:${(s.server.address() as { port: number }).port}`, region: 'test-1', bucket: 'my-obs-files' }
  })
  afterEach(() => { s.server.close() })

  it('uploads once, skips what is already there, and downloads with the fingerprint checked', async () => {
    const f = nodePath.join(tmp, 'intro video.mp4'); fs.writeFileSync(f, crypto.randomBytes(300_000))
    const sha = await sha256OfFile(f); const key = objectKey(t, sha, 'intro video.mp4')
    expect(await putFile(t, keys, key, f, sha)).toBe('uploaded')
    expect(await putFile(t, keys, key, f, sha)).toBe('already-there')
    expect(await hasObject(t, keys, key, fs.statSync(f).size)).toBe(true)
    const dest = nodePath.join(tmp, 'got', 'intro video.mp4')
    await getFile(t, keys, key, dest, sha)
    expect(fs.readFileSync(dest).equals(fs.readFileSync(f))).toBe(true)
    expect(fs.readdirSync(nodePath.dirname(dest))).toEqual(['intro video.mp4']) // no leftover .part file
  })

  it('throws away a download that is not the file that was uploaded', async () => {
    const f = nodePath.join(tmp, 'a.txt'); fs.writeFileSync(f, 'hello world, some text')
    const sha = await sha256OfFile(f); const key = objectKey(t, sha, 'a.txt')
    await putFile(t, keys, key, f, sha)
    s.corrupt(true)
    const dest = nodePath.join(tmp, 'out', 'a.txt')
    await expect(getFile(t, keys, key, dest, sha)).rejects.toThrow(/fingerprint/)
    expect(fs.existsSync(dest)).toBe(false); expect(fs.existsSync(dest + '.part')).toBe(false)
  })

  it('says plainly what is wrong: wrong keys, wrong bucket', async () => {
    const bad = await testStorage(t, { accessKeyId: 'KEYID', secretAccessKey: 'nope' })
    expect(bad).toMatchObject({ ok: false }); expect((bad as { message: string }).message).toMatch(/did not accept those keys/)
    const nobucket = await testStorage({ ...t, bucket: 'other-bucket' }, keys)
    expect((nobucket as { message: string }).message).toMatch(/bucket/)
    expect(await testStorage(t, keys)).toEqual({ ok: true })
    expect([...s.store.keys()]).toEqual([]) // the test file was removed again
    const z = nodePath.join(tmp, 'zzz'); fs.writeFileSync(z, 'z')
    await expect(putFile(t, { ...keys, secretAccessKey: 'x' }, 'k', z, 'z')).rejects.toBeInstanceOf(StorageError)
  })

  it('reports an unreachable address in plain words', async () => {
    const r = await testStorage({ endpoint: 'http://127.0.0.1:1', region: 'x', bucket: 'my-obs-files' }, keys)
    expect((r as { message: string }).message).toMatch(/Could not reach the storage/)
  })
})

import { decodePairCode, encodePairCode } from '../src/storage.js'
describe('storage pairing code', () => {
  const t = { endpoint: 's3.us-west-004.backblazeb2.com', region: 'us-west-004', bucket: 'my-bucket', prefix: 'obs-config-loader/' } as never
  const k = { accessKeyId: 'AK', secretAccessKey: 'SECRET' }
  it('round trips, even with words and line breaks around it', () => {
    const code = encodePairCode(t, k)
    expect(decodePairCode(`here you go:\n${code.slice(0, 20)}\n${code.slice(20)} thanks!`)).toEqual({ target: t, keys: k })
  })
  it('refuses junk and damage in plain words', () => {
    expect(() => decodePairCode('hello')).toThrow(/not a storage pairing code/)
    expect(() => decodePairCode('OBSSTORE1:abcd.')).toThrow(/damaged/)
  })
})
