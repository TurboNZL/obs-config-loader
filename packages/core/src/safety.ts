/**
 * Things that keep passwords and stream keys out of a preset even when a file is not one the app understands.
 * A preset can end up on GitHub, so the rule is: a file whose contents cannot be checked is left out, never copied as it is.
 */

/** Files that Windows tools and plugins write with a byte-order mark in front: JSON.parse refuses them. */
export const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** Copies a program leaves beside the real file (`service.json.bak`): they hold the same secrets and nothing uses them. */
export const BACKUP_FILE = /(\.(bak|old|orig|tmp|swp|backup)|~)$/i

const SECRET_WORD = String.raw`(?:token|password|passwd|secret|api[_-]?key|stream[_-]?key|access[_-]?key|private[_-]?key)`
const SECRET_LINE = new RegExp(String.raw`(?:^|[\s"'{,;])[A-Za-z0-9_.-]*${SECRET_WORD}[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?([^\s"'{}<>,;]{6,})`, 'im')
const BENIGN_VALUE = /^(true|false|null|none|undefined|changeme|your[-_ ]?\w*|<.*>|\$\{.*|%.*%|\{\{.*)$/i

/** Does this text hold something that looks like `TOKEN=abc123…` or `"password": "…"`? Placeholders and flags do not count. */
export function looksSecret(text: string): boolean {
  for (const line of stripBom(text).split(/\r?\n/)) {
    const m = SECRET_LINE.exec(line)
    if (m && !BENIGN_VALUE.test(m[1])) return true
  }
  return false
}

/** Text-like files whose contents are worth checking before they are kept (code is not checked: it mentions "token" as a word). */
export const DATA_FILE = /\.(txt|md|json|ini|cfg|conf|env|ya?ml|toml|properties)$/i

/**
 * A small .gitignore reader: what the project itself says it does not want shared (its own secrets, its build and its
 * private copies of other programs) is what a preset must not keep either. Supports `#`, blank lines, `!`, a leading `/`,
 * a trailing `/`, `*`, `?` and `**`.
 */
export function makeIgnore(text: string): (rel: string, isDir: boolean) => boolean {
  const rules: { re: RegExp; neg: boolean; dirOnly: boolean }[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, '')
    if (!line || line.startsWith('#')) continue
    let neg = false
    if (line.startsWith('!')) { neg = true; line = line.slice(1) }
    const dirOnly = line.endsWith('/')
    if (dirOnly) line = line.slice(0, -1)
    const anchored = line.startsWith('/') || line.slice(0, -1).includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    const body = line.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')
    rules.push({ re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}(?:/.*)?$`), neg, dirOnly })
  }
  return (rel, isDir) => {
    let ignored = false
    for (const r of rules) {
      if (r.dirOnly && !isDir && !r.re.test(rel + '/x')) continue // a "dir/" rule also covers everything inside the dir
      if (r.re.test(rel)) ignored = !r.neg
    }
    return ignored
  }
}
