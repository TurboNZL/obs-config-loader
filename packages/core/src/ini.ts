/**
 * Minimal INI handling for OBS files. OBS writes `[Section]` / `Key=Value` lines with no quoting.
 * Edits touch only the lines asked for, so everything else (order, comments, odd keys) survives.
 */
export interface IniEntry { section: string; key: string; value: string; line: number }

export function parseIni(text: string): IniEntry[] {
  const out: IniEntry[] = []
  let section = ''
  text.split(/\r?\n/).forEach((raw, line) => {
    const m = /^\s*\[(.+)\]\s*$/.exec(raw)
    if (m) { section = m[1]; return }
    const eq = raw.indexOf('=')
    if (eq <= 0 || raw.trimStart().startsWith(';')) return
    out.push({ section, key: raw.slice(0, eq), value: raw.slice(eq + 1), line })
  })
  return out
}

export function getIni(text: string, section: string, key: string): string | undefined {
  return parseIni(text).find((e) => e.section === section && e.key === key)?.value
}

/** Rewrite values in place; adds the key (and section) when missing. Keeps the file's line ending. */
export function setIni(text: string, section: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  const hit = parseIni(text).find((e) => e.section === section && e.key === key)
  if (hit) {
    lines[hit.line] = `${key}=${value}`
    return lines.join(eol)
  }
  const sIdx = lines.findIndex((l) => l.trim() === `[${section}]`)
  if (sIdx === -1) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('')
    lines.push(`[${section}]`, `${key}=${value}`, '')
    return lines.join(eol)
  }
  let end = sIdx + 1
  while (end < lines.length && !/^\s*\[.+\]\s*$/.test(lines[end])) end++
  while (end > sIdx + 1 && lines[end - 1].trim() === '') end--
  lines.splice(end, 0, `${key}=${value}`)
  return lines.join(eol)
}

/** Apply a function to every value; returns new text. */
export function mapIniValues(text: string, fn: (section: string, key: string, value: string) => string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  for (const e of parseIni(text)) {
    const nv = fn(e.section, e.key, e.value)
    if (nv !== e.value) lines[e.line] = `${e.key}=${nv}`
  }
  return lines.join(eol)
}
