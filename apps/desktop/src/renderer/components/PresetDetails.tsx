import { useEffect, useState } from 'react'
import type { PresetDetails, RenameRequest, RepoInfo } from '../../../electron/api'
import { Field, Message } from '../ui'
import { PresetIdentity } from './Identity'

export type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

// ── renaming ────────────────────────────────────────────────────────────────

export function RenameRow({ label, value, onRename, indent }: { label?: string; value: string; onRename: (to: string) => Promise<string | null>; indent?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true); setError(null)
    const err = await onRename(text)
    setBusy(false)
    if (err) setError(err); else setEditing(false)
  }
  return (
    <div className={'bt-row py-1 ' + (indent ? 'pl-4' : '')}>
      {!editing ? (
        <div className="flex items-center gap-2">
          {label && <span className="text-xs text-muted w-28 shrink-0">{label}</span>}
          <span className="flex-1 min-w-0 truncate text-sm">{value}</span>
          <button className="btn btn-ghost px-2 py-0.5 text-xs" aria-label={`Rename ${value}`} onClick={() => { setText(value); setEditing(true); setError(null) }}>Rename</button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input className="input flex-1 px-2 py-1" autoFocus value={text} aria-label={`New name for ${value}`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(); if (e.key === 'Escape') setEditing(false) }} />
            <button className="btn btn-accent px-3 py-1" disabled={busy || !text.trim()} onClick={go}>{busy ? 'Renaming…' : 'Rename'}</button>
            <button className="btn btn-ghost px-2 py-1" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {error && <Message tone="bad">{error}</Message>}
        </div>
      )}
    </div>
  )
}

export function Details({ repo, installId, refresh, obsNote, notify }: { repo: RepoInfo; installId?: string; refresh: () => Promise<void>; obsNote: boolean; notify: (m: Msg) => void }) {
  const [d, setD] = useState<PresetDetails | null>(null)
  const load = () => window.obsLoader.presets.details(repo.path).then(setD).catch(() => setD(null))
  useEffect(() => { void load() }, [repo.path, repo.status.commits]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="text-sm text-muted">Reading the preset…</p>
  const rename = (req: Omit<RenameRequest, 'path' | 'installId' | 'to'>) => async (to: string) => {
    const r = await window.obsLoader.presets.rename({ path: repo.path, installId, ...req, to })
    if (!r.ok) return r.error
    await refresh(); await load()
    return null
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Names</h3>
        <p className="text-xs text-muted mb-1">Renaming here changes the name in the preset and, if your OBS has the same thing, in OBS too{obsNote ? ' (OBS must be closed for that)' : ''}.</p>
        <RenameRow label="Preset" value={repo.name} onRename={rename({ kind: 'preset' })} />
        {d.layouts.map((l) => (
          <div key={l.id}>
            <RenameRow label="Scene layout" value={l.name} onRename={rename({ kind: 'layout', id: l.id })} />
            {l.scenes.length > 0 && l.scenes.map((s) => <RenameRow key={'s' + s} indent label="Scene" value={s} onRename={rename({ kind: 'scene', layoutId: l.id, from: s })} />)}
            {l.sources.length > 0 && (
              <details className="pl-4 text-sm">
                <summary className="cursor-pointer text-muted">{l.sources.length} sources (images, captures, browsers…)</summary>
                {l.sources.map((s) => <RenameRow key={'o' + s} indent label="Source" value={s} onRename={rename({ kind: 'scene', layoutId: l.id, from: s })} />)}
              </details>
            )}
          </div>
        ))}
        {d.outputs.map((o) => <RenameRow key={o.id} label="Output settings" value={o.name} onRename={rename({ kind: 'output', id: o.id })} />)}
      </div>

      <Translations repo={repo} d={d} reload={load} />
      <PresetIdentity repo={repo} refresh={refresh} />
      <MoveIt repo={repo} refresh={refresh} notify={notify} />

      <div>
        <h3 className="font-semibold text-sm">What it needs</h3>
        <ul className="text-sm space-y-0.5">
          <li>{d.savedWithObs ? <>Saved with OBS {d.savedWithObs}.</> : <span className="text-muted">The OBS version was not recorded yet. It is added the next time you save.</span>}</li>
          {d.plugins.map((p) => <li key={p.name}>Plugin: {p.name}{p.version ? ` (version ${p.version})` : ''}</li>)}
          {d.plugins.length > 0 && d.plugins.every((p) => !p.version) && <li className="text-xs text-muted">Plugins only show a version when they tell OBS one.</li>}
          {d.scripts.map((s) => <li key={s}>Script: {s} (kept with the preset)</li>)}
          {d.remoteControl && <li>OBS remote-control settings (WebSocket) are kept with the preset.</li>}
        </ul>
      </div>
    </div>
  )
}

// ── how sources change on other computers ──────────────────────────────────

function Translations({ repo, d, reload }: { repo: RepoInfo; d: PresetDetails; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg | null>(null)
  if (d.translations.length === 0 && d.sourceTranslations.length === 0) return null
  const current = () => {
    const o: Record<string, Record<string, string | null>> = {}
    for (const row of d.translations) for (const t of row.targets) {
      if (t.chosen === undefined) continue
      const keys = t.platform === 'linux' ? ['linux', 'linux-pipewire'] : [t.platform]
      for (const k of keys) (o[row.from] ??= {})[k] = t.chosen
    }
    return o
  }
  const change = async (from: string, platform: string, value: string) => {
    const o = current()
    const keys = platform === 'linux' ? ['linux', 'linux-pipewire'] : [platform]
    for (const k of keys) {
      if (value === '') { if (o[from]) { delete o[from][k]; if (!Object.keys(o[from]).length) delete o[from] } } else (o[from] ??= {})[k] = value === '__hide__' ? null : value
    }
    const r = await window.obsLoader.presets.setOverrides(repo.path, o)
    setMsg(r.ok ? { tone: 'good', text: 'Saved. It is used the next time this preset is applied on another kind of computer.' } : { tone: 'bad', text: r.error })
    await reload()
  }
  return (
    <div>
      <h3 className="font-semibold text-sm">How sources change on other computers</h3>
      <p className="text-xs text-muted mb-1">Some sources only exist on one system. When this preset is applied on another, the app swaps each for the closest one. Change a choice here if it guessed wrong. You pick the window, screen or device again either way.</p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      {d.translations.length > 0 && <p className="text-xs text-muted">These choices apply to every source of a kind.</p>}
      {d.translations.map((row) => (
        <div key={row.from} className="bt-row py-1 space-y-1">
          <div className="text-sm font-medium">{row.name}</div>
          {row.targets.map((t) => (
            <label key={t.platform} className="flex items-center gap-2 pl-3 text-sm">
              <span className="w-16 text-muted shrink-0">On {t.label}:</span>
              <select
                className="input flex-1 px-2 py-1" aria-label={`${row.name} on ${t.label}`}
                value={t.chosen === undefined ? '' : t.chosen === null ? '__hide__' : t.chosen}
                onChange={(e) => void change(row.from, t.platform, e.target.value)}
              >
                <option value="">{t.defaultName ? `Automatic: ${t.defaultName}` : 'Automatic: hide it'}</option>
                <option value="__hide__">Hide it</option>
                {t.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      ))}
      <PerSource repo={repo} d={d} reload={reload} setMsg={setMsg} />
    </div>
  )
}

/** The same choices for one source on its own: two window captures can become different things. A source's own choice beats the one for its kind. */
function PerSource({ repo, d, reload, setMsg }: { repo: RepoInfo; d: PresetDetails; reload: () => Promise<void>; setMsg: (m: Msg) => void }) {
  if (d.sourceTranslations.length === 0) return null
  const current = () => {
    const o: Record<string, Record<string, string | null>> = {}
    for (const row of d.sourceTranslations) for (const t of row.targets) {
      if (t.chosen === undefined) continue
      for (const k of t.platform === 'linux' ? ['linux', 'linux-pipewire'] : [t.platform]) (o[row.key] ??= {})[k] = t.chosen
    }
    return o
  }
  const change = async (key: string, platform: string, value: string) => {
    const o = current()
    for (const k of platform === 'linux' ? ['linux', 'linux-pipewire'] : [platform]) {
      if (value === '') { if (o[key]) { delete o[key][k]; if (!Object.keys(o[key]).length) delete o[key] } } else (o[key] ??= {})[k] = value === '__hide__' ? null : value
    }
    const r = await window.obsLoader.presets.setSourceOverrides(repo.path, o)
    setMsg(r.ok ? { tone: 'good', text: 'Saved for that source. It is used the next time this preset is applied on another kind of computer.' } : { tone: 'bad', text: r.error })
    await reload()
  }
  const layouts = [...new Set(d.sourceTranslations.map((r) => r.layout))]
  const own = d.sourceTranslations.filter((r) => r.targets.some((t) => t.chosen !== undefined)).length
  return (
    <details className="mt-2" open={own > 0}>
      <summary className="cursor-pointer text-sm font-medium">Choose for one source at a time{own > 0 ? ` (${own} set)` : ''}</summary>
      <p className="text-xs text-muted my-1">Leave a source on “Same as its kind” to follow the choice above. Pick something here to treat just that source differently.</p>
      {layouts.map((layout) => (
        <div key={layout} className="space-y-1">
          {layouts.length > 1 && <div className="text-xs text-muted pt-1">In “{layout}”</div>}
          {d.sourceTranslations.filter((r) => r.layout === layout).map((row) => (
            <div key={row.key} className="bt-row py-1 space-y-1">
              <div className="text-sm"><span className="font-medium">{row.name}</span> <span className="text-muted">· {row.fromName}</span></div>
              {row.targets.map((t) => {
                const kind = d.translations.find((x) => x.from === row.from)?.targets.find((x) => x.platform === t.platform)
                const kindText = kind?.chosen === undefined ? (t.defaultName ? `Automatic: ${t.defaultName}` : 'Automatic: hide it') : kind.chosen === null ? 'Hide it' : (t.options.find((o) => o.id === kind.chosen)?.name ?? kind.chosen)
                return (
                  <label key={t.platform} className="flex items-center gap-2 pl-3 text-sm">
                    <span className="w-16 text-muted shrink-0">On {t.label}:</span>
                    <select
                      className="input flex-1 px-2 py-1" aria-label={`${row.name} on ${t.label}`}
                      value={t.chosen === undefined ? '' : t.chosen === null ? '__hide__' : t.chosen}
                      onChange={(e) => void change(row.key, t.platform, e.target.value)}
                    >
                      <option value="">Same as its kind ({kindText})</option>
                      <option value="__hide__">Hide it</option>
                      {t.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </details>
  )
}

// ── the name on GitHub ─────────────────────────────────────────────────────

export function RenameOnline({ repo, refresh, notify }: { repo: RepoInfo; refresh: () => Promise<void>; notify: (m: Msg) => void }) {
  const [text, setText] = useState((repo.online?.name ?? '').replace(/^obs-config-/i, ''))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  return (
    <div className="space-y-1">
      <h3 className="font-semibold text-sm">Name on GitHub</h3>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      <div className="flex items-center gap-1">
        <span className="mono text-muted">OBS-Config-</span>
        <input className="input flex-1 px-2 py-1.5" aria-label="New name on GitHub" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn px-3 py-1.5" disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true); setMsg(null)
          const r = await window.obsLoader.presets.renameOnline(repo.path, text)
          setBusy(false)
          if (r.ok) { notify({ tone: 'good', text: `It is now called “${r.name}” on GitHub. This preset follows it.` }); await refresh() } else setMsg({ tone: 'bad', text: r.error })
        }}>{busy ? 'Renaming…' : 'Rename on GitHub'}</button>
      </div>
      <p className="text-xs text-muted">Other computers that already use this preset keep working: GitHub forwards the old name.</p>
    </div>
  )
}

// ── moving a preset ────────────────────────────────────────────────────────

export function MoveIt({ repo, refresh, notify }: { repo: RepoInfo; refresh: () => Promise<void>; notify: (m: Msg) => void }) {
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div>
      <h3 className="font-semibold text-sm">Where it is kept</h3>
      <p className="mono text-muted">{repo.path}</p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      <button className="btn px-3 py-1.5 mt-1" disabled={busy} onClick={async () => {
        const parent = await window.obsLoader.files.pick('Choose the folder to move this preset into', true)
        if (!parent) return
        setBusy(true); setMsg(null)
        const r = await window.obsLoader.presets.move(repo.path, parent)
        setBusy(false)
        if (r.ok) { notify({ tone: 'good', text: `Moved “${r.repo.name}” to ${r.repo.path}.` }); await refresh() } else setMsg({ tone: 'bad', text: r.error })
      }}>{busy ? 'Moving…' : 'Move to another folder…'}</button>
    </div>
  )
}

