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
/** Plugin config files we recognise, so a secret in one is described by the plugin's name, not a file name. */
const FILE_LABEL: Record<string, string> = { 'obs-multi-rtmp.json': 'Multiple RTMP outputs', 'aitum.json': 'Aitum Stream Suite' }

export class SecretScrubber {
  private byValue = new Map<string, string>()
  readonly variables: Variable[] = []
  /** `keepValues`: also write each secret into its variable (the person exporting chose to include their keys). */
  constructor(private readonly keepValues = false) {}

  private nameFor(value: string, hint: string): string {
    const known = this.byValue.get(value)
    if (known) return known
    let name = hint.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET'
    let n = 2
    while (this.variables.some((v) => v.name === name)) name = `${name.replace(/_\d+$/, '')}_${n++}`
    this.byValue.set(value, name)
    return name
  }

  /**
   * `file` is the path inside the bundle (for the variable's `target`); `primary` names the main stream key.
   * Each secret gets a label a person can recognise: the streaming service for the main key ("Stream key for Twitch"), the
   * output's own name and plugin for the rest ("Multiple RTMP outputs: YouTube").
   */
  scrubJson<T>(value: T, file: string, primary?: string): T {
    const base = file.split('/').pop() ?? file
    const service = primary ? (value as any)?.settings?.service : undefined
    const walk = (v: unknown, path: string[], names: string[]): unknown => {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)], names))
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>
        // the nearest enclosing thing that has a name (an output target, say) is what the person calls this key
        const own = typeof obj.name === 'string' && obj.name ? [...names, obj.name] : names
        const out: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(obj)) {
          if (typeof x === 'string' && x !== '' && !x.includes('{{') && isSecretKey(k)) {
            const isPrimary = !!primary && [...path, k].join('.') === primary
            const name = this.nameFor(x, isPrimary ? 'STREAM_KEY' : `${base.replace(/\.[a-z]+$/i, '')}_${path.join('_')}_${k}`)
            if (!this.variables.some((vv) => vv.name === name)) {
              const plugin = FILE_LABEL[base]
              const what = own[own.length - 1]
              const label = base === 'obs-websocket.json' ? 'Password for controlling OBS from other programs (WebSocket)' : isPrimary
                ? (typeof service === 'string' && service ? `Stream key for ${service}` : 'Your main stream key')
                : plugin ? `${plugin}: ${what ? `“${what}”` : 'an output'}` : `Secret in ${base}${what ? ` (${what})` : ''}`
              this.variables.push({
                name, kind: 'secret', required: false, label, target: `${file}#${[...path, k].join('.')}`,
                ...(this.keepValues ? { value: x } : {}),
              })
            }
            out[k] = `{{var:${name}}}`
          } else out[k] = walk(x, [...path, k], own)
        }
        return out
      }
      return v
    }
    return walk(value, [], []) as T
  }
}
