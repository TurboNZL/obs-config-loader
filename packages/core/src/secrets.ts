import type { Variable } from './types.js'

/** JSON keys whose string values are credentials. Matches `key`, `stream-key`, `streamKey`, `password`, `token`... */
const SECRET_KEY = /(?:^|[-_])(?:key|password|passwd|token|secret)$|streamkey$/i

export function isSecretKey(k: string): boolean {
  return SECRET_KEY.test(k)
}

export interface ScrubResult<T> { value: T; variables: Variable[] }

/**
 * Replace credential values with `{{var:NAME}}`. The same secret value gets the same name everywhere
 * (one stream key used by OBS and by a multi-output plugin is one question at import).
 */
export class SecretScrubber {
  private byValue = new Map<string, string>()
  readonly variables: Variable[] = []

  private nameFor(value: string, hint: string): string {
    const known = this.byValue.get(value)
    if (known) return known
    let name = hint.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET'
    let n = 2
    while (this.variables.some((v) => v.name === name)) name = `${name.replace(/_\d+$/, '')}_${n++}`
    this.byValue.set(value, name)
    return name
  }

  /** `file` is the path inside the bundle (for the variable's `target`); `primary` names the main stream key. */
  scrubJson<T>(value: T, file: string, primary?: string): T {
    const walk = (v: unknown, path: string[]): unknown => {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)]))
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if (typeof x === 'string' && x !== '' && !x.includes('{{') && isSecretKey(k)) {
            const isPrimary = primary && [...path, k].join('.') === primary
            const name = this.nameFor(x, isPrimary ? 'STREAM_KEY' : `${file.replace(/\.[a-z]+$/i, '')}_${path.join('_')}_${k}`)
            if (!this.variables.some((vv) => vv.name === name)) {
              this.variables.push({
                name, kind: 'secret', required: false,
                label: isPrimary ? 'Stream key' : `Secret in ${file} (${[...path, k].join('.')})`,
                target: `${file}#${[...path, k].join('.')}`,
              })
            }
            out[k] = `{{var:${name}}}`
          } else out[k] = walk(x, [...path, k])
        }
        return out
      }
      return v
    }
    return walk(value, []) as T
  }
}
