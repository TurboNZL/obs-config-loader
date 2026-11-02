import { useEffect, useState } from 'react'
import type { AssetNeed, GithubRepo, GithubState, GitState, InstallInfo, LogEntry, PresetDetails, PullResult, RenameRequest, RepoInfo, SaveResult } from '../../../electron/api'
import { Card, Chip, Choice, Field, KIND_LABEL, Message, Page } from '../ui'
import { GitMissing } from '../components/Account'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }
export type PresetsGo = (t: 'settings' | 'export' | 'import') => void

export function PresetsPage({ installs, applyRepo, go }: { installs: InstallInfo[] | null; applyRepo: (dir: string, installId?: string) => void; go: PresetsGo }) {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [gh, setGh] = useState<GithubState>({ connected: false })
  const [notice, setNotice] = useState<Msg | null>(null)
  const [adding, setAdding] = useState<'new' | 'get' | null>(null)

  const refresh = () => window.obsLoader.repos.list().then(setRepos)
  const refreshGit = () => window.obsLoader.git.state().then(setGit)
  useEffect(() => { void refresh(); void refreshGit(); void window.obsLoader.github.state().then(setGh) }, [])

  const done = async (m: Msg) => { setNotice(m); setAdding(null); await refresh() }

  return (
    <Page
      title="Presets"
      intro="A preset is a saved copy of your OBS setup: scenes, output settings and plugin list. Load it into OBS whenever you like, save it to a file, or switch on online backup to keep it safe on GitHub."
    >
      {git && !git.available && <GitMissing git={git} recheck={refreshGit} />}
      {notice && <Message tone={notice.tone}>{notice.text}</Message>}

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-4 py-2" disabled={!git?.available} onClick={() => setAdding(adding === 'new' ? null : 'new')}>New preset from my OBS</button>
        <button className="btn px-3 py-2" disabled={!git?.available} onClick={() => setAdding(adding === 'get' ? null : 'get')}>Get one from GitHub…</button>
        <button className="btn px-3 py-2" onClick={() => go('import')}>Open a setup file…</button>
        <button className="btn btn-ghost px-3 py-2" onClick={() => go('export')}>Save a file straight from OBS…</button>
      </div>

      {adding === 'new' && git?.available && <NewPreset installs={installs ?? []} gh={gh} go={go} onDone={done} onCancel={() => setAdding(null)} />}
      {adding === 'get' && git?.available && <GetPreset gh={gh} count={repos?.length ?? 0} go={go} onDone={done} onCancel={() => setAdding(null)} />}

      {repos?.length === 0 && !adding && <Message tone="warn">You have no presets yet. Press “New preset from my OBS” to make your first one.</Message>}
      {repos?.map((r) => <PresetCard key={r.path} repo={r} installs={installs ?? []} gh={gh} refresh={refresh} apply={applyRepo} go={go} />)}
    </Page>
  )
}

// ── a new preset from an OBS on this computer ────────────────────────────────

function FolderField({ folder, setFolder }: { folder: string; setFolder: (f: string) => void }) {
  return (
    <Field label="Folder for this preset" hint="Made for you inside your presets folder (see Settings). Change it only if you want it somewhere else.">
      <div className="flex gap-2">
        <input className="input flex-1 px-2 py-1.5 mono" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <button className="btn px-3" onClick={async () => { const p = await window.obsLoader.files.pick('Choose a folder', true); if (p) setFolder(p) }}>Browse…</button>
      </div>
    </Field>
  )
}

function NewPreset({ installs, gh, go, onDone, onCancel }: { installs: InstallInfo[]; gh: GithubState; go: PresetsGo; onDone: (m: Msg) => Promise<void>; onCancel: () => void }) {
  const usable = installs.filter((i) => i.configExists)
  const [name, setName] = useState('My OBS setup')
  const [installId, setInstallId] = useState('')
  const [folder, setFolder] = useState('')
  const [online, setOnline] = useState(false)
  const [priv, setPriv] = useState(true)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!installId && usable[0]) setInstallId(usable[0].id) }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.suggestFolder(name || 'obs-setup').then(setFolder) }, [name])
  if (usable.length === 0) return <Message tone="warn">There is no OBS setup on this computer to copy yet. Open OBS once, or add OBS under “OBS on this computer”.</Message>

  return (
    <Card title="New preset from my OBS">
      {error && <Message tone="bad">{error}</Message>}
      <Field label="Name"><input className="input w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {usable.length > 1 && (
        <Field label="Copy the setup of">
          <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)}>
            {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
          </select>
        </Field>
      )}
      <Choice
        checked={online && gh.connected} disabled={!gh.connected} onChange={setOnline}
        title="Back it up online (GitHub)"
        help={gh.connected ? 'Every save is also kept on GitHub, so you can use it on other computers.' : <>Sign in to GitHub in <button className="underline" onClick={() => go('settings')}>Settings</button> to turn this on.</>}
      />
      {online && gh.connected && <Choice checked={priv} onChange={setPriv} title="Keep it private" help="Only you can see it on GitHub." />}
      <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setMore(!more)}>{more ? 'Hide details' : 'Show details'}</button>
      {more && <FolderField folder={folder} setFolder={setFolder} />}
      <div className="flex gap-2">
        <button className="btn btn-accent px-4 py-2" disabled={busy || !name.trim() || !installId || !folder} onClick={async () => {
          setBusy(true); setError(null)
          const r = await window.obsLoader.repos.create({ installId, name: name.trim(), folder, github: online && gh.connected ? { private: priv } : undefined })
          setBusy(false)
          if (r.ok) await onDone({ tone: 'good', text: `Saved the preset “${r.repo.name}”${r.published ? ` and backed it up at ${r.published}` : ''}.` })
          else setError(r.error)
        }}>{busy ? 'Saving…' : 'Save preset'}</button>
        <button className="btn btn-ghost px-3 py-2" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  )
}

// ── get one that already exists online ───────────────────────────────────────

function GetPreset({ gh, count, go, onDone, onCancel }: { gh: GithubState; count: number; go: PresetsGo; onDone: (m: Msg) => Promise<void>; onCancel: () => void }) {
  const [url, setUrl] = useState('')
  const [folder, setFolder] = useState('')
  const [mine, setMine] = useState<GithubRepo[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMine = () => {
    if (!gh.connected) { setMine(null); return }
    void window.obsLoader.github.repos().then((r) => setMine(r.ok ? r.repos : null))
  }
  useEffect(loadMine, [gh.connected, count]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const n = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop()?.replace(/\.git$/i, '') || 'obs-setup'
    void window.obsLoader.repos.suggestFolder(n).then(setFolder)
  }, [url])

  return (
    <Card title="Get a preset from GitHub">
      {error && <Message tone="bad">{error}</Message>}
      {!gh.connected && <p className="text-sm text-muted">Sign in to GitHub in <button className="underline" onClick={() => go('settings')}>Settings</button> to pick from your own list. Or paste any address below.</p>}
      {mine && mine.length > 0 && (
        <Field label="From your GitHub" hint={<button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={loadMine}>Refresh the list</button>}>
          <select className="input w-full px-2 py-1.5" value={mine.find((m) => m.cloneUrl === url)?.cloneUrl ?? ''} onChange={(e) => setUrl(e.target.value)}>
            <option value="">Choose one…</option>
            {mine.map((m) => <option key={m.cloneUrl} value={m.cloneUrl}>{m.fullName}{m.private ? ' (private)' : ''}</option>)}
          </select>
        </Field>
      )}
      <Field label="Or an address" hint="Any address your computer's git can reach (https, ssh, or a folder on a network drive).">
        <input className="input w-full px-2 py-1.5" placeholder="https://github.com/you/my-obs-setup.git" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setMore(!more)}>{more ? 'Hide details' : 'Show details'}</button>
      {more && <FolderField folder={folder} setFolder={setFolder} />}
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-4 py-2" disabled={busy || !url.trim() || !folder} onClick={async () => {
          setBusy(true); setError(null)
          const r = await window.obsLoader.repos.clone(url, folder)
          setBusy(false)
          if (r.ok) await onDone({ tone: 'good', text: `Downloaded “${r.repo.name}”. Press “Load into OBS” on it to use it.` }); else setError(r.error)
        }}>{busy ? 'Downloading…' : 'Download'}</button>
        <button className="btn px-3 py-2" onClick={async () => {
          setError(null)
          const r = await window.obsLoader.repos.addExisting()
          if (r.ok) await onDone({ tone: 'good', text: `Added “${r.repo.name}”.` }); else if (!r.cancelled) setError(r.error)
        }}>I already have the folder…</button>
        <button className="btn btn-ghost px-3 py-2" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  )
}

// ── renaming ────────────────────────────────────────────────────────────────

function RenameRow({ label, value, onRename, indent }: { label?: string; value: string; onRename: (to: string) => Promise<string | null>; indent?: boolean }) {
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

function Details({ repo, installId, refresh, obsNote }: { repo: RepoInfo; installId: string; refresh: () => Promise<void>; obsNote: boolean }) {
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

// ── one preset ───────────────────────────────────────────────────────────────

type Pending = { kind: 'save'; files: string[] } | { kind: 'pull'; files: string[] } | null

function PresetCard({ repo, installs, gh, refresh, apply, go }: { repo: RepoInfo; installs: InstallInfo[]; gh: GithubState; refresh: () => Promise<void>; apply: (dir: string, installId?: string) => void; go: PresetsGo }) {
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
  const [editRemote, setEditRemote] = useState(false)
  const [priv, setPriv] = useState(true)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [withKeys, setWithKeys] = useState(false)
  const [keys, setKeys] = useState({ count: 0, canStore: true })
  const online = !!repo.remoteUrl

  const check = async () => {
    if (!installId) return
    const r = await window.obsLoader.repos.live(repo.path, installId)
    setLive('error' in r ? null : r.changed)
  }
  useEffect(() => { void check() }, [installId, st.dirtyFiles.length, st.commits]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.needs(repo.path).then(setNeeds).catch(() => setNeeds([])) }, [repo.path, st.behind])
  useEffect(() => { void window.obsLoader.presets.keys(repo.path).then(setKeys) }, [repo.path, st.commits])

  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }) } setBusy(false); await refresh() }

  const showSave = (r: SaveResult) => {
    if (r.status === 'dirty') { setDirtyAsk(r.files); return }
    setDirtyAsk(null); setConflict(null)
    if (r.status === 'error') { setMsg({ tone: 'bad', text: r.message }); return }
    if (r.status === 'conflict') { setConflict({ kind: 'save', files: r.conflicts }); setMsg(null); return }
    const extra = [
      r.keysRemembered ? `${r.keysRemembered} stream key${r.keysRemembered === 1 ? '' : 's'} remembered on this computer` : '',
      r.upload === 'uploaded' ? 'backed up online' : '',
    ].filter(Boolean).join('; ')
    if (r.upload === 'failed') setMsg({ tone: 'warn', text: `Saved here, but it could not be uploaded: ${r.uploadError}` })
    else if (r.status === 'unchanged') setMsg({ tone: 'good', text: `Already up to date: OBS has nothing new.${extra ? ' (' + extra + ')' : ''}` })
    else setMsg({ tone: 'good', text: `Saved${r.merged ? ' and combined with newer changes that were already in the preset' : ''}${extra ? '; ' + extra : ''}.` })
  }
  const save = (commitDirty: boolean, onConflict?: 'abort' | 'keep-repo' | 'keep-obs') => run(async () => {
    showSave(await window.obsLoader.repos.save(repo.path, installId, commitDirty, onConflict))
    await check()
  })

  const showPull = (r: PullResult) => {
    setConflict(null)
    if (r.status === 'updated') setMsg({ tone: 'good', text: `Got ${r.files.length} changed file${r.files.length === 1 ? '' : 's'}. Press “Load into OBS” to use them.` })
    else if (r.status === 'conflict') { setConflict({ kind: 'pull', files: r.conflicts }); setMsg(null) }
    else if (r.status === 'dirty') setMsg({ tone: 'warn', text: `Save your changes first (${r.files.length} file${r.files.length === 1 ? ' was' : 's were'} changed by hand). Use “Save OBS to this preset”.` })
    else if (r.status === 'error') setMsg({ tone: 'bad', text: r.message })
    else if (r.status === 'no-remote') setMsg({ tone: 'warn', text: 'This preset is not backed up online yet.' })
    else setMsg({ tone: 'good', text: 'Already up to date.' })
  }
  const pull = (onConflict?: 'abort' | 'keep-mine' | 'keep-theirs') => run(async () => showPull(await window.obsLoader.repos.pull(repo.path, onConflict)))
  const push = () => run(async () => {
    const r = await window.obsLoader.repos.push(repo.path)
    setMsg(r.status === 'pushed' ? { tone: 'good', text: 'Uploaded.' } : r.status === 'nothing' ? { tone: 'good', text: 'Nothing new to upload.' }
      : r.status === 'no-remote' ? { tone: 'warn', text: 'This preset is not backed up online yet.' } : { tone: 'bad', text: r.message })
  })

  const toggleOnline = (on: boolean) => run(async () => {
    const r = await window.obsLoader.presets.setOnline(repo.path, on, repo.name, priv)
    if (r.ok) setMsg({ tone: 'good', text: on ? (r.url ? `Backed up online at ${r.url}.` : 'Backed up online.') : 'Online backup is off for this preset. What is already on GitHub stays there.' })
    else setMsg({ tone: 'warn', text: r.error })
  })
  const saveRemote = () => run(async () => {
    const r = await window.obsLoader.repos.setRemote(repo.path, remoteUrl)
    if (r.ok) { setEditRemote(false); setRemoteUrl(''); setMsg({ tone: 'good', text: 'Address saved. Use Upload to send it.' }) } else setMsg({ tone: 'bad', text: r.error })
  })
  const exportFile = () => run(async () => {
    const r = await window.obsLoader.presets.exportFile(repo.path, withKeys)
    if (r.ok) {
      setExporting(false); setWithKeys(false)
      setMsg({ tone: r.keys ? 'warn' : 'good', text: `Saved the file${r.keys ? ` with ${r.keys} stream key${r.keys === 1 ? '' : 's'} inside. Treat it like a password: anyone with it can stream as you` : ''}.${r.missingMedia.length ? ` ${r.missingMedia.length} big file${r.missingMedia.length === 1 ? ' is' : 's are'} not inside (${r.missingMedia.slice(0, 3).join(', ')}${r.missingMedia.length > 3 ? '…' : ''}); the other computer will ask for them.` : ''}` })
    } else if (!r.cancelled) setMsg({ tone: 'bad', text: r.error })
  })

  return (
    <Card
      title={repo.name}
      right={<div className="flex gap-2 flex-wrap justify-end">
        <Chip tone={online ? 'good' : undefined}>{online ? 'backed up online' : 'only on this computer'}</Chip>
        {st.ahead > 0 && <Chip tone="warn">{st.ahead} to upload</Chip>}
        {st.behind > 0 && <Chip tone="warn">{st.behind} to download</Chip>}
        {st.dirtyFiles.length > 0 && <Chip tone="warn">{st.dirtyFiles.length} changed by hand</Chip>}
      </div>}
    >
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}

      {live && live.length > 0 && <Message tone="warn">OBS has changes that are not in this preset yet. Press “Save OBS to this preset” to keep them.</Message>}
      {live && live.length === 0 && installId && <p className="text-sm text-muted">This preset matches your OBS.</p>}

      {dirtyAsk && (
        <Message tone="warn">
          Some files in the preset were changed by hand ({dirtyAsk.join(', ')}). Saving OBS would overwrite them, so they need to be kept first.
          <div className="mt-2 flex gap-2">
            <button className="btn btn-accent px-3 py-1" onClick={() => save(true)}>Keep those edits, then save OBS</button>
            <button className="btn btn-ghost px-3 py-1" onClick={() => setDirtyAsk(null)}>Cancel</button>
          </div>
        </Message>
      )}

      {conflict && (
        <Message tone="bad">
          {conflict.kind === 'save'
            ? <>The preset and OBS both changed the same part of {conflict.files.join(', ')}. Everything else combines fine; choose whose version to keep for just that part.</>
            : <>You and the online copy both changed the same part of {conflict.files.join(', ')}. Everything else combines fine; choose whose version to keep for just that part.</>}
          <div className="mt-2 flex gap-2 flex-wrap">
            {conflict.kind === 'save' ? (
              <>
                <button className="btn btn-accent px-3 py-1" disabled={busy} onClick={() => save(false, 'keep-repo')}>Keep the preset's version</button>
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
          <h3 className="font-semibold text-sm">Big files this computer still needs</h3>
          {needs.map((n) => (
            <div key={n.id} className="bt-row flex items-center gap-3 py-1">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{n.filename} {n.reason === 'changed' && <Chip tone="warn">newer version in the preset</Chip>}</div>
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
        <button className="btn btn-accent px-3 py-1.5" disabled={busy || !installId} onClick={() => save(false)}>Save OBS to this preset</button>
        <button className="btn px-3 py-1.5" disabled={busy} onClick={() => apply(repo.path, installId)}>Load into OBS…</button>
        <button className="btn px-3 py-1.5" disabled={busy} onClick={() => setExporting(!exporting)}>Save to a file…</button>
      </div>

      {exporting && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm">This makes one file you can copy to another computer.</p>
          <Choice
            checked={withKeys} onChange={setWithKeys} disabled={keys.count === 0}
            title={keys.count ? `Include my stream keys (${keys.count} remembered on this computer)` : 'Include my stream keys'}
            help={keys.count ? undefined : keys.canStore ? 'None are remembered yet. Press “Save OBS to this preset” first, and they will be.' : 'This computer has no system keychain, so keys cannot be remembered.'}
          />
          {withKeys && <Message tone="bad">The file will contain your stream keys. Anyone who has it can stream as you. Keep it private, and delete it once you have loaded it.</Message>}
          <div className="flex gap-2">
            <button className="btn btn-accent px-3 py-1.5" disabled={busy} onClick={exportFile}>Choose where to save…</button>
            <button className="btn btn-ghost px-3 py-1.5" onClick={() => setExporting(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="border-t border-line pt-3 space-y-2">
        <Choice
          checked={online} disabled={busy} onChange={(on) => toggleOnline(on)}
          title="Back up online"
          help={online ? 'Every save is uploaded to GitHub automatically, so this preset is safe and you can use it on your other computers.' : gh.connected ? 'Keeps a copy on GitHub, updated whenever you save.' : undefined}
        />
        {!online && gh.connected && <Choice checked={priv} onChange={setPriv} title="Keep it private" help="Only you can see it on GitHub. Choose before switching backup on." />}
        {!online && !gh.connected && <p className="text-sm text-muted">To switch this on, sign in to GitHub in <button className="underline" onClick={() => go('settings')}>Settings</button> first.</p>}
        {online && (
          <div className="flex gap-2 flex-wrap">
            <button className="btn px-3 py-1" disabled={busy} onClick={() => pull()}>Get updates</button>
            <button className="btn px-3 py-1" disabled={busy} onClick={push}>Upload now</button>
          </div>
        )}
      </div>

      <div>
        <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Show details'}</button>
      </div>
      {open && (
        <div className="space-y-4">
          {usable.length > 1 && (
            <Field label="This preset belongs to">
              <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => { setInstallId(e.target.value); void window.obsLoader.repos.setInstall(repo.path, e.target.value) }}>
                {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
              </select>
            </Field>
          )}
          <Details repo={repo} installId={installId} refresh={refresh} obsNote />
          <div className="space-y-1">
            <h3 className="font-semibold text-sm">Where it is</h3>
            <p className="mono text-muted">{repo.path}</p>
            {repo.remoteUrl && !editRemote ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="mono">{repo.remoteUrl}</span>
                <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => { setRemoteUrl(repo.remoteUrl ?? ''); setEditRemote(true) }}>Change</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className="input flex-1 px-2 py-1.5" placeholder="Use another online address: https://github.com/you/my-setup.git" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} aria-label="Online address" />
                <button className="btn px-3" disabled={busy || !remoteUrl.trim()} onClick={saveRemote}>Save address</button>
                {editRemote && <button className="btn btn-ghost px-3" onClick={() => setEditRemote(false)}>Cancel</button>}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-ghost px-3 py-1.5" onClick={async () => setLog(log ? null : await window.obsLoader.repos.log(repo.path))}>{log ? 'Hide history' : 'History'}</button>
            <button className="btn btn-ghost px-3 py-1.5" onClick={() => window.obsLoader.repos.openFolder(repo.path)}>Open folder</button>
            <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.repos.remove(repo.path); await refresh() }}>Remove from list</button>
          </div>
          {log && (
            <ul className="text-sm space-y-0.5">
              {log.map((l) => <li key={l.hash} className="bt-row py-0.5"><span className="mono text-muted">{l.hash}</span> {l.subject} <span className="text-muted">· {new Date(l.date).toLocaleString()}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
