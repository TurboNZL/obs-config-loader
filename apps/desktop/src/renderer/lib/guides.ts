/**
 * The guides that ship with the project (docs/guides/ and the README; development notes and the format spec live elsewhere), bundled into the app so
 * they can be read offline. Each is loaded only when opened.
 */
const files = import.meta.glob('../../../../../docs/guides/**/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const readme = import.meta.glob('../../../../../README.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

export interface Guide { name: string; title: string; group: 'Start' | 'More'; load: () => Promise<string> }

const TITLE: Record<string, [string, Guide['group']]> = {
  GETTING_STARTED: ['Getting started', 'Start'],
  README: ['About OBS Config Loader', 'Start'],
}
const ORDER = Object.keys(TITLE)

/** `../../../../../docs/guides/X.md` -> `X`; the README is `README`. */
export const guideName = (path: string) => (/README\.md$/.test(path) && !path.includes('/docs/') ? 'README' : path.replace(/^.*\/docs\/(?:guides\/)?/, '').replace(/\.md$/, ''))

export function listGuides(): Guide[] {
  const all = [...Object.entries(readme), ...Object.entries(files)].map(([path, load]): Guide => {
    const name = guideName(path)
    const known = TITLE[name]
    return { name, load, title: known?.[0] ?? name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), group: known?.[1] ?? 'More' }
  })
  const rank = (g: Guide) => { const i = ORDER.indexOf(g.name); return i === -1 ? 1000 : i }
  return all.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}
