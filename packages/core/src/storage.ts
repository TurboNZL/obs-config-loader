import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as http from 'node:http'
import * as https from 'node:https'
import type { StorageTarget } from './local.js'

/**
 * Big-file storage: any S3-compatible bucket (Backblaze B2, Cloudflare R2, Wasabi, MinIO, Amazon S3). Files are kept by their
 * content hash, so the same file is only ever uploaded once and a download can be checked. Signed with AWS Signature V4,
 * written out here so the app needs no extra library. Access keys are passed in and never stored by this module.
 */
export interface StorageKeys { accessKeyId: string; secretAccessKey: string }

export class StorageError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}

const sha256Hex = (d: string | Buffer) => crypto.createHash('sha256').update(d).digest('hex')
const hmac = (k: string | Buffer, d: string) => crypto.createHmac('sha256', k).update(d).digest()
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export interface SignInput {
  method: string; host: string; path: string; query?: Record<string, string>
  headers?: Record<string, string>; payloadHash: string
  region: string; service?: string; keys: StorageKeys; now?: Date
}

/** AWS Signature Version 4. Returns every header to send (including `Authorization`). */
export function signV4(i: SignInput): Record<string, string> {
  const now = i.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const service = i.service ?? 's3'
  const headers: Record<string, string> = { ...(i.headers ?? {}), host: i.host, 'x-amz-content-sha256': i.payloadHash, 'x-amz-date': amzDate }
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]))
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('')
  const query = Object.entries(i.query ?? {}).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&')
  const canonicalPath = i.path.split('/').map((s) => enc(decodeURIComponent(s))).join('/')
  const canonical = [i.method, canonicalPath, query, canonicalHeaders, names.join(';'), i.payloadHash].join('\n')
  const scope = `${day}/${i.region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + i.keys.secretAccessKey, day), i.region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex')
  return { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${i.keys.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }
}

// ── addresses ────────────────────────────────────────────────────────────────

/** `s3.us-west-004.backblazeb2.com` or a full address, into scheme + host (https unless `http://` was written, for a local test server). */
export function parseEndpoint(endpoint: string): { scheme: 'http' | 'https'; host: string } {
  const t = endpoint.trim().replace(/\/+$/, '')
  const m = /^(https?):\/\/([^/]+)$/i.exec(t)
  if (m) return { scheme: m[1].toLowerCase() as 'http' | 'https', host: m[2] }
  if (/^[A-Za-z0-9.-]+(:\d+)?$/.test(t)) return { scheme: 'https', host: t }
  throw new StorageError('That does not look like a storage address. It looks like s3.us-west-004.backblazeb2.com.')
}

/** Backblaze B2 puts its region in the address; the person should not have to type it twice. */
export function regionFromEndpoint(endpoint: string): string | undefined {
  return /s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(endpoint)?.[1]
}

export function validateTarget(t: Partial<StorageTarget>): string | null {
  if (!t.endpoint?.trim()) return 'Enter the storage address.'
  try { parseEndpoint(t.endpoint) } catch (e) { return (e as Error).message }
  if (!t.bucket?.trim() || !/^[A-Za-z0-9._-]{3,63}$/.test(t.bucket.trim())) return 'Enter the bucket name (3–63 letters, numbers, dots or dashes).'
  if (!(t.region?.trim() || regionFromEndpoint(t.endpoint))) return 'Enter the region (Backblaze shows it next to the address, Cloudflare uses “auto”).'
  return null
}

/** Where a file is kept: by content, so two presets (or two computers) that use the same file share one copy. */
export function objectKey(t: StorageTarget, sha256: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
  return `${(t.prefix ?? 'obs-config-loader/').replace(/^\/+/, '')}${sha256}/${safe}`
}

// ── requests ─────────────────────────────────────────────────────────────────

interface Req { method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'; key?: string; body?: { file: string; size: number; sha256: string }; save?: string; onProgress?: (done: number, total: number) => void }
interface Res { status: number; headers: http.IncomingHttpHeaders; text: string }

function request(t: StorageTarget, keys: StorageKeys, r: Req): Promise<Res> {
  const { scheme, host } = parseEndpoint(t.endpoint)
  const region = t.region?.trim() || regionFromEndpoint(t.endpoint) || 'auto'
  const path = `/${enc(t.bucket.trim())}${r.key ? '/' + r.key.split('/').map(enc).join('/') : ''}`
  const hdrs = signV4({
    method: r.method, host, path, region, keys, payloadHash: r.body?.sha256 ?? sha256Hex(''),
    headers: r.body ? { 'content-length': String(r.body.size), 'content-type': 'application/octet-stream' } : {},
  })
  return new Promise((resolve, reject) => {
    const lib = scheme === 'https' ? https : http
    const req = lib.request({ method: r.method, host: host.replace(/:\d+$/, ''), port: /:(\d+)$/.exec(host)?.[1], path, headers: hdrs }, (res) => {
      if (r.save && res.statusCode === 200) {
        const total = Number(res.headers['content-length'] ?? 0)
        let done = 0
        const out = fs.createWriteStream(r.save)
        res.on('data', (c: Buffer) => { done += c.length; r.onProgress?.(done, total) })
        res.pipe(out)
        out.on('finish', () => resolve({ status: 200, headers: res.headers, text: '' }))
        out.on('error', reject); res.on('error', reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8').slice(0, 4000) }))
      res.on('error', reject)
    })
    req.on('error', (e) => reject(new StorageError(`Could not reach the storage: ${e.message}. Check your internet connection and the address.`)))
    if (r.body) {
      let done = 0
      const rs = fs.createReadStream(r.body.file)
      rs.on('data', (c) => { done += (c as Buffer).length; r.onProgress?.(done, r.body!.size) })
      rs.on('error', (e) => { req.destroy(); reject(e) })
      rs.pipe(req)
    } else req.end()
  })
}

const problem = (res: Res, what: string): StorageError => {
  const code = /<Code>([^<]+)<\/Code>/.exec(res.text)?.[1]
  const msg = /<Message>([^<]+)<\/Message>/.exec(res.text)?.[1]
  if (res.status === 401 || res.status === 403 || code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
    return new StorageError('The storage did not accept those keys. Check that the key ID and the secret key were copied whole, that the region matches, and that the key is allowed to use this bucket.', res.status)
  }
  if (res.status === 404) return new StorageError(code === 'NoSuchBucket' ? 'That bucket does not exist. Check its name and the region.' : `${what}: not found.`, 404)
  return new StorageError(`${what} failed (${res.status}${code ? ' ' + code : ''}${msg ? ': ' + msg : ''}).`, res.status)
}

export async function sha256OfFile(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  for await (const c of fs.createReadStream(file)) h.update(c as Buffer)
  return h.digest('hex')
}

/** Is it there already (with the right size)? Content-addressed, so there is never a reason to send it twice. */
export async function hasObject(t: StorageTarget, keys: StorageKeys, key: string, size: number): Promise<boolean> {
  const r = await request(t, keys, { method: 'HEAD', key })
  if (r.status === 404) return false
  if (r.status !== 200) throw problem(r, 'Checking the storage')
  return Number(r.headers['content-length']) === size
}

export async function putFile(t: StorageTarget, keys: StorageKeys, key: string, file: string, sha256: string, onProgress?: (d: number, t: number) => void): Promise<'uploaded' | 'already-there'> {
  const size = fs.statSync(file).size
  if (await hasObject(t, keys, key, size)) return 'already-there'
  const r = await request(t, keys, { method: 'PUT', key, body: { file, size, sha256 }, onProgress })
  if (r.status !== 200) throw problem(r, 'Uploading')
  return 'uploaded'
}

/** Download to `dest`, check the content hash, and only then put it in place (a broken or tampered download never lands). */
export async function getFile(t: StorageTarget, keys: StorageKeys, key: string, dest: string, sha256: string, onProgress?: (d: number, t: number) => void): Promise<void> {
  fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  try {
    const r = await request(t, keys, { method: 'GET', key, save: tmp, onProgress })
    if (r.status !== 200) throw problem(r, 'Downloading')
    if ((await sha256OfFile(tmp)) !== sha256) throw new StorageError('The downloaded file is not the file that was uploaded (its fingerprint differs), so it was thrown away.')
    fs.renameSync(tmp, dest)
  } finally { fs.rmSync(tmp, { force: true }) }
}

export async function deleteObject(t: StorageTarget, keys: StorageKeys, key: string): Promise<void> {
  const r = await request(t, keys, { method: 'DELETE', key })
  if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw problem(r, 'Removing')
}

/** Try the whole round: the bucket is there, the keys may write, read and remove. Says what to fix when it is not. */
export async function testStorage(t: StorageTarget, keys: StorageKeys): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const bad = validateTarget(t)
    if (bad) return { ok: false, message: bad }
    const head = await request(t, keys, { method: 'HEAD' })
    if (head.status !== 200) throw problem(head, 'Finding the bucket')
    const tmp = nodePath.join(os.tmpdir(), `obscl-test-${crypto.randomBytes(4).toString('hex')}`)
    fs.writeFileSync(tmp, 'OBS Config Loader storage test')
    try {
      const h = sha256Hex('OBS Config Loader storage test')
      const key = `${(t.prefix ?? 'obs-config-loader/').replace(/^\/+/, '')}test-${h.slice(0, 8)}`
      const r = await request(t, keys, { method: 'PUT', key, body: { file: tmp, size: fs.statSync(tmp).size, sha256: h } })
      if (r.status !== 200) throw problem(r, 'Writing a test file')
      await deleteObject(t, keys, key)
    } finally { fs.rmSync(tmp, { force: true }) }
    return { ok: true }
  } catch (e) { return { ok: false, message: (e as Error).message } }
}
