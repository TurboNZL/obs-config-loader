import { useEffect, useState } from 'react'
import type { AssetNeed, GithubRepo, GithubState, GitState, InstallInfo, LogEntry, PullResult, RepoInfo, SaveResult } from '../../../electron/api'
import { Card, Chip, Field, KIND_LABEL, Message, Page } from '../ui'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

export function ReposPage({ installs, applyRepo }: { installs: InstallInfo[] | null; applyRepo: (dir: string, installId?: string) => void }) {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [gh, setGh] = useState<GithubState>({ connected: false })
  const [notice, setNotice] = useState<Msg | null>(null)

  const refresh = () => window.obsLoader.repos.list().then(setRepos)
  const refreshGit = () => window.obsLoader.git.state().then(setGit)
  const refreshGh = () => window.obsLoader.github.state().then(setGh)
  useEffect(() => { void refresh(); void refreshGit(); void refreshGh() }, [])

  return (
    <Page
      title="Config repositories"
      intro="Keep a setup in git. Scenes and profiles are saved as plain files, big media as placeholders, and secrets never. Edits you make in OBS are saved into the repo before anything else changes it, so they are never reverted."
    >
      {git && !git.available && <GitMissing git={git} recheck={refreshGit} />}
      {notice && <Message tone={notice.tone}>{notice.text}</Message>}
      {repos?.length === 0 && git?.available && <Message tone="warn">No repositories yet. Start one from an OBS install below, or get one that already exists.</Message>}
      {repos?.map((r) => <RepoCard key={r.path} repo={r} installs={installs ?? []} gh={gh} refresh={refresh} apply={applyRepo} />)}

      {git?.available && (
        <>
          <NewRepo installs={installs ?? []} gh={gh} onDone={async (m) => { setNotice(m); await refresh() }} />
          <GetRepo gh={gh} repoCount={repos?.length ?? 0} onDone={async (m) => { setNotice(m); await refresh() }} />
        </>
      )}
      <GithubCard gh={gh} refresh={refreshGh} />
    </Page>
  )
}

// ── git is not installed ─────────────────────────────────────────────────────

function GitMissing({ git, recheck }: { git: GitState; recheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Card title="Git is needed">
      <p className="text-sm">Repositories use git, which is not installed on this computer yet.</p>
      {msg && <Message tone="warn">{msg}</Message>}
      <div className="flex gap-2 flex-wrap">
        {git.help.auto && (
          <button className="btn btn-accent px-3 py-1.5" disabled={busy} onClick={async () => {
            setBusy(true); setMsg(null)
            const r = await window.obsLoader.git.install()
            setBusy(false)
            if (!r.ok) setMsg(r.message)
            await recheck()
          }}>{busy ? 'Installing…' : git.help.auto.label}</button>
        )}
        <button className="btn px-3 py-1.5" onClick={() => void recheck()}>Check again</button>
      </div>
      <p className="text-sm text-muted">{git.help.manual}</p>
      {git.help.commandLine && <pre className="cmd mono rounded-theme">{git.help.commandLine}</pre>}
    </Card>
  )
}

// ── GitHub account ───────────────────────────────────────────────────────────

function GithubCard({ gh, refresh }: { gh: GithubState; refresh: () => Promise<void> }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Card title="GitHub account" right={gh.connected ? <Chip tone="good">{gh.login ? `signed in as ${gh.login}` : 'signed in'}</Chip> : <Chip>optional</Chip>}>
      {gh.connected ? (
        <>
          <p className="text-sm text-muted">
            You can create repositories on GitHub and pick from yours without leaving the app.
            {gh.sessionOnly && ' This computer has no system keychain, so the sign-in is only kept until you close the app.'}
          </p>
          <button className="btn px-3 py-1.5" onClick={async () => { await window.obsLoader.github.disconnect(); await refresh() }}>Sign out</button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Sign in to create repositories on GitHub and clone yours from a list. Without it, you can still use any git address your own git setup can reach.
          </p>
          <ol className="text-sm list-decimal pl-5 space-y-1">
            <li>
              <button className="btn px-2 py-0.5" onClick={() => window.obsLoader.app.openExternal(window.obsLoader.github.tokenUrl)}>Open GitHub's token page</button>
              {' '}and press <strong>Generate token</strong> (the right permission is already ticked).
            </li>
            <li>Copy the token it shows and paste it here.</li>
          </ol>
          <div className="flex gap-2">
            <input className="input flex-1 px-2 py-1.5" type="password" autoComplete="off" placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub token" />
            <button className="btn btn-accent px-3" disabled={busy || !token.trim()} onClick={async () => {
              setBusy(true); setError(null)
              const r = await window.obsLoader.github.connect(token)
              setBusy(false)
              if (r.ok) { setToken(''); await refresh() } else setError(r.error)
            }}>{busy ? 'Checking…' : 'Sign in'}</button>
          </div>
          {error && <Message tone="bad">{error}</Message>}
        </>
      )}
    </Card>
  )
}

// ── start a new repository from an OBS install ───────────────────────────────

function FolderField({ folder, setFolder }: { folder: string; setFolder: (f: string) => void }) {
  return (
    <Field label="Where on this computer" hint="A new folder is made here if it does not exist.">
      <div className="flex gap-2">
        <input className="input flex-1 px-2 py-1.5 mono" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <button className="btn px-3" onClick={async () => { const p = await window.obsLoader.files.pick('Choose a folder', true); if (p) setFolder(p) }}>Browse…</button>
      </div>
    </Field>
  )
}

function NewRepo({ installs, gh, onDone }: { installs: InstallInfo[]; gh: GithubState; onDone: (m: Msg) => Promise<void> }) {
  const usable = installs.filter((i) => i.configExists)
  const [name, setName] = useState('My OBS setup')
  const [installId, setInstallId] = useState('')
  const [folder, setFolder] = useState('')
  const [onGithub, setOnGithub] = useState(false)
  const [priv, setPriv] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!installId && usable[0]) setInstallId(usable[0].id) }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.suggestFolder(name || 'obs-setup').then(setFolder) }, [name])
  if (usable.length === 0) return null

  return (
    <Card title="Start a new repository from an OBS install">
      {error && <Message tone="bad">{error}</Message>}
      <Field label="Name"><input className="input w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Save the setup of">
        <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)}>
          {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
        </select>
      </Field>
      <FolderField folder={folder} setFolder={setFolder} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onGithub && gh.connected} disabled={!gh.connected} onChange={(e) => setOnGithub(e.target.checked)} />
        Also create it on GitHub{!gh.connected && <span className="text-muted"> (sign in to GitHub below to turn this on)</span>}
      </label>
      {onGithub && gh.connected && (
        <label className="flex items-center gap-2 text-sm pl-6"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Keep it private</label>
      )}
      <button className="btn btn-accent px-4 py-2" disabled={busy || !name.trim() || !installId || !folder} onClick={async () => {
        setBusy(true); setError(null)
        const r = await window.obsLoader.repos.create({ installId, name: name.trim(), folder, github: onGithub && gh.connected ? { private: priv } : undefined })
        setBusy(false)
        if (r.ok) await onDone({ tone: 'good', text: `Created “${r.repo.name}”${r.published ? ` and published it at ${r.published}` : ''}.` })
        else setError(r.error)
      }}>{busy ? 'Creating…' : 'Create'}</button>
    </Card>
  )
}

// ── get one that already exists ──────────────────────────────────────────────

function GetRepo({ gh, repoCount, onDone }: { gh: GithubState; repoCount: number; onDone: (m: Msg) => Promise<void> }) {
  const [url, setUrl] = useState('')
  const [folder, setFolder] = useState('')
  const [mine, setMine] = useState<GithubRepo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMine = () => {
    if (!gh.connected) { setMine(null); return }
    void window.obsLoader.github.repos().then((r) => setMine(r.ok ? r.repos : null))
  }
  // reload when the sign-in changes, and whenever a repository was added here (it may have created one on GitHub)
  useEffect(loadMine, [gh.connected, repoCount]) // eslint-disable-line react-hooks/exhaustive-deps
  // suggest a folder named after the repository
  useEffect(() => {
    const n = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop()?.replace(/\.git$/i, '') || 'obs-setup'
    void window.obsLoader.repos.suggestFolder(n).then(setFolder)
  }, [url])

  return (
    <Card title="Get a repository that already exists">
      {error && <Message tone="bad">{error}</Message>}
      {mine && mine.length > 0 && (
        <Field label="From your GitHub" hint={<button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={loadMine}>Refresh the list</button>}>
          <select className="input w-full px-2 py-1.5" value={mine.find((m) => m.cloneUrl === url)?.cloneUrl ?? ''} onChange={(e) => setUrl(e.target.value)}>
            <option value="">Choose one…</option>
            {mine.map((m) => <option key={m.cloneUrl} value={m.cloneUrl}>{m.fullName}{m.private ? ' (private)' : ''}</option>)}
          </select>
        </Field>
      )}
      <Field label="Or a git address" hint="Any address your computer's git can reach (https, ssh, or a folder on a network drive).">
        <input className="input w-full px-2 py-1.5" placeholder="https://github.com/you/my-obs-setup.git" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <FolderField folder={folder} setFolder={setFolder} />
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-4 py-2" disabled={busy || !url.trim() || !folder} onClick={async () => {
          setBusy(true); setError(null)
          const r = await window.obsLoader.repos.clone(url, folder)
          setBusy(false)
          if (r.ok) { setUrl(''); await onDone({ tone: 'good', text: `Downloaded “${r.repo.name}”. Use “Apply to OBS” to load it.` }) } else setError(r.error)
        }}>{busy ? 'Downloading…' : 'Download'}</button>
        <button className="btn px-3 py-2" onClick={async () => {
          setError(null)
          const r = await window.obsLoader.repos.addExisting()
          if (r.ok) await onDone({ tone: 'good', text: `Added “${r.repo.name}”.` }); else if (!r.cancelled) setError(r.error)
        }}>I already have the folder…</button>
      </div>
    </Card>
  )
}

// ── one repository ───────────────────────────────────────────────────────────

type Pending = { kind: 'save'; files: string[] } | { kind: 'pull'; files: string[] } | null

function RepoCard({ repo, installs, gh, refresh, apply }: { repo: RepoInfo; installs: InstallInfo[]; gh: GithubState; refresh: () => Promise<void>; apply: (dir: string, installId?: string) => void }) {
  const st = repo.status
  const usable = installs.filter((i) => i.configExists)
  const [installId, setInstallId] = useState(repo.installId && usable.some((i) => i.id === repo.installId) ? repo.installId : usable[0]?.id ?? '')
  const [live, setLive] = useState<string[] | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [log, setLog] = useState<LogEntry[] | null>(null)
  const [needs, setNeeds] = useState<AssetNeed[]>([])
  const [busy, setBusy] = useState(false)
  const [dirtyAsk, setDirtyAsk] = useState<string[] | null>(null)
  const [conflict, setConflict] = useState<Pending>(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [pubName, setPubName] = useState(repo.name)
  const [pubPriv, setPubPriv] = useState(true)
  const [editRemote, setEditRemote] = useState(false)

  const check = async () => {
    if (!installId) return
    const r = await window.obsLoader.repos.live(repo.path, installId)
    setLive('error' in r ? null : r.changed)
  }
  useEffect(() => { void check() }, [installId, st.dirtyFiles.length, st.commits]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.needs(repo.path).then(setNeeds).catch(() => setNeeds([])) }, [repo.path, st.behind])

  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }) } setBusy(false); await refresh() }

  const showSave = (r: SaveResult) => {
    if (r.status === 'dirty') { setDirtyAsk(r.files); return }
    setDirtyAsk(null); setConflict(null)
    if (r.status === 'error') setMsg({ tone: 'bad', text: r.message })
    else if (r.status === 'conflict') { setConflict({ kind: 'save', files: r.conflicts }); setMsg(null) }
    else if (r.status === 'unchanged') setMsg({ tone: 'good', text: 'Already up to date: OBS has nothing new.' })
    else setMsg({ tone: 'good', text: `Saved (${r.files.length} file${r.files.length === 1 ? '' : 's'} changed)${r.merged ? ', and merged with newer changes that were already in the repository' : ''}.` })
  }
  const save = (commitDirty: boolean, onConflict?: 'abort' | 'keep-repo' | 'keep-obs') => run(async () => {
    showSave(await window.obsLoader.repos.save(repo.path, installId, commitDirty, onConflict))
    await check()
  })

  const showPull = (r: PullResult) => {
    setConflict(null)
    if (r.status === 'updated') setMsg({ tone: 'good', text: `Pulled ${r.files.length} changed file${r.files.length === 1 ? '' : 's'}. Use “Apply to OBS” to load them.` })
    else if (r.status === 'conflict') { setConflict({ kind: 'pull', files: r.conflicts }); setMsg(null) }
    else if (r.status === 'dirty') setMsg({ tone: 'warn', text: `Save your changes first (${r.files.length} file${r.files.length === 1 ? ' has' : 's have'} uncommitted edits). Use “Save OBS changes to the repo”.` })
    else if (r.status === 'error') setMsg({ tone: 'bad', text: r.message })
    else if (r.status === 'no-remote') setMsg({ tone: 'warn', text: 'This repository has no online address yet. Add one below.' })
    else setMsg({ tone: 'good', text: 'Already up to date.' })
  }
  const pull = (onConflict?: 'abort' | 'keep-mine' | 'keep-theirs') => run(async () => showPull(await window.obsLoader.repos.pull(repo.path, onConflict)))

  const push = () => run(async () => {
    const r = await window.obsLoader.repos.push(repo.path)
    setMsg(r.status === 'pushed' ? { tone: 'good', text: 'Pushed.' }
      : r.status === 'nothing' ? { tone: 'good', text: 'Nothing to push.' }
      : r.status === 'no-remote' ? { tone: 'warn', text: 'This repository has no online address yet. Add one below.' }
      : { tone: 'bad', text: r.message })
  })

  const saveRemote = () => run(async () => {
    const r = await window.obsLoader.repos.setRemote(repo.path, remoteUrl)
    if (r.ok) { setEditRemote(false); setRemoteUrl(''); setMsg({ tone: 'good', text: 'Address saved. Use Push to upload.' }) } else setMsg({ tone: 'bad', text: r.error })
  })
  const publish = () => run(async () => {
    const r = await window.obsLoader.repos.publish(repo.path, pubName, pubPriv)
    setMsg(r.ok ? { tone: 'good', text: `Published at ${r.url}.` } : { tone: 'bad', text: r.error })
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
        {!st.remote && <Chip>not online yet</Chip>}
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
            <button className="btn btn-accent px-3 py-1" onClick={() => save(true)}>Keep those edits, then save OBS</button>
            <button className="btn btn-ghost px-3 py-1" onClick={() => setDirtyAsk(null)}>Cancel</button>
          </div>
        </Message>
      )}

      {conflict && (
        <Message tone="bad">
          {conflict.kind === 'save'
            ? <>The repository and OBS both changed the same lines of {conflict.files.join(', ')}. Everything else merges fine; choose whose version wins for just those lines.</>
            : <>You and the online copy both changed the same lines of {conflict.files.join(', ')}. Everything else merges fine; choose whose version wins for just those lines.</>}
          <div className="mt-2 flex gap-2 flex-wrap">
            {conflict.kind === 'save' ? (
              <>
                <button className="btn btn-accent px-3 py-1" disabled={busy} onClick={() => save(false, 'keep-repo')}>Keep the repository's version</button>
                <button className="btn px-3 py-1" disabled={busy} onClick={() => save(false, 'keep-obs')}>Keep OBS's version</button>
              </>
            ) : (
              <>
                <button className="btn btn-accent px-3 py-1" disabled={busy} onClick={() => pull('keep-mine')}>Keep mine</button>
                <button className="btn px-3 py-1" disabled={busy} onClick={() => pull('keep-theirs')}>Take the online version</button>
              </>
            )}
            <button className="btn btn-ghost px-3 py-1" onClick={() => setConflict(null)}>Cancel</button>
          </div>
          <p className="text-xs text-muted mt-1">Nothing has been changed yet. Earlier saves stay in History either way.</p>
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
        <button className="btn px-3 py-1.5" disabled={busy || !st.remote} onClick={() => pull()}>Pull</button>
        <button className="btn px-3 py-1.5" disabled={busy || !st.remote} onClick={push}>Push</button>
        <button className="btn px-3 py-1.5" disabled={busy} onClick={() => apply(repo.path, installId)}>Apply to OBS…</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={async () => setLog(log ? null : await window.obsLoader.repos.log(repo.path))}>{log ? 'Hide history' : 'History'}</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={() => window.obsLoader.repos.openFolder(repo.path)}>Open folder</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.repos.remove(repo.path); await refresh() }}>Remove from list</button>
      </div>

      {/* where it lives online */}
      <div className="border-t border-line pt-3 space-y-2">
        <h3 className="font-semibold text-sm">Online copy</h3>
        {repo.remoteUrl && !editRemote ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono">{repo.remoteUrl}</span>
            <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => { setRemoteUrl(repo.remoteUrl ?? ''); setEditRemote(true) }}>Change</button>
          </div>
        ) : (
          <>
            {!repo.remoteUrl && <p className="text-sm text-muted">This repository only exists on this computer. Put a copy online to back it up and use it on other machines.</p>}
            {gh.connected && !repo.remoteUrl && (
              <div className="flex gap-2 flex-wrap items-center">
                <input className="input px-2 py-1.5 flex-1 min-w-40" value={pubName} onChange={(e) => setPubName(e.target.value)} aria-label="Name on GitHub" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pubPriv} onChange={(e) => setPubPriv(e.target.checked)} /> Private</label>
                <button className="btn btn-accent px-3 py-1.5" disabled={busy || !pubName.trim()} onClick={publish}>Publish to GitHub</button>
              </div>
            )}
            <div className="flex gap-2">
              <input className="input flex-1 px-2 py-1.5" placeholder="Or paste an address: https://…/my-setup.git" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} aria-label="Repository address" />
              <button className="btn px-3" disabled={busy || !remoteUrl.trim()} onClick={saveRemote}>Save address</button>
              {editRemote && <button className="btn btn-ghost px-3" onClick={() => setEditRemote(false)}>Cancel</button>}
            </div>
            {!gh.connected && !repo.remoteUrl && <p className="text-xs text-muted">Sign in to GitHub below to publish in one click.</p>}
          </>
        )}
      </div>

      {log && (
        <ul className="text-sm space-y-0.5">
          {log.map((l) => <li key={l.hash} className="bt-row py-0.5"><span className="mono text-muted">{l.hash}</span> {l.subject} <span className="text-muted">· {new Date(l.date).toLocaleString()}</span></li>)}
        </ul>
      )}
    </Card>
  )
}
