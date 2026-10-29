import { useEffect, useState } from 'react'
import type { AssetNeed, InstallInfo, LogEntry, RepoInfo } from '../../../electron/api'
import { Card, Chip, Field, KIND_LABEL, Message, Page } from '../ui'

export function ReposPage({ installs, applyRepo }: { installs: InstallInfo[] | null; applyRepo: (dir: string, installId?: string) => void }) {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [newName, setNewName] = useState('My OBS setup')
  const [newInstall, setNewInstall] = useState('')

  const refresh = () => window.obsLoader.repos.list().then(setRepos)
  useEffect(() => { void refresh() }, [])
  const withConfig = (installs ?? []).filter((i) => i.configExists)
  useEffect(() => { if (!newInstall && withConfig[0]) setNewInstall(withConfig[0].id) }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps

  const added = async (p: Promise<{ added?: RepoInfo; error?: string; cancelled?: boolean }>) => {
    const r = await p
    if (r.error) setError(r.error)
    else if (r.added) { setError(null); await refresh() }
  }

  return (
    <Page
      title="Config repositories"
      intro="Keep a setup in git. Scenes and profiles are saved as plain files, big media as placeholders, and secrets never. Edits you make in OBS are saved into the repo before anything else changes it, so they are never reverted."
    >
      {error && <Message tone="bad">{error}</Message>}
      {repos?.length === 0 && <Message tone="warn">No repositories yet. Start one from an OBS install below, open an existing folder, or clone one.</Message>}
      {repos?.map((r) => <RepoCard key={r.path} repo={r} installs={installs ?? []} refresh={refresh} apply={applyRepo} />)}

      <Card title="Add a repository">
        <div className="flex gap-2 flex-wrap">
          <button className="btn px-3 py-1.5" onClick={() => added(window.obsLoader.repos.addExisting())}>Open an existing folder…</button>
        </div>
        <Field label="Clone from a git address" hint="Uses your own git credentials (SSH key or credential helper).">
          <div className="flex gap-2">
            <input className="input flex-1 px-2 py-1.5" placeholder="https://github.com/you/my-obs-setup.git" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn px-3" disabled={!url.trim()} onClick={() => added(window.obsLoader.repos.clone(url))}>Clone…</button>
          </div>
        </Field>
        {withConfig.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Start a new repository from an OBS install</div>
            <div className="flex gap-2 flex-wrap">
              <input className="input px-2 py-1.5 flex-1 min-w-40" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Name" />
              <select className="input px-2 py-1.5" value={newInstall} onChange={(e) => setNewInstall(e.target.value)} aria-label="OBS install">
                {withConfig.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
              </select>
              <button className="btn btn-accent px-3" disabled={!newName.trim() || !newInstall} onClick={() => added(window.obsLoader.repos.create(newInstall, newName.trim()))}>Create…</button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  )
}

function RepoCard({ repo, installs, refresh, apply }: { repo: RepoInfo; installs: InstallInfo[]; refresh: () => Promise<void>; apply: (dir: string, installId?: string) => void }) {
  const st = repo.status
  const usable = installs.filter((i) => i.configExists)
  const [installId, setInstallId] = useState(repo.installId && usable.some((i) => i.id === repo.installId) ? repo.installId : usable[0]?.id ?? '')
  const [live, setLive] = useState<string[] | null>(null)
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null)
  const [log, setLog] = useState<LogEntry[] | null>(null)
  const [needs, setNeeds] = useState<AssetNeed[]>([])
  const [busy, setBusy] = useState(false)
  const [dirtyAsk, setDirtyAsk] = useState<string[] | null>(null)

  const check = async () => {
    if (!installId) return
    const r = await window.obsLoader.repos.live(repo.path, installId)
    setLive('error' in r ? null : r.changed)
  }
  useEffect(() => { void check() }, [installId, st.dirtyFiles.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.needs(repo.path).then(setNeeds).catch(() => setNeeds([])) }, [repo.path, st.behind])

  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }) } setBusy(false); await refresh() }

  const save = (commitDirty: boolean) => run(async () => {
    const r = await window.obsLoader.repos.save(repo.path, installId, commitDirty)
    if (r.status === 'dirty') { setDirtyAsk(r.files); return }
    setDirtyAsk(null)
    if (r.status === 'error') setMsg({ tone: 'bad', text: r.message })
    else if (r.status === 'unchanged') setMsg({ tone: 'good', text: 'Already up to date: OBS has nothing new.' })
    else if (r.status === 'conflict') setMsg({ tone: 'bad', text: `The repository and OBS both changed the same part of ${r.conflicts.join(', ')}. Nothing was changed. Apply the repository version to OBS or resolve it with git, then save again.` })
    else setMsg({ tone: 'good', text: `Saved (${r.files.length} file${r.files.length === 1 ? '' : 's'} changed)${r.merged ? ', and merged with newer changes that were already in the repository' : ''}.` })
    await check()
  })

  const pull = () => run(async () => {
    const r = await window.obsLoader.repos.pull(repo.path)
    const t: Record<string, { tone: 'good' | 'warn' | 'bad'; text: string }> = {
      'up-to-date': { tone: 'good', text: 'Already up to date.' },
      'no-remote': { tone: 'warn', text: 'This repository has no remote to pull from.' },
    }
    if (r.status === 'updated') setMsg({ tone: 'good', text: `Pulled ${r.files.length} changed file${r.files.length === 1 ? '' : 's'}. Use “Apply to OBS” to load them.` })
    else if (r.status === 'conflict') setMsg({ tone: 'bad', text: `The remote changed the same files as you (${r.conflicts.join(', ')}). Nothing was merged. Resolve it with git in the repository folder, then pull again.` })
    else if (r.status === 'dirty') setMsg({ tone: 'warn', text: `Save or commit your changes first (${r.files.length} file${r.files.length === 1 ? '' : 's'} have uncommitted edits).` })
    else if (r.status === 'error') setMsg({ tone: 'bad', text: r.message })
    else setMsg(t[r.status])
  })

  const push = () => run(async () => {
    const r = await window.obsLoader.repos.push(repo.path)
    setMsg(r.status === 'pushed' ? { tone: 'good', text: 'Pushed.' }
      : r.status === 'nothing' ? { tone: 'good', text: 'Nothing to push.' }
      : r.status === 'no-remote' ? { tone: 'warn', text: 'This repository has no remote. Add one with git remote add origin <url>.' }
      : { tone: 'bad', text: r.message })
  })

  return (
    <Card
      title={repo.name}
      right={<div className="flex gap-2 flex-wrap justify-end">
        {st.commits > 0 && <Chip>{st.commits} save{st.commits === 1 ? '' : 's'}</Chip>}
        {st.branch && <Chip>{st.branch}</Chip>}
        {st.ahead > 0 && <Chip tone="warn">{st.ahead} to push</Chip>}
        {st.behind > 0 && <Chip tone="warn">{st.behind} to pull</Chip>}
        {st.dirtyFiles.length > 0 && <Chip tone="warn">{st.dirtyFiles.length} edited outside the app</Chip>}
        {!st.remote && <Chip>local only</Chip>}
      </div>}
    >
      <p className="mono text-muted">{repo.path}</p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}

      {usable.length > 0 && (
        <Field label="Saved from and applied to">
          <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => { setInstallId(e.target.value); void window.obsLoader.repos.setInstall(repo.path, e.target.value) }}>
            {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
          </select>
        </Field>
      )}

      {live && live.length > 0 && <Message tone="warn">OBS has changes that are not in the repository yet: {live.join(', ')}.</Message>}
      {live && live.length === 0 && installId && <p className="text-sm text-muted">The repository matches OBS.</p>}
      {dirtyAsk && (
        <Message tone="warn">
          Files in the repository were edited outside this app ({dirtyAsk.join(', ')}). Saving OBS would overwrite them, so they must be committed first.
          <div className="mt-2 flex gap-2">
            <button className="btn btn-accent px-3 py-1" onClick={() => save(true)}>Commit them, then save OBS</button>
            <button className="btn btn-ghost px-3 py-1" onClick={() => setDirtyAsk(null)}>Cancel</button>
          </div>
        </Message>
      )}

      {needs.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold text-sm">Media this computer still needs</h3>
          {needs.map((n) => (
            <div key={n.id} className="bt-row flex items-center gap-3 py-1">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{n.filename} {n.reason === 'changed' && <Chip tone="warn">newer version in the repo</Chip>}</div>
                <div className="text-xs text-muted">{n.path ?? n.hint ?? 'Not chosen yet'}</div>
              </div>
              <button className="btn px-3 py-1" onClick={async () => {
                const f = await window.obsLoader.files.pick(`Find ${n.filename}`)
                if (f) { await window.obsLoader.repos.setAsset(repo.path, n.id, f); setNeeds(await window.obsLoader.repos.needs(repo.path)) }
              }}>{n.reason === 'changed' ? 'Choose again…' : 'Locate…'}</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-3 py-1.5" disabled={busy || !installId} onClick={() => save(false)}>Save OBS changes to the repo</button>
        <button className="btn px-3 py-1.5" disabled={busy} onClick={pull}>Pull</button>
        <button className="btn px-3 py-1.5" disabled={busy} onClick={push}>Push</button>
        <button className="btn px-3 py-1.5" disabled={busy} onClick={() => apply(repo.path, installId)}>Apply to OBS…</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={async () => setLog(log ? null : await window.obsLoader.repos.log(repo.path))}>{log ? 'Hide history' : 'History'}</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.repos.remove(repo.path); await refresh() }}>Remove from list</button>
      </div>

      {log && (
        <ul className="text-sm space-y-0.5">
          {log.map((l) => <li key={l.hash} className="bt-row py-0.5"><span className="mono text-muted">{l.hash}</span> {l.subject} <span className="text-muted">· {new Date(l.date).toLocaleString()}</span></li>)}
        </ul>
      )}
    </Card>
  )
}
