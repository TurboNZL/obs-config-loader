import { useEffect, useState } from 'react'
import type { AuthorsState, IdentityState, RepoInfo } from '../../../electron/api'
import { Card, Chip, Message, plural } from '../ui'
import { Icon } from './Icon'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }
const show = (i: { name: string; email: string } | null) => (i ? `${i.name} <${i.email}>` : 'this computer’s own git name')

/** Settings: who the saves this app makes are by. Never changes this computer's own git settings. */
export function IdentityCard() {
  const [st, setSt] = useState<IdentityState | null>(null)
  const [mode, setMode] = useState<'github' | 'custom'>('github')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<Msg | null>(null)
  const load = async () => {
    const s = await window.obsLoader.identity.get()
    setSt(s); setMode(s.mode === 'github' && !s.github && s.name ? 'custom' : s.mode); setName(s.name || s.effective?.name || ''); setEmail(s.email || s.effective?.email || '')
  }
  useEffect(() => { void load() }, [])
  if (!st) return null
  const save = async () => {
    const r = await window.obsLoader.identity.set(mode, name, email)
    setMsg(r.ok ? { tone: 'good', text: 'Saved. New saves use this name.' } : { tone: 'bad', text: r.error })
    await load()
  }
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Icon name="user" /> Who your saves are by</span>} right={<Chip tone="good" icon="drive">this app only</Chip>}>
      <p className="text-sm text-muted">Every save in a preset is stamped with a name and an email address, and a preset on GitHub shows them to anyone who can see it. This is what the app uses. Your computer's own git settings are never read for this and never changed.</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="who" className="mt-1" checked={mode === 'github'} disabled={!st.github} onChange={() => setMode('github')} />
        <span>
          <strong>My GitHub account</strong>
          {st.github
            ? <span className="block text-muted">{st.github.name} &lt;{st.github.email}&gt; (GitHub's private address, so your real email is not shown)</span>
            : <span className="block text-muted">Sign in to GitHub below to use this.</span>}
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="who" className="mt-1" checked={mode === 'custom'} onChange={() => setMode('custom')} />
        <span><strong>A name I choose</strong><span className="block text-muted">For example a stage name, so nothing points to a private account.</span></span>
      </label>
      {mode === 'custom' && (
        <div className="grid gap-2 sm:grid-cols-2 pl-6">
          <input className="input px-2 py-1.5" placeholder="Name" aria-label="Name for saves" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input px-2 py-1.5" placeholder="name@example.com" aria-label="Email address for saves" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn-accent px-3 py-1.5" onClick={save}>Save</button>
        <span className="text-xs text-muted">New saves are by: {show(st.effective)}. A single preset can have its own name (under its details).</span>
      </div>
    </Card>
  )
}

/** In a preset's details: who its saves are by, a name only for this preset, and changing the name on every save it already has. */
export function PresetIdentity({ repo, refresh }: { repo: RepoInfo; refresh: () => Promise<void> }) {
  const [a, setA] = useState<AuthorsState | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const online = !!repo.remoteUrl
  const load = async () => {
    const x = await window.obsLoader.presets.authors(repo.path)
    setA(x); setName((n) => n || x.effective?.name || ''); setEmail((m) => m || x.effective?.email || '')
  }
  useEffect(() => { void load() }, [repo.path, repo.status.commits])
  if (!a) return null
  const mixed = a.authors.length > 1 || (a.authors.length === 1 && (a.authors[0].name !== a.effective?.name || a.authors[0].email !== a.effective?.email))

  const rewrite = async () => {
    setBusy(true); setMsg(null)
    const r = await window.obsLoader.presets.rewriteAuthors(repo.path, { name, email })
    setBusy(false); setSure(false)
    if (!r.ok) setMsg({ tone: 'bad', text: r.error })
    else if (!r.changed) setMsg({ tone: 'good', text: 'Every save already has this name.' })
    else if (r.online && !r.pushed) setMsg({ tone: 'warn', text: `Changed on this computer, but GitHub still has the old names${r.pushError ? ` (${r.pushError})` : ''}. Choose “Keep mine” when it asks, or try again.` })
    else setMsg({ tone: 'good', text: `Changed ${plural(r.rewritten, 'save')}${r.online ? ' here and on GitHub' : ''}. Saves from now on use this name too.` })
    await load(); await refresh()
  }
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm flex items-center gap-2"><Icon name="user" size={14} /> Who the saves are by</h3>
      <p className="text-xs text-muted">
        {a.authors.length === 0 ? 'No saves yet.' : <>Saves in this preset are by: {a.authors.map((x) => `${x.name} <${x.email}> (${x.saves})`).join(', ')}.</>}
        {' '}New saves are by {show(a.effective)}{a.own ? ' (this preset’s own name)' : ''}.
      </p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input px-2 py-1.5" placeholder="Name" aria-label="Name for this preset's saves" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input px-2 py-1.5" placeholder="name@example.com" aria-label="Email address for this preset's saves" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn px-3 py-1" disabled={busy || !name.trim() || !email.trim()} onClick={async () => {
          const r = await window.obsLoader.presets.setAuthor(repo.path, { name, email })
          setMsg(r.ok ? { tone: 'good', text: 'Saves from now on use this name. Earlier saves are not changed.' } : { tone: 'bad', text: r.error }); await load()
        }}>Use for new saves of this preset</button>
        {a.own && <button className="btn btn-ghost px-3 py-1" disabled={busy} onClick={async () => { await window.obsLoader.presets.setAuthor(repo.path, null); setMsg({ tone: 'good', text: 'This preset follows the app’s choice again.' }); setName(''); setEmail(''); await load() }}>Use the app’s choice again</button>}
        <button className={`btn px-3 py-1 ${mixed ? 'btn-accent' : ''}`} disabled={busy || !name.trim() || !email.trim()} onClick={() => setSure(true)}>Change the name on all earlier saves…</button>
      </div>
      {sure && (
        <Message tone="warn">
          <p>This rewrites the history of this preset so that every save, from the first one, says <strong>{name} &lt;{email}&gt;</strong>. The files, the messages and the dates stay exactly as they are.</p>
          {online
            ? <p className="mt-1">It then replaces the copy on GitHub. Anyone who already has a copy keeps the old names in theirs, and GitHub can keep showing the old ones for a while to people who have an old link. If the old name must never be seen, make a new preset from this one instead (switch online backup off, then on again with a new repository).</p>
            : <p className="mt-1">This preset is only on this computer, so nothing else is affected. Do this before you put it online or share it.</p>}
          <div className="flex gap-2 mt-2">
            <button className="btn btn-accent px-3 py-1" disabled={busy} onClick={rewrite}>{busy ? 'Changing…' : 'Change every save'}</button>
            <button className="btn btn-ghost px-3 py-1" disabled={busy} onClick={() => setSure(false)}>Cancel</button>
          </div>
        </Message>
      )}
    </div>
  )
}
