import { useEffect, useState } from 'react'
import type { AssetNeed, ChangeDetail, GithubState, InstallInfo, LogEntry, OnlineComparison, PresetOverview, PullResult, RepoInfo, SaveResult } from '../../../electron/api'
import { Chip, Choice, Field, IconButton, KIND_LABEL, KindPanel, Message, plural, size } from '../ui'
import { Icon } from './Icon'
import { DiffView } from './DiffView'
import { ExportPanel } from './ExportPanel'
import { StoragePanel } from './StoragePanel'
import { Details, RenameOnline, type Msg } from './PresetDetails'

type Pending = { kind: 'save'; files: string[] } | { kind: 'pull'; files: string[] } | null

/** One preset as a tile: what is in it, how it stands against the linked OBS (this computer) and against GitHub, and what you can do. */
export function PresetTile({ repo, installs, gh, refresh, apply, go, notify, wide, onWide }: {
  repo: RepoInfo; installs: InstallInfo[]; gh: GithubState; refresh: () => Promise<void>
  apply: (dir: string, installId?: string) => void; go: (t: 'settings' | 'import') => void; notify: (m: Msg) => void
  /** The tile needs the whole row (its panels are open). */
  wide: boolean; onWide: (on: boolean) => void
}) {
  const st = repo.status
  const usable = installs.filter((i) => i.configExists)
  const linkedInstall = repo.installId ? installs.find((i) => i.id === repo.installId) : undefined
  const linkedId = linkedInstall?.configExists ? linkedInstall.id : undefined
  const obsName = linkedInstall?.label ?? 'OBS'
  const [live, setLive] = useState<string[] | null>(null)
  const [details, setDetails] = useState<ChangeDetail[] | undefined>()
  const [pending, setPending] = useState<string[] | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkTo, setLinkTo] = useState('')
  const [ghName, setGhName] = useState(repo.name.replace(/^obs-config-/i, ''))
  const [msg, setMsg] = useState<Msg | null>(null)
  const [log, setLog] = useState<LogEntry[] | null>(null)
  const [needs, setNeeds] = useState<AssetNeed[]>([])
  const [ov, setOv] = useState<PresetOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirtyAsk, setDirtyAsk] = useState<string[] | null>(null)
  const [conflict, setConflict] = useState<Pending>(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [editRemote, setEditRemote] = useState(false)
  const [priv, setPriv] = useState(true)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const online = !!repo.remoteUrl

  const loadOverview = () => window.obsLoader.presets.overview(repo.path).then(setOv).catch(() => setOv(null))
  useEffect(() => { void loadOverview() }, [repo.path, st.commits, st.dirtyFiles.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onWide(open || exporting) }, [open, exporting]) // eslint-disable-line react-hooks/exhaustive-deps

  const check = async () => {
    if (!linkedId) { setLive(null); setPending(null); setDetails(undefined); return }
    const r = await window.obsLoader.repos.live(repo.path, linkedId)
    setLive('error' in r ? null : r.changed)
    setDetails('error' in r ? undefined : r.details)
    setPending('error' in r ? null : r.pending ?? null)
  }
  useEffect(() => { void check() }, [linkedId, st.dirtyFiles.length, st.commits]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.needs(repo.path).then(setNeeds).catch(() => setNeeds([])) }, [repo.path, st.behind])

  // an online preset asks what is new when it is shown, so "newer version online" is true and not last time's guess
  const [checked, setChecked] = useState(false)
  const [cmp, setCmp] = useState<OnlineComparison | null>(null)
  const [sure, setSure] = useState<'mine' | 'theirs' | null>(null)
  const disagree = !!cmp && cmp.unrelated && st.ahead > 0
  useEffect(() => { if (online) void window.obsLoader.repos.check(repo.path).then(async () => { setChecked(true); await refresh() }); else setChecked(true) }, [repo.path, online]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (online && checked && (st.behind > 0 || st.ahead > 0)) void window.obsLoader.repos.compare(repo.path).then(setCmp); else setCmp(null) }, [online, checked, st.behind, st.ahead, repo.path])

  const changes = live?.length ?? 0
  const toObs = pending?.length ?? 0
  const obsLine = !linkedId ? ''
    : live === null ? `Checking ${obsName}…`
    : changes > 0 && toObs > 0 ? `${obsName} has changes the preset does not have, and the preset has changes ${obsName} does not have.`
    : changes > 0 ? `${obsName} has ${plural(changes, 'change')} this preset does not have yet.`
    : toObs > 0 ? `This preset has changes ${obsName} does not have yet (${plural(toObs, 'file')}).`
    : `${obsName} and this preset match.`
  const obsAccent: 'save' | 'apply' | null = changes > 0 ? 'save' : toObs > 0 ? 'apply' : null
  const ghLine = !checked ? 'Asking GitHub…'
    : st.ahead > 0 && st.behind > 0 ? 'Both this computer and GitHub have changed: choose below.'
    : st.behind > 0 ? `GitHub has ${plural(st.behind, 'newer change')}.`
    : st.ahead > 0 ? `${plural(st.ahead, 'save')} not uploaded yet.`
    : 'Same as GitHub.'

  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }) } setBusy(false); await refresh() }

  const showSave = (r: SaveResult) => {
    if (r.status === 'dirty') { setDirtyAsk(r.files); return }
    setDirtyAsk(null); setConflict(null)
    if (r.status === 'error') { setMsg({ tone: 'bad', text: r.message }); return }
    if (r.status === 'conflict') { setConflict({ kind: 'save', files: r.conflicts }); setMsg(null); return }
    const extra = [
      r.keysRemembered ? `${r.keysRemembered} stream key${r.keysRemembered === 1 ? '' : 's'} kept in the preset` : '',
      r.upload === 'uploaded' ? 'backed up online' : '',
    ].filter(Boolean).join('; ')
    if (r.upload === 'failed') setMsg({ tone: 'warn', text: `Saved here, but it could not be uploaded: ${r.uploadError}` })
    else if (r.status === 'unchanged') setMsg({ tone: 'good', text: `Already up to date: OBS has nothing new.${extra ? ' (' + extra + ')' : ''}` })
    else setMsg({ tone: 'good', text: `Saved${r.merged ? ' and combined with newer changes that were already in the preset' : ''}${extra ? '; ' + extra : ''}.` })
  }
  const save = (commitDirty: boolean, onConflict?: 'abort' | 'keep-repo' | 'keep-obs') => run(async () => {
    if (!linkedId) return
    showSave(await window.obsLoader.repos.save(repo.path, linkedId, commitDirty, onConflict))
    await check(); await loadOverview()
  })

  const showPull = (r: PullResult) => {
    setConflict(null)
    if (r.status === 'updated') setMsg({ tone: 'good', text: `Got ${r.files.length} changed file${r.files.length === 1 ? '' : 's'}. Press “Apply to OBS…” to put them into OBS.` })
    else if (r.status === 'conflict') { setConflict({ kind: 'pull', files: r.conflicts }); setMsg(null) }
    else if (r.status === 'dirty') setMsg({ tone: 'warn', text: `Save your changes first (${r.files.length} file${r.files.length === 1 ? ' was' : 's were'} changed by hand). Use “Update preset from OBS”.` })
    else if (r.status === 'error') setMsg({ tone: 'bad', text: r.message })
    else if (r.status === 'no-remote') setMsg({ tone: 'warn', text: 'This preset is not backed up online yet.' })
    else setMsg({ tone: 'good', text: 'Already up to date.' })
  }
  const pull = (onConflict?: 'abort' | 'keep-mine' | 'keep-theirs') => run(async () => showPull(await window.obsLoader.repos.pull(repo.path, onConflict)))
  const push = () => run(async () => {
    const r = await window.obsLoader.repos.push(repo.path)
    setMsg(r.status === 'pushed' ? { tone: 'good', text: 'Uploaded.' } : r.status === 'nothing' ? { tone: 'good', text: 'Nothing new to upload.' }
      : r.status === 'no-remote' ? { tone: 'warn', text: 'This preset is not backed up online yet.' }
      : r.rejected ? { tone: 'warn', text: 'The online copy has changes this computer does not have. See the box at the top of this preset and choose which version is right.' }
      : { tone: 'bad', text: r.message })
  })
  const keepMine = () => run(async () => {
    const r = await window.obsLoader.repos.push(repo.path, true)
    setSure(null)
    setMsg(r.status === 'pushed' ? { tone: 'good', text: 'The online copy now matches this computer.' }
      : r.status === 'error' ? { tone: 'bad', text: r.rejected ? 'Someone saved to the online copy just now, so it was not replaced. Look at the two again and choose.' : r.message }
      : { tone: 'good', text: 'Nothing to replace.' })
  })
  const useOnline = () => run(async () => {
    const r = await window.obsLoader.repos.useOnline(repo.path)
    setSure(null)
    setMsg(r.ok ? { tone: 'good', text: 'This computer now has the online version. Your previous one is kept in History. Apply it to OBS to use it.' } : { tone: 'bad', text: r.error })
  })
  const toggleOnline = (on: boolean) => run(async () => {
    const r = await window.obsLoader.presets.setOnline(repo.path, on, ghName.trim() || repo.name, priv)
    if (r.ok) setMsg({ tone: 'good', text: on ? (r.url ? `Backed up online at ${r.url}.` : 'Backed up online.') : 'Online backup is off for this preset. What is already on GitHub stays there.' })
    else setMsg({ tone: 'warn', text: r.error })
  })
  const saveRemote = () => run(async () => {
    const r = await window.obsLoader.repos.setRemote(repo.path, remoteUrl)
    if (r.ok) { setEditRemote(false); setRemoteUrl(''); setMsg({ tone: 'good', text: 'Address saved. Use Upload to send it.' }) } else setMsg({ tone: 'bad', text: r.error })
  })

  const unlink = async () => {
    await window.obsLoader.repos.setInstall(repo.path, null)
    setLinking(false)
    notify({ tone: 'good', text: `“${repo.name}” is no longer linked to ${obsName}. It stays exactly as it is.` })
    await refresh()
  }
  const link = async () => {
    if (!linkTo) return
    await window.obsLoader.repos.setInstall(repo.path, linkTo)
    setLinking(false)
    notify({ tone: 'good', text: `“${repo.name}” is now linked to ${usable.find((i) => i.id === linkTo)?.label ?? 'that OBS'}. Update the preset from OBS, or apply the preset to OBS, whenever you like.` })
    await refresh()
  }

  const counts = ov ? [
    plural(ov.layouts.length, 'scene layout'), plural(ov.outputs.length, 'output setting'),
    ...(ov.files.length ? [`${plural(ov.files.length, 'file')} (${size(ov.files.reduce((n, f) => n + f.size, 0))})`] : []),
    ...(ov.keys.count ? [plural(ov.keys.count, 'stream key')] : []),
  ] : []

  return (
    <section className={'card p-4 space-y-3 min-w-0 ' + (wide ? 'col-span-full' : '')} aria-label={`Preset ${repo.name}`}>
      {/* header: name, then the link and export buttons */}
      <div className="flex items-center gap-2">
        <Icon name="layers" size={18} className="text-muted" />
        <h2 className="bt-panel-title font-semibold flex-1 min-w-0 truncate" title={repo.name}>{repo.name}</h2>
        {linkedId || repo.installId
          ? <IconButton icon="link" kind="local" active label={`Linked to ${obsName}. Press to unlink (the preset stays as it is)`} onClick={unlink} />
          : <IconButton icon="unlink" label="Not linked to an OBS. Press to link it to one" active={linking} onClick={() => { setLinking(!linking); setLinkTo(usable[0]?.id ?? '') }} disabled={usable.length === 0} />}
        <IconButton icon="fileUp" kind="file" label="Export this preset to a file" active={exporting} onClick={() => setExporting(!exporting)} />
        <IconButton icon={open ? 'up' : 'down'} label={open ? 'Hide details' : 'Show details'} onClick={() => setOpen(!open)} />
      </div>
      <div className="flex gap-1.5 flex-wrap items-center text-xs text-muted">
        {linkedId || repo.installId ? <Chip icon="link">linked to {obsName}</Chip> : <Chip icon="unlink">not linked to an OBS</Chip>}
        {counts.map((c) => <span key={c}>{c}</span>)}
      </div>

      {linking && (
        <div className="flex gap-2 items-center flex-wrap">
          <Field label="Link this preset to">
            <select className="input px-2 py-1.5" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
              {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
            </select>
          </Field>
          <button className="btn btn-accent px-3 py-1.5 self-end" disabled={!linkTo} onClick={link}>Link</button>
          <button className="btn btn-ghost px-3 py-1.5 self-end" onClick={() => setLinking(false)}>Cancel</button>
        </div>
      )}

      {msg && <Message tone={msg.tone}>{msg.text}</Message>}

      {/* this computer */}
      <KindPanel kind="local" icon="drive" title="On this computer">
        {ov && ov.onlyHere.length > 0 && <p className="text-xs text-muted">Kept only here: {ov.onlyHere.join(', ')}.</p>}
        {repo.installId && !linkedId && <p className="text-sm">This preset is linked to an OBS that cannot be found any more. Unlink it with the chain button.</p>}
        {linkedId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm flex-1 min-w-40">{obsLine}</span>
              <button className={'btn px-3 py-1 ' + (obsAccent === 'save' ? 'btn-accent' : '')} disabled={busy} onClick={() => save(false)}>Update preset from OBS</button>
              <button className={'btn px-3 py-1 ' + (obsAccent === 'apply' ? 'btn-accent' : '')} disabled={busy} onClick={() => apply(repo.path, linkedId)}>Apply to OBS…</button>
            </div>
            {changes > 0 && (
              <div>
                <button className="btn btn-ghost px-2 py-0.5 text-xs inline-flex items-center gap-1" aria-expanded={showDiff} onClick={() => setShowDiff(!showDiff)}><Icon name="diff" size={13} /> {showDiff ? 'Hide what changed' : 'See what changed'}</button>
                {showDiff && <div className="mt-1"><DiffView details={details} files={live ?? []} /></div>}
              </div>
            )}
          </div>
        ) : !repo.installId && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm flex-1 min-w-40">This preset stands on its own: it only changes when you change it here.</span>
            <button className="btn px-3 py-1" disabled={busy} onClick={() => apply(repo.path)}>Apply to OBS…</button>
          </div>
        )}
      </KindPanel>

      {/* GitHub */}
      <KindPanel
        kind="cloud" icon="cloud" title={online && repo.online ? 'On GitHub' : 'GitHub'}
        right={online && repo.online ? <button className="underline text-xs kind-text" disabled={!repo.online.url} onClick={() => repo.online?.url && window.obsLoader.app.openExternal(repo.online.url)}>{repo.online.name}</button> : undefined}
      >
        {online ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm flex-1 min-w-40">{ghLine}</span>
            <button className={'btn px-3 py-1 ' + (checked && st.behind > 0 && st.ahead === 0 ? 'btn-accent' : '')} disabled={busy} onClick={() => pull()}>Get updates</button>
            <button className={'btn px-3 py-1 ' + (checked && st.ahead > 0 && st.behind === 0 ? 'btn-accent' : '')} disabled={busy} onClick={push}>Upload</button>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-muted">Not backed up online. It only exists on this computer.</p>
            <Choice
              checked={false} disabled={busy || !gh.connected} onChange={(on) => on && toggleOnline(true)}
              title="Back up online (GitHub)"
              help={gh.connected ? 'Keeps a copy on GitHub, updated whenever you save, so you can use this preset on your other computers. Only the parts ticked in the GitHub column above go up.' : undefined}
            />
            {gh.connected && (
              <>
                <Field label="Name on GitHub" hint="Always starts with OBS-Config- so they are easy to find.">
                  <div className="flex items-center gap-1">
                    <span className="mono text-muted">OBS-Config-</span>
                    <input className="input flex-1 px-2 py-1.5" aria-label="Name on GitHub" value={ghName} onChange={(e) => setGhName(e.target.value)} />
                  </div>
                </Field>
                <Choice checked={priv} onChange={setPriv} title="Keep it private" help="Only you can see it on GitHub. Choose before switching backup on." />
              </>
            )}
            {!gh.connected && <p className="text-sm text-muted">To switch this on, sign in to GitHub in <button className="underline" onClick={() => go('settings')}>Settings</button> first.</p>}
          </div>
        )}
        {online && ov && ov.onlyHere.length > 0 && <p className="text-xs text-muted">Not on GitHub: {ov.onlyHere.join(', ')}.</p>}
        {online && ov && ov.onlyHere.length === 0 && ov.keys.count === 0 && <p className="text-xs text-muted">Everything in this preset is uploaded.</p>}
      </KindPanel>

      {online && checked && (st.behind > 0 && st.ahead > 0 || disagree) && (
        <Message tone="bad">
          <strong>This computer and the online copy have both changed.</strong> Choose which one is right.
          {cmp?.mine && cmp?.theirs && (
            <ul className="mt-1 space-y-0.5">
              <li>This computer: last saved {new Date(cmp.mine.date).toLocaleString()} (“{cmp.mine.subject}”), {plural(st.ahead, 'save')} the online copy does not have.</li>
              <li>Online: last changed {new Date(cmp.theirs.date).toLocaleString()} by {cmp.theirs.author} (“{cmp.theirs.subject}”), {plural(st.behind, 'change')} this computer does not have.</li>
              {cmp.unrelated && <li>They were started separately, so they have no saves in common.</li>}
            </ul>
          )}
          <div className="mt-2 flex gap-2 flex-wrap">
            <button className="btn btn-accent px-3 py-1" disabled={busy} onClick={() => pull()}>Combine them</button>
            <button className="btn px-3 py-1" disabled={busy} onClick={() => setSure('mine')}>Keep mine (replace the online copy)</button>
            <button className="btn px-3 py-1" disabled={busy} onClick={() => setSure('theirs')}>Use the online one (replace mine)</button>
          </div>
          {sure && (
            <div className="mt-2 space-y-1">
              <p className="text-sm">{sure === 'mine'
                ? 'The online copy will be replaced by this computer\'s version. Its saves stay in GitHub\'s history, but it will no longer be the current one. Sure?'
                : 'This computer\'s version will be replaced by the online one. Yours is kept (under History, on a branch named “before-online-…”), so nothing is lost. Sure?'}</p>
              <div className="flex gap-2">
                <button className="btn btn-accent px-3 py-1" disabled={busy} onClick={() => (sure === 'mine' ? keepMine() : useOnline())}>{sure === 'mine' ? 'Yes, replace the online copy' : 'Yes, replace mine'}</button>
                <button className="btn btn-ghost px-3 py-1" onClick={() => setSure(null)}>Cancel</button>
              </div>
            </div>
          )}
        </Message>
      )}

      {dirtyAsk && (
        <Message tone="warn">
          Some files in the preset were changed by hand ({dirtyAsk.join(', ')}). Saving OBS would overwrite them, so they need to be kept first.
          <div className="mt-2 flex gap-2">
            <button className="btn btn-accent px-3 py-1" onClick={() => save(true)}>Keep those edits, then update from OBS</button>
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
          <h3 className="font-semibold text-sm flex items-center gap-2"><Icon name="image" size={14} /> Big files this computer still needs</h3>
          {needs.map((n) => (
            <div key={n.id} className="bt-row flex items-center gap-3 py-1">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{n.filename} {n.reason === 'changed' && <Chip tone="warn">newer version in the preset</Chip>}</div>
                <div className="text-xs text-muted">{n.path ?? n.hint ?? 'Not chosen yet'}</div>
              </div>
              <button className="btn px-3 py-1" onClick={async () => {
                const f = await window.obsLoader.files.pick(`Find ${n.filename}`)
                if (f) { await window.obsLoader.repos.setAsset(repo.path, n.id, f); setNeeds(await window.obsLoader.repos.needs(repo.path)); await loadOverview() }
              }}>{n.reason === 'changed' ? 'Choose again…' : 'Locate…'}</button>
            </div>
          ))}
        </div>
      )}

      {exporting && <ExportPanel repo={repo} onDone={(m) => { setMsg(m) }} onClose={() => setExporting(false)} />}

      {open && (
        <div className="space-y-4 border-t border-line pt-3">
          {ov && <StoragePanel repo={repo} ov={ov} changed={async () => { await loadOverview(); await refresh() }} />}

          {online && <div className="space-y-2">
            <h3 className="font-semibold text-sm flex items-center gap-2"><Icon name="cloud" size={14} /> Online backup</h3>
            <Choice checked disabled={busy} onChange={(on) => !on && toggleOnline(false)} title="Back up online (GitHub)" help="Every save is uploaded automatically, so a copy is always on GitHub." />
          </div>}

          <Details repo={repo} installId={linkedId} refresh={refresh} obsNote notify={notify} />
          {online && gh.connected && repo.online && <RenameOnline repo={repo} refresh={refresh} notify={notify} />}
          <div className="space-y-1">
            <h3 className="font-semibold text-sm">Online address</h3>
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
            <button className="btn btn-ghost px-3 py-1.5 inline-flex items-center gap-1.5" onClick={async () => setLog(log ? null : await window.obsLoader.repos.log(repo.path))}><Icon name="clock" size={14} /> {log ? 'Hide history' : 'History'}</button>
            <button className="btn btn-ghost px-3 py-1.5 inline-flex items-center gap-1.5" onClick={() => window.obsLoader.repos.openFolder(repo.path)}><Icon name="folder" size={14} /> Open folder</button>
            <button className="btn btn-ghost px-3 py-1.5 inline-flex items-center gap-1.5" onClick={async () => { await window.obsLoader.repos.remove(repo.path); await refresh() }}><Icon name="trash" size={14} /> Remove from list</button>
          </div>
          {log && (
            <ul className="text-sm space-y-0.5">
              {log.map((l) => <li key={l.hash} className="bt-row py-0.5"><span className="mono text-muted">{l.hash}</span> {l.subject} <span className="text-muted">· {new Date(l.date).toLocaleString()}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
