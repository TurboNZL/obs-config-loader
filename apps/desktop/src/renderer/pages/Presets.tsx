import { useEffect, useState } from 'react'
import type { GithubRepo, GithubState, GitState, InstallInfo, ObsScan, RepoInfo } from '../../../electron/api'
import { Card, Choice, Field, KIND_LABEL, KindPanel, Message, Page, plural } from '../ui'
import { BigFiles, KeysChoice } from '../components/SaveOptions'
import { GitMissing } from '../components/Account'
import { Icon } from '../components/Icon'
import { PresetTile } from '../components/PresetTile'
import { OwnerPick } from '../components/OwnerPick'
import type { Msg } from '../components/PresetDetails'

export type PresetsGo = (t: 'settings' | 'import') => void

export function PresetsPage({ installs, applyRepo, go, startWith, refreshInstalls }: { installs: InstallInfo[] | null; applyRepo: (dir: string, installId?: string) => void; go: PresetsGo; startWith?: string; refreshInstalls: () => Promise<void> }) {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [gh, setGh] = useState<GithubState>({ connected: false })
  const [notice, setNotice] = useState<Msg | null>(null)
  const [skipped, setSkipped] = useState(() => { try { return localStorage.getItem('obscl.onboardingSkipped') === '1' } catch { return false } })
  const [adding, setAdding] = useState<'new' | 'get' | null>(startWith ? 'new' : null)
  const [wide, setWide] = useState<Record<string, boolean>>({})
  const [importing, setImporting] = useState(false)

  // OBS's own list of layouts and settings can change when a preset is renamed or loaded, so it is read again too
  const refresh = async () => { await window.obsLoader.repos.list().then(setRepos); await refreshInstalls() }
  /** Replace one preset's entry in place: asking GitHub about a preset must not make every other one reload. */
  const patch = (r: RepoInfo) => setRepos((cur) => (cur ? cur.map((x) => (x.path === r.path ? r : x)) : cur))
  const refreshGit = () => window.obsLoader.git.state().then(setGit)
  useEffect(() => { void refresh(); void refreshGit(); void window.obsLoader.github.state().then(setGh) }, [])

  const [tick, setTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  /** Forget what was worked out a moment ago and look at OBS, the preset folders and GitHub again. */
  const reload = async () => { setRefreshing(true); try { await window.obsLoader.app.refresh(); await refresh(); setTick((t) => t + 1) } finally { setRefreshing(false) } }
  const done = async (m: Msg) => { setNotice(m); setAdding(null); await refresh() }

  const importFile = async () => {
    setImporting(true); setNotice(null)
    const r = await window.obsLoader.presets.importFile()
    setImporting(false)
    if (!r.ok) { if (!r.cancelled) setNotice({ tone: 'bad', text: r.error }); return }
    if (r.kind === 'preset') setNotice({ tone: r.keys ? 'warn' : 'good', text: `Added the preset “${r.repo.name}”.${r.keys ? ` It had ${plural(r.keys, 'stream key')} inside, which stay inside the preset on this computer.` : ''}${r.files ? ` ${plural(r.files, 'file')} came with it.` : ''}${r.latest ? ' It is the latest version from its GitHub copy, and you can get updates from there.' : r.online ? ' It is linked to its GitHub copy, so you can get updates.' : ' It is yours now: switch on online backup to give it its own GitHub copy.'} Press “Apply to OBS” on it to use it.` })
    else if (r.kind === 'existing') setNotice({ tone: 'good', text: `You already have this as the preset “${r.repo.name}”.` })
    else setNotice({ tone: 'good', text: `Added ${plural(r.applied.files, 'part')}, ${plural(r.applied.media, 'file')}${r.applied.keys ? ` and ${plural(r.applied.keys, 'stream key')}` : ''} to “${r.repo.name}”.` })
    await refresh()
  }

  return (
    <Page
      wide icon="layers"
      title="Presets"
      intro="A preset is a complete copy of your OBS setup, kept on this computer. Link it to an OBS to update it from there, back it up on GitHub, or export it to a file."
    >
      {git && !git.available && <GitMissing git={git} recheck={refreshGit} />}
      {notice && <Message tone={notice.tone}>{notice.text}</Message>}

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-4 py-2 inline-flex items-center gap-2" disabled={!git?.available} onClick={() => setAdding(adding === 'new' ? null : 'new')}><Icon name="save" /> Make a preset from my OBS</button>
        <button className="btn px-3 py-2 inline-flex items-center gap-2" disabled={!git?.available} onClick={() => setAdding(adding === 'get' ? null : 'get')}><Icon name="download" /> Get one from GitHub…</button>
        <button className="btn px-3 py-2 inline-flex items-center gap-2 ml-auto" disabled={refreshing} onClick={reload} title="Look again at OBS and GitHub"><Icon name="refresh" /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
        <button className="btn px-3 py-2 inline-flex items-center gap-2" disabled={!git?.available || importing} onClick={importFile}><Icon name="fileUp" className="rotate-180" /> {importing ? 'Importing…' : 'Import a file…'}</button>
      </div>

      {adding === 'new' && git?.available && <SaveSetup installs={installs ?? []} start={startWith} gh={gh} go={go} onDone={done} onCancel={() => setAdding(null)} />}
      {adding === 'get' && git?.available && <GetPreset gh={gh} count={repos?.length ?? 0} go={go} onDone={done} onCancel={() => setAdding(null)} />}

      {repos?.length === 0 && !adding && !skipped && <Onboarding gitOk={!!git?.available} ghConnected={gh.connected} onFile={importFile} onObs={() => setAdding('new')} onGithub={() => setAdding('get')} onSettings={() => go('settings')} onSkip={() => { setSkipped(true); try { localStorage.setItem('obscl.onboardingSkipped', '1') } catch { /* not kept */ } }} />}
      {repos?.length === 0 && !adding && skipped && <Message tone="warn">You have no presets yet. Press “Make a preset from my OBS” to make your first one, or “Import a file…” if someone sent you one.</Message>}
      <div className="grid gap-4 grid-cols-1 min-[820px]:grid-cols-2 min-[1500px]:grid-cols-3 items-stretch">
        {repos?.map((r) => (
          <PresetTile
            key={r.path} repo={r} installs={installs ?? []} gh={gh} refresh={refresh} patch={patch} apply={applyRepo} go={go} notify={setNotice} tick={tick}
            wide={!!wide[r.path]} onWide={(on) => setWide((w) => (w[r.path] === on ? w : { ...w, [r.path]: on }))}
          />
        ))}
      </div>
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
  const [org, setOrg] = useState('')
  const [link, setLink] = useState(true)
  const [upLayouts, setUpLayouts] = useState<string[] | null>(null) // scene layouts that go online (null: all)
  const [upOutputs, setUpOutputs] = useState<string[] | null>(null)
  const [upScripts, setUpScripts] = useState(true)
  const [upRemote, setUpRemote] = useState(true)
  const [toFile, setToFile] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [withKeys, setWithKeys] = useState(false)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!installId && usable[0]) setInstallId(usable.find((i) => i.id === start)?.id ?? usable[0].id) }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  const install = usable.find((i) => i.id === installId)
  useEffect(() => {
    setScenes(install?.collections ?? []); setOutputs(install?.profiles ?? []); setChosen([]); setUpLayouts(null); setUpOutputs(null)
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
    let repoUrl: string | undefined // where the preset is kept online: the file then knows how to find the latest version
    try {
      if (asPreset) {
        const goesOnline = online && gh.connected
        const r = await window.obsLoader.repos.create({
          installId, name: name.trim(), folder, exclude, link, github: goesOnline ? { private: priv, ...(org ? { org } : {}) } : undefined,
          cloudSkip: goesOnline ? { layouts: scenes.filter((c) => !(upLayouts ?? scenes).includes(c)), outputs: outputs.filter((c) => !(upOutputs ?? outputs).includes(c)), scripts: !upScripts, remoteControl: !upRemote } : undefined,
        })
        if (!r.ok) { setError(r.error); setBusy(false); return }
        repoUrl = r.remoteUrl
        done.push(`Saved the preset “${r.repo.name}”${r.published ? ` and backed it up at ${r.published}` : ''}`)
      }
      if (toFile) {
        const r = await window.obsLoader.export.run({ installId, name: name.trim(), collections: scenes, profiles: outputs, media: 'small', includeKeys: withKeys, alsoBundle: chosen, exclude, repository: repoUrl })
        if (r && 'error' in r) { setError(r.error); setBusy(false); return }
        if (r) done.push(`Saved the file ${r.path}${r.containsSecrets ? ' (it contains your stream keys: keep it private)' : r.secrets.length ? `. Your stream keys are not in it, so you type them when you load it: ${r.secrets.join(', ')}` : ''}${r.assets.external ? `. ${r.assets.external} big file${r.assets.external === 1 ? ' is' : 's are'} not inside; you point to ${r.assets.external === 1 ? 'it' : 'them'} when loading it` : ''}`)
        else if (!asPreset) { setBusy(false); return } // the save window was closed and nothing else was asked for
      }
    } catch (e) { setError((e as Error).message); setBusy(false); return }
    setBusy(false)
    await onDone({ tone: withKeys && toFile ? 'warn' : 'good', text: done.join('. ') + '.' })
  }

  return (
    <Card title="Make a preset from my OBS">
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

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Where to keep it</h3>
        <KindPanel kind="local" icon="drive" title="On this computer">
          <Choice checked={asPreset} onChange={(on) => { setAsPreset(on); if (!on) setOnline(false); if (!on && !toFile) setToFile(true) }} title="As a preset on this computer" help="A complete copy: scene layouts, output settings, scripts, your stream keys and the files your scenes use. You can load it into OBS again, update it, rename it and back it up." />
          {asPreset && <Choice checked={link} onChange={setLink} title={`Link it to ${install?.label ?? 'this OBS'}`} help="A linked preset can be updated from that OBS with one button, and applied back to it. You can unlink it any time and the preset stays as it is." />}
        </KindPanel>
        <KindPanel kind="cloud" icon="cloud" title="On GitHub">
          <Choice
            checked={online && asPreset && gh.connected} disabled={!asPreset || !gh.connected} onChange={setOnline} title="Back the preset up online (GitHub)"
            help={!gh.connected ? <>Sign in to GitHub in <button className="underline" onClick={() => go('settings')}>Settings</button> to turn this on.</> : 'Stream keys never go online. Choose below what does.'}
          />
          {online && asPreset && gh.connected && (
            <div className="space-y-0.5 pl-1">
              <OwnerPick value={org} onChange={setOrg} login={gh.login} />
              <Choice checked={priv} onChange={setPriv} title="Keep it private" help={org ? `Only people in ${org} that you let in can see it.` : 'Only you can see it on GitHub.'} />
              <p className="text-xs text-muted pt-1">What goes online (untick what should stay only on this computer; you can change this later):</p>
              {scenes.map((c) => <Choice key={'ul' + c} checked={(upLayouts ?? scenes).includes(c)} onChange={(on) => setUpLayouts(on ? [...(upLayouts ?? scenes), c] : (upLayouts ?? scenes).filter((x) => x !== c))} title={<>{c} <span className="text-muted">(scene layout)</span></>} />)}
              {outputs.map((c) => <Choice key={'uo' + c} checked={(upOutputs ?? outputs).includes(c)} onChange={(on) => setUpOutputs(on ? [...(upOutputs ?? outputs), c] : (upOutputs ?? outputs).filter((x) => x !== c))} title={<>{c} <span className="text-muted">(output settings)</span></>} />)}
              {scan && scan.scripts.length > 0 && <Choice checked={upScripts} onChange={setUpScripts} title="Scripts" />}
              {scan?.remoteControl && <Choice checked={upRemote} onChange={setUpRemote} title="Remote-control settings (WebSocket)" />}
            </div>
          )}
        </KindPanel>
        <KindPanel kind="file" icon="file" title="As a file">
          <Choice checked={toFile} onChange={(on) => { setToFile(on); if (!on && !asPreset) setAsPreset(true) }} title="Also export it as one file" help="One setup file (.obsbundle) you can copy to another computer or send to someone." />
        </KindPanel>
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
          if (r.ok) await onDone({ tone: 'good', text: `Downloaded “${r.repo.name}”. Press “Apply to OBS” on it to use it.` }); else setError(r.error)
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


/** First run: three ways to get a first preset. The skip cross is small on purpose; skipping leaves the plain message instead. */
function Onboarding({ gitOk, ghConnected, onFile, onObs, onGithub, onSettings, onSkip }: { gitOk: boolean; ghConnected: boolean; onFile: () => void; onObs: () => void; onGithub: () => void; onSettings: () => void; onSkip: () => void }) {
  const way = (icon: Parameters<typeof Icon>[0]['name'], title: string, text: string, go: () => void, disabled?: boolean) => (
    <button type="button" className="btn p-4 text-left !flex !flex-col !items-start gap-1 whitespace-normal h-auto" disabled={disabled} onClick={go}>
      <span className="font-semibold flex items-center gap-2"><Icon name={icon} size={16} /> {title}</span>
      <span className="text-sm text-muted">{text}</span>
    </button>
  )
  return (
    <section className="card p-5 space-y-3" aria-label="Add your first preset">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="font-semibold text-lg">Let’s add your first preset</h2>
          <p className="text-sm text-muted">A preset is a saved copy of an OBS setup. Pick the one that sounds like you.</p>
        </div>
        <button className="btn btn-ghost p-1 text-muted opacity-50 hover:opacity-100" aria-label="Skip this" title="Skip" onClick={onSkip}><Icon name="x" size={14} /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {way('fileUp', 'I have a file', 'Someone sent me a setup file (.obsbundle). I will open it here.', onFile, !gitOk)}
        {way('monitor', 'I have OBS set up already', 'Make a preset from the OBS on this computer so it is saved and can be moved or shared.', onObs, !gitOk)}
        {way('cloud', 'I have a GitHub link', ghConnected ? 'Get a preset from GitHub that you or a friend made.' : 'You will be asked to sign in to GitHub first (free), then pick the preset.', ghConnected ? onGithub : onGithub, !gitOk)}
      </div>
      {!ghConnected && <p className="text-xs text-muted">Signing in to GitHub is under <button className="underline" onClick={onSettings}>Settings</button>.</p>}
      {!gitOk && <p className="text-xs text-muted">The app needs “git” installed first; the notice above explains how.</p>}
    </section>
  )
}
