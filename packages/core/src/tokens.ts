import * as nodePath from 'node:path'
import type { Platform } from './types.js'

export const BUILTIN_TOKENS = ['home', 'documents', 'videos', 'music', 'pictures', 'desktop', 'bundle'] as const
export type BuiltinToken = (typeof BUILTIN_TOKENS)[number]

const TOKEN_RE = /\{\{([a-z]+)(?::([^{}]+))?\}\}/g

export interface TokenResolver {
  asset(id: string): string | undefined
  variable(name: string): string | undefined
  builtin(name: BuiltinToken): string | undefined
  /** Called for every token that could not be resolved. */
  missing(kind: 'asset' | 'var' | 'builtin', name: string): void
}

export function pathModule(platform: Platform): typeof nodePath.posix {
  return platform === 'win32' ? (nodePath.win32 as typeof nodePath.posix) : nodePath.posix
}

/** Escape literal "{{" so it is not mistaken for a token. */
export function escapeLiteral(s: string): string {
  return s.includes('{{') ? s.split('{{').join('{{lbrace}}') : s
}

export function hasTokens(s: string): boolean {
  TOKEN_RE.lastIndex = 0
  return TOKEN_RE.test(s)
}

/** Replace tokens in one string. Path separators after a path token follow the target platform. */
export function resolveString(s: string, r: TokenResolver, target: Platform): string {
  if (!s.includes('{{')) return s
  let usedPathToken = false
  const out = s.replace(TOKEN_RE, (whole, kind: string, arg: string | undefined) => {
    if (kind === 'lbrace' && arg === undefined) return '{{'
    if (kind === 'asset' && arg) {
      const v = r.asset(arg)
      if (v === undefined) { r.missing('asset', arg); return '' }
      usedPathToken = true
      return v
    }
    if (kind === 'var' && arg) {
      const v = r.variable(arg)
      if (v === undefined) { r.missing('var', arg); return '' }
      return v
    }
    if (arg === undefined && (BUILTIN_TOKENS as readonly string[]).includes(kind)) {
      const v = r.builtin(kind as BuiltinToken)
      if (v === undefined) { r.missing('builtin', kind); return '' }
      usedPathToken = true
      return v
    }
    return whole // unknown token: leave untouched
  })
  if (usedPathToken && target === 'win32') return out.replace(/\//g, '\\')
  if (usedPathToken && target !== 'win32') return out.replace(/\\/g, '/')
  return out
}

/** Deep-map every string in a JSON value (keys are not touched). */
export function mapStrings(value: unknown, fn: (s: string, key: string | undefined) => string, key?: string): unknown {
  if (typeof value === 'string') return fn(value, key)
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn, key))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapStrings(v, fn, k)
    return out
  }
  return value
}

export function resolveJson<T>(value: T, r: TokenResolver, target: Platform): T {
  return mapStrings(value, (s) => resolveString(s, r, target)) as T
}

// ── path heuristics (used when exporting) ───────────────────────────────────

const WIN_ABS = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/
const POSIX_ABS = /^\/[^\s/\0][^\0\n]*$/

export function looksLikeAbsolutePath(s: string): boolean {
  if (s.length > 1024 || s.includes('\n') || s.includes('\0')) return false
  if (s.startsWith('file://') || s.startsWith('//')) return false
  if (WIN_ABS.test(s)) return true
  if (!POSIX_ABS.test(s)) return false
  // "/me" in a chat message is not a path: need two segments or a file extension.
  return s.split('/').filter(Boolean).length >= 2 || /\.[A-Za-z0-9]{1,5}$/.test(s)
}

export function pathStyleOf(s: string): Platform {
  return WIN_ABS.test(s) ? 'win32' : 'linux'
}

/** Split an absolute path (either style) into segments, dropping the root. */
export function splitPath(s: string): { root: string; parts: string[] } {
  if (WIN_ABS.test(s)) {
    const m = /^([A-Za-z]:|\\\\[^\\/]+[\\/][^\\/]+)[\\/]?(.*)$/.exec(s)!
    return { root: m[1], parts: m[2].split(/[\\/]/).filter(Boolean) }
  }
  return { root: '/', parts: s.split('/').filter(Boolean) }
}
