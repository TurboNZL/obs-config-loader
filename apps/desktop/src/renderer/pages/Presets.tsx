import { useEffect, useState } from 'react'
import type { AssetNeed, FileChoice, GithubRepo, GithubState, GitState, InstallInfo, LogEntry, ObsScan, PresetDetails, PullResult, RenameRequest, RepoInfo, SaveResult } from '../../../electron/api'
import { Card, Chip, Choice, Field, KIND_LABEL, Message, Page, plural } from '../ui'
import { BigFiles, KeysChoice } from '../components/SaveOptions'
import { GitMissing } from '../components/Account'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }
export type PresetsGo = (t: 'settings' | 'import') => void

export function PresetsPage({ installs, applyRepo, go, startWith, refreshInstalls }: { installs: InstallInfo[] | null; applyRepo: (dir: string, installId?: string) => void; go: PresetsGo; startWith?: string; refreshInstalls: () => Promise<void> }) {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [gh, setGh] = useState<GithubState>({ connected: false })
  const [notice, setNotice] = useState<Msg | null>(null)
  const [adding, setAdding] = useState<'new' | 'get' | null>(startWith ? 'new' : null)

  // OBS's own list of layouts and settings can change when a preset is renamed or loaded, so it is read again too
  const refresh = async () => { await window.obsLoader.repos.list().then(setRepos); await refreshInstalls() }
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
        <button className="btn btn-accent px-4 py-2" disabled={!git?.available} onClick={() => setAdding(adding === 'new' ? null : 'new')}>Save my OBS setup</button>
        <button className="btn px-3 py-2" disabled={!git?.available} onClick={() => setAdding(adding === 'get' ? null : 'get')}>Get one from GitHub…</button>
        <button className="btn px-3 py-2" onClick={() => go('import')}>Open a setup file…</button>
      </div>

      {adding === 'new' && git?.available && <SaveSetup installs={installs ?? []} start={startWith} gh={gh} go={go} onDone={done} onCancel={() => setAdding(null)} />}
      {adding === 'get' && git?.available && <GetPreset gh={gh} count={repos?.length ?? 0} go={go} onDone={done} onCancel={() => setAdding(null)} />}

      {repos?.length === 0 && !adding && <Message tone="warn">You have no presets yet. Press “Save my OBS setup” to make your first one.</Message>}
      {repos?.map((r) => <PresetCard key={r.path} repo={r} installs={installs ?? []} gh={gh} refresh={refresh} apply={applyRepo} go={go} notify={setNotice} />)}
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

function SaveSetup({ installs, start, gh, go, onDone, onCancel }: { installs: InstallInfo[]; start?: string; gh: GithubState; go: PresetsGo; onDone: (m: Msg) => Promise<void>; onCancel: () => void }) {
  const usable = installs.filter((i) => i.configExists)
  const [name, setName] = useState('My OBS setup')
  const [installId, setInstallId] = useState('')
  const [folder, setFolder] = useState('')
  const [scenes, setScenes] = useState<string[]>([])
  const [outputs, setOutputs] = useState<string[]>([])
  const [remote, setRemote] = useState(true)
  const [scripts, setScripts] = useState(true)
  const [scan, setScan] = useState<ObsScan | null>(null)
  const [asPreset, setAsPreset] = useState(true)
  const [online, setOnline] = useState(false)
  const [priv, setPriv] = useState(true)
  const [toFile, setToFile] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [withKeys, setWithKeys] = useState(false)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!installId && usable[0]) setInstallId(usable.find((i) => i.id === start)?.id ?? usable[0].id) }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  const install = usable.find((i) => i.id === installId)
  useEffect(() => {
    setScenes(install?.collections ?? []); setOutputs(install?.profiles ?? []); setChosen([])
    if (installId) void window.obsLoader.obs.scan(installId).then(setScan).catch(() => setScan(null))
  }, [installId, install?.collections.join('|'), install?.profiles.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.obsLoader.repos.suggestFolder(name || 'obs-setup').then(setFolder) }, [name])
  if (usable.length === 0) return <Message tone="warn">There is no OBS setup on this computer to save yet. Open OBS once, or add OBS under “OBS on this computer”.</Message>

  const toggle = (list: string[], set: (l: string[]) => void, item: string, on: boolean) => set(on ? [...list, item] : list.filter((x) => x !== item))
  const exclude = {
    collections: (install?.collections ?? []).filter((c) => !scenes.includes(c)),
    profiles: (install?.profiles ?? []).filter((c) => !outputs.includes(c)),
    remoteControl: !remote, scripts: !scripts,
  }
  const nothing = scenes.length + outputs.length === 0
  const go_ = async () => {
    setBusy(true); setError(null)
    const done: string[] = []
    try {
      if (asPreset) {
        const r = await window.obsLoader.repos.create({ installId, name: name.trim(), folder, exclude, github: online && gh.connected ? { private: priv } : undefined })
        if (!r.ok) { setError(r.error); setBusy(false); return }
        done.push(`Saved the preset “${r.repo.name}”${r.published ? ` and backed it up at ${r.published}` : ''}`)
      }
      if (toFile) {
        const r = await window.obsLoader.export.run({ installId, name: name.trim(), collections: scenes, profiles: outputs, media: 'small', includeKeys: withKeys, alsoBundle: chosen, exclude })
        if (r && 'error' in r) { setError(r.error); setBusy(false); return }
        if (r) done.push(`Saved the file ${r.path}${r.containsSecrets ? ' (it contains your stream keys: keep it private)' : r.secrets.length ? `. Your stream keys are not in it, so you type them when you load it: ${r.secrets.join(', ')}` : ''}${r.assets.external ? `. ${r.assets.external} big file${r.assets.external === 1 ? ' is' : 's are'} not inside; you point to ${r.assets.external === 1 ? 'it' : 'them'} when loading it` : ''}`)
        else if (!asPreset) { setBusy(false); return } // the save window was closed and nothing else was asked for
      }
    } catch (e) { setError((e as Error).message); setBusy(false); return }
    setBusy(false)
    await onDone({ tone: withKeys && toFile ? 'warn' : 'good', text: done.join('. ') + '.' })
  }

  return (
    <Card title="Save my OBS setup">
      {error && <Message tone="bad">{error}</Message>}
      <Field label="Give this setup a name"><input className="input w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {usable.length > 1 && (
        <Field label="Save the setup of">
          <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)}>
            {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
          </select>
        </Field>
      )}

      <div>
        <h3 className="text-sm font-semibold">What to save</h3>
        <p className="text-xs text-muted mb-1">Untick anything you do not want in it.</p>
        {(install?.collections ?? []).map((c) => <Choice key={'c' + c} checked={scenes.includes(c)} onChange={(on) => toggle(scenes, setScenes, c, on)} title={<>{c} <span className="text-muted">(scene layout)</span></>} />)}
        {(install?.profiles ?? []).map((c) => <Choice key={'p' + c} checked={outputs.includes(c)} onChange={(on) => toggle(outputs, setOutputs, c, on)} title={<>{c} <span className="text-muted">(output settings)</span></>} />)}
        {scan?.remoteControl && <Choice checked={remote} onChange={setRemote} title="OBS remote-control settings (WebSocket)" help="The port and password that other programs use to control OBS." />}
        {scan && scan.scripts.length > 0 && <Choice checked={scripts} onChange={setScripts} title={`Scripts: ${scan.scripts.join(', ')}`} help="Kept with the setup so they come along." />}
        <p className="text-xs text-muted mt-1">OBS calls scene layouts “Scene Collections” and output settings “Profiles”.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Where to keep it</h3>
        <Choice checked={asPreset} onChange={(on) => { setAsPreset(on); if (!on) setOnline(false); if (!on && !toFile) setToFile(true) }} title="As a preset on this computer" help="A preset you can load into OBS again, update later, rename and back up. Big files are never kept in it." />
        <Choice
          checked={online && asPreset && gh.connected} disabled={!asPreset || !gh.connected} onChange={setOnline} title="Back the preset up online (GitHub)"
          help={!gh.connected ? <>Sign in to GitHub in <button className="underline" onClick={() => go('settings')}>Settings</button> to turn this on.</> : 'Never includes stream keys or big files.'}
        />
        {online && asPreset && gh.connected && <Choice checked={priv} onChange={setPriv} title="Keep it private" help="Only you can see it on GitHub." />}
        <Choice checked={toFile} onChange={(on) => { setToFile(on); if (!on && !asPreset) setAsPreset(true) }} title="Also as one file" help="One file you can copy to another computer." />
      </div>

      {toFile && (
        <div className="space-y-3 border-t border-line pt-3">
          <BigFiles files={scan?.files ?? []} chosen={chosen} setChosen={setChosen} />
          <KeysChoice checked={withKeys} onChange={setWithKeys} available={(scan?.keys.length ?? 0) > 0} help={(scan?.keys.length ?? 0) === 0 ? 'There are no stream keys in this OBS.' : undefined} />
        </div>
      )}

      {asPreset && (
        <>
          <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setMore(!more)}>{more ? 'Hide details' : 'Show details'}</button>
          {more && <FolderField folder={folder} setFolder={setFolder} />}
        </>
      )}
      <p className="text-sm text-muted">
        This will save {plural(scenes.length, 'scene layout')} and {plural(outputs.length, 'output setting')}
        {toFile ? (withKeys ? ', with your stream keys in the file' : ', without your stream keys in the file') : ''}.
      </p>
      <div className="flex gap-2">
        <button className="btn btn-accent px-4 py-2" disabled={busy || !name.trim() || !installId || nothing || (asPreset && !folder)} onClick={go_}>
          {busy ? 'Saving…' : toFile && !asPreset ? 'Save to a file…' : toFile ? 'Save preset and file…' : 'Save preset'}
        </button>
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

function Details({ repo, installId, refresh, obsNote, notify }: { repo: RepoInfo; installId: string; refresh: () => Promise<void>; obsNote: boolean; notify: (m: Msg) => void }) {
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

      <SavesSettings repo={repo} d={d} reload={async () => { await load(); await refresh() }} />
      <Translations repo={repo} d={d} reload={load} />
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

// ── what a preset saves ─────────────────────────────────────────────────────

function SavesSettings({ repo, d, reload }: { repo: RepoInfo; d: PresetDetails; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg | null>(null)
  const ex = d.exclude
  const layoutNames = [...new Set([...d.layouts.map((l) => l.name), ...(ex.collections ?? [])])]
  const outputNames = [...new Set([...d.outputs.map((o) => o.name), ...(ex.profiles ?? [])])]
  const set = async (next: PresetDetails['exclude']) => {
    const r = await window.obsLoader.presets.setExclude(repo.path, next)
    setMsg(r.ok ? { tone: 'good', text: 'Changed. It applies the next time you save OBS to this preset.' } : { tone: 'bad', text: r.error })
    await reload()
  }
  const flip = (list: string[] | undefined, name: string, keep: boolean) => (keep ? (list ?? []).filter((n) => n !== name) : [...(list ?? []), name])
  return (
    <div>
      <h3 className="font-semibold text-sm">What this preset saves</h3>
      <p className="text-xs text-muted mb-1">Untick what should stay out. Everything else in your OBS is kept each time you save. Stream keys and big files never go in a preset, so they never go to GitHub.</p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      {layoutNames.map((n) => <Choice key={'l' + n} checked={!ex.collections?.includes(n)} onChange={(on) => set({ ...ex, collections: flip(ex.collections, n, on) })} title={<>{n} <span className="text-muted">(scene layout)</span></>} />)}
      {outputNames.map((n) => <Choice key={'o' + n} checked={!ex.profiles?.includes(n)} onChange={(on) => set({ ...ex, profiles: flip(ex.profiles, n, on) })} title={<>{n} <span className="text-muted">(output settings)</span></>} />)}
      <Choice checked={!ex.remoteControl} onChange={(on) => set({ ...ex, remoteControl: !on })} title="OBS remote-control settings (WebSocket)" help="The port and password other programs use to control OBS. The password is never saved in a preset." />
      <Choice checked={!ex.scripts} onChange={(on) => set({ ...ex, scripts: !on })} title="Scripts" help="Small script files are kept in the preset, and put back when it is loaded." />
    </div>
  )
}

// ── how sources change on other computers ──────────────────────────────────

function Translations({ repo, d, reload }: { repo: RepoInfo; d: PresetDetails; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg | null>(null)
  if (d.translations.length === 0) return null
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
    setMsg(r.ok ? { tone: 'good', text: 'Saved. It is used the next time this preset is loaded on another kind of computer.' } : { tone: 'bad', text: r.error })
    await reload()
  }
  return (
    <div>
      <h3 className="font-semibold text-sm">How sources change on other computers</h3>
      <p className="text-xs text-muted mb-1">Some sources only exist on one system. When this preset is loaded on another, the app swaps each for the closest one. Change a choice here if it guessed wrong. You pick the window, screen or device again either way.</p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
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
    </div>
  )
}

// ── moving a preset ────────────────────────────────────────────────────────

function MoveIt({ repo, refresh, notify }: { repo: RepoInfo; refresh: () => Promise<void>; notify: (m: Msg) => void }) {
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

// ── one preset ───────────────────────────────────────────────────────────────

type Pending = { kind: 'save'; files: string[] } | { kind: 'pull'; files: string[] } | null

function PresetCard({ repo, installs, gh, refresh, apply, go, notify }: { repo: RepoInfo; installs: InstallInfo[]; gh: GithubState; refresh: () => Promise<void>; apply: (dir: string, installId?: string) => void; go: PresetsGo; notify: (m: Msg) => void }) {
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
  const [fileChoices, setFileChoices] = useState<FileChoice[]>([])
  const [chosen, setChosen] = useState<string[]>([])
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
    const r = await window.obsLoader.presets.exportFile(repo.path, withKeys, chosen)
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
        <button className="btn px-3 py-1.5" disabled={busy} onClick={async () => { const on = !exporting; setExporting(on); if (on) { setChosen([]); setFileChoices(await window.obsLoader.presets.scanFile(repo.path).catch(() => [])) } }}>Save to a file…</button>
      </div>

      {exporting && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm">This makes one file you can copy to another computer.</p>
          <BigFiles files={fileChoices} chosen={chosen} setChosen={setChosen} forPreset />
          <KeysChoice
            checked={withKeys} onChange={setWithKeys} available={keys.count > 0}
            help={keys.count ? `${keys.count} remembered on this computer. Off is safest: the file is then safe to share.` : keys.canStore ? 'None are remembered yet. Press “Save OBS to this preset” first, and they will be.' : 'This computer has no system keychain, so keys cannot be remembered.'}
          />
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
          <Details repo={repo} installId={installId} refresh={refresh} obsNote notify={notify} />
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
