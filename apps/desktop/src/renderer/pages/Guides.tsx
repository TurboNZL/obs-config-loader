import { useEffect, useMemo, useState } from 'react'
import { listGuides } from '../lib/guides'
import { renderMarkdown } from '../lib/markdown'
import { Page } from '../ui'

/** Every guide that ships with the project, readable here (also offline). */
export function GuidesPage() {
  const guides = useMemo(listGuides, [])
  const [name, setName] = useState(guides[0]?.name ?? '')
  const current = guides.find((g) => g.name === name) ?? guides[0]
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!current) return
    let alive = true
    setHtml(null); setError(null)
    current.load().then((md) => { if (alive) setHtml(renderMarkdown(md)) }, (e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [current])

  if (!current) return <Page title="Guides"><p className="text-sm text-muted">No guides in this build.</p></Page>
  const open = (n: string, hash?: string) => { setName(n); if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 80) }

  return (
    <Page title="Guides">
      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Guides" className="space-y-1 md:self-start">
          {guides.map((g) => (
            <button key={g.name} className="bt-nav block w-full text-left px-2 py-1.5 text-sm truncate" aria-current={g.name === current.name ? 'page' : undefined} onClick={() => open(g.name)}>{g.title}</button>
          ))}
        </nav>
        <article
          className="guide min-w-0 max-w-3xl"
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a[data-doc]') as HTMLAnchorElement | null
            if (a) { e.preventDefault(); open(a.dataset.doc!) }
          }}
        >
          {error && <p className="card p-3 text-sm" style={{ borderColor: 'hsl(var(--bad))' }}>{error}</p>}
          {!html && !error && <p className="text-sm text-muted">Loading…</p>}
          {html && <div dangerouslySetInnerHTML={{ __html: html }} />}
        </article>
      </div>
    </Page>
  )
}
