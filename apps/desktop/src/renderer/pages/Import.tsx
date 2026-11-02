import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepoInfo, BundleSummary, ConflictMode, ImportReport, ImportRequest, InstallInfo } from '../../../electron/api'
import { Card, Chip, Choice, Field, KIND_LABEL, Message, Page, Step, plural } from '../ui'

const FOLDER_NAMES: Record<string, string> = { home: 'your home folder', documents: 'Documents', videos: 'Videos', music: 'Music', pictures: 'Pictures', desktop: 'Desktop' }
const prettyFolder = (d: string) => d.replace(/^\{\{([a-z]+)\}\}/, (_w, k: string) => FOLDER_NAMES[k] ?? k).replace(/\//g, ' › ')
const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))
const clean = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))
const slashes = (p: string) => p.replace(/\\/g, '/')

/** Names of the things that will be replaced, read from the files the report says it will overwrite. */
function replacedNames(report: ImportReport): { scenes: string[]; outputs: string[] } {
  const scenes = new Set<string>(), outputs = new Set<string>()
  for (const w of report.willWrite) {
    if (w.action !== 'replace') continue
    const p = slashes(w.path)
    const sc = /\/basic\/scenes\/([^/]+)\.json$/.exec(p)
    const pr = /\/basic\/profiles\/([^/]+)\//.exec(p)
    if (sc) scenes.add(sc[1]); if (pr) outputs.add(pr[1])
  }
  return { scenes: [...scenes], outputs: [...outputs] }
}

export function ImportPage({ installs, preselect, openPath, refresh }: { installs: InstallInfo[] | null; preselect?: string; openPath?: string; refresh: () => Promise<void> }) {
  const [bundle, setBundle] = useState<BundleSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installId, setInstallId] = useState<string>(preselect ?? '')
  const [scenes, setScenes] = useState<string[]>([])
  const [outputs, setOutputs] = useState<string[]>([])
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [assetFiles, setAssetFiles] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState<ConflictMode>('replace')
  const [activate, setActivate] = useState(true)
  const [preferPipewire, setPreferPipewire] = useState(true)
  const [choices, setChoices] = useState<Record<string, string | null>>({})
  const [remember, setRemember] = useState(true)
  const [keepPreset, setKeepPreset] = useState(true) // a file is kept as a preset by default, so it can be updated and backed up
  const [existing, setExisting] = useState<RepoInfo | null>(null)
  const [behind, setBehind] = useState(0)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ written: number; backedUp: number; backupDir: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [liveChanges, setLiveChanges] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const usable = useMemo(() => installs ?? [], [installs])
  useEffect(() => { if (!installId && usable[0]) setInstallId(usable[0].id) }, [usable, installId])
  const install = usable.find((i) => i.id === installId)

  const load = async (r: BundleSummary | { error: string } | null) => {
    if (!r) return
    if ('error' in r) { setError(r.error); return }
    setError(null); setDone(null); setReport(null); setNote(null); setChoices({})
    setBundle(r)
    setExisting(null); setBehind(0)
    if (!r.repoDir) void window.obsLoader.bundle.existing(r.handle).then(setExisting)
    else void window.obsLoader.repos.check(r.repoDir).then((c) => setBehind(c.repo.status.behind))
    setScenes(r.manifest.collections.map((c) => c.id))
    setOutputs(r.manifest.profiles.map((c) => c.id))
    // what this computer remembers about the file: where its big media are, folder choices, secrets
    const [loc, secrets] = await Promise.all([window.obsLoader.locations.load(r.manifest.id), window.obsLoader.secrets.load(r.manifest.id)])
    setAssetFiles(loc.assets)
    setVariables({ ...loc.variables, ...secrets })
  }
  useEffect(() => { if (openPath) void window.obsLoader.bundle.openPath(openPath).then(load) }, [openPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // a git folder: warn when OBS has edits the repository does not have yet, because loading would replace them
  const repoDir = bundle?.repoDir
  const checkLive = async () => {
    if (!repoDir || !installId) { setLiveChanges([]); return }
    const r = await window.obsLoader.repos.live(repoDir, installId)
    setLiveChanges('error' in r ? [] : r.changed)
  }
  useEffect(() => { void checkLive() }, [repoDir, installId, done]) // eslint-disable-line react-hooks/exhaustive-deps

  const request = (): ImportRequest => ({
    handle: bundle!.handle, installId, collections: scenes, profiles: outputs, variables: clean(variables), assetFiles, conflict, activate, preferPipewire, sourceChoices: choices,
  })

  // Re-run the "what would happen" check whenever an answer changes, so the summary is always about what the button will do.
  const seq = useRef(0)
  useEffect(() => {
    if (!bundle || !installId) return
    const n = ++seq.current
    const t = setTimeout(() => {
      window.obsLoader.import.plan(request()).then((r) => { if (n === seq.current) setReport(r) }).catch((e) => setError(String(e.message ?? e)))
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, installId, scenes, outputs, variables, assetFiles, conflict, activate, preferPipewire, choices])

  const useLatest = async () => {
    if (!bundle) return
    setSaving(true); setError(null)
    const r = await window.obsLoader.bundle.latest(bundle.handle)
    if (!r.ok) { setSaving(false); setError(r.error); return }
    const opened = await window.obsLoader.bundle.openPath(r.path)
    setSaving(false)
    await load(opened)
    setNote(r.how === 'downloaded' ? 'Downloaded the latest version.' : r.how === 'updated' ? 'Got the latest changes.' : 'Your preset is already up to date.')
  }
  const getUpdates = async () => {
    if (!bundle?.repoDir) return
    setSaving(true); setError(null)
    const r = await window.obsLoader.repos.pull(bundle.repoDir)
    if (r.status === 'conflict') setError('You and the online copy changed the same part. Open “Presets” to choose which to keep.')
    else if (r.status === 'dirty') setError('This preset has changes that are not saved yet. Open “Presets” and save them first.')
    else if (r.status === 'error') setError(r.message)
    else { const opened = await window.obsLoader.bundle.openPath(bundle.repoDir); await load(opened) }
    setSaving(false)
  }

  const apply = async () => {
    setBusy(true); setError(null)
    try {
      const r = await window.obsLoader.import.apply(request())
      await window.obsLoader.locations.save(bundle!.manifest.id, {
        assets: assetFiles,
        variables: Object.fromEntries(bundle!.manifest.variables.filter((v) => v.kind !== 'secret' && variables[v.name]).map((v) => [v.name, variables[v.name]])),
      })
      if (remember) {
        const secrets = Object.fromEntries(bundle!.manifest.variables.filter((v) => v.kind === 'secret' && variables[v.name]).map((v) => [v.name, variables[v.name]]))
        if (Object.keys(secrets).length) await window.obsLoader.secrets.save(bundle!.manifest.id, secrets)
      }
      setDone(r)
      // a file is kept as a preset by default (with its online address, so it can get updates later)
      if (keepPreset && !bundle!.repoDir && !existing) {
        const folder = await window.obsLoader.repos.suggestFolder(m!.name)
        const p = await window.obsLoader.repos.fromBundle(bundle!.handle, folder, installId)
        setNote(p.ok ? `Kept as the preset “${p.repo.name}”${m!.repository?.url ? ', linked to its online copy' : ''}. Find it under “Presets”.` : `Applied, but it could not be kept as a preset: ${p.error}`)
      }
      await refresh()
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const m = bundle?.manifest
  const secretVars = m?.variables.filter((v) => v.kind === 'secret') ?? []
  const folderVars = m?.variables.filter((v) => v.kind === 'path') ?? []
  const otherVars = m?.variables.filter((v) => v.kind !== 'secret' && v.kind !== 'path') ?? []
  const bigFiles = m?.assets.filter((a) => a.mode === 'external') ?? []
  const pluginKey = window.obsLoader.platform === 'win32' ? 'windows' : window.obsLoader.platform === 'darwin' ? 'macos'
    : install?.kind === 'flatpak' ? 'linux-flatpak' : 'linux-native'
  const replaced = report ? replacedNames(report) : { scenes: [], outputs: [] }
  let step = 0

  return (
    <Page title="Apply a setup to OBS" intro="Open a setup file, choose which OBS it goes into, and check what will happen. Nothing changes until you press the button at the end.">
      {error && <Message tone="bad">{error}</Message>}

      {done && install && (
        <>
          <Message tone="good">
            <strong>Done.</strong> Your setup is now in {install.label}.
            {done.backedUp > 0 && <> {plural(done.backedUp, 'file')} it replaced {done.backedUp === 1 ? 'was' : 'were'} backed up first.</>}
          </Message>
          <Card title="What now?">
            <div className="flex gap-2 flex-wrap">
              {install.launch && <button className="btn btn-accent px-4 py-2" onClick={() => void window.obsLoader.installs.launch(install.id).then((r) => setNote(r.ok ? 'Starting OBS…' : r.message))}>Start OBS</button>}
              <button className="btn px-3 py-2" onClick={() => { setDone(null); setBundle(null); setReport(null) }}>Open another file</button>
            </div>
            {note && <p className="text-sm text-muted">{note}</p>}
            {report && report.plugins.some((p) => p.status === 'missing') && <p className="text-sm">Some plugins this setup uses are not installed yet: see below.</p>}
            <details>
              <summary className="text-sm cursor-pointer text-muted">Where the backup copies are</summary>
              <p className="mono mt-1">{done.backupDir}</p>
            </details>
          </Card>
        </>
      )}

      {!done && (
        <Step n={++step} title="Choose a setup file" help="A file ending in .obsbundle (or .zip) that you saved from this app.">
          <div
            className={'p-6 text-center text-sm rounded-theme border border-dashed border-line' + (drag ? ' bg-raised' : '')}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={async (e) => {
              e.preventDefault(); setDrag(false)
              const f = e.dataTransfer.files[0]
              if (f) await load(await window.obsLoader.bundle.openPath(window.obsLoader.pathForFile(f)))
            }}
          >
            {m ? <span>Drop another file here to use that one instead</span> : <span>Drop the file here, or use the button</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-accent px-4 py-2" onClick={async () => load(await window.obsLoader.bundle.open())}>{m ? 'Choose a different file…' : 'Choose a file…'}</button>
            <button className="btn btn-ghost px-3 py-2 text-sm" onClick={async () => load(await window.obsLoader.bundle.openFolder())}>It is a folder from git…</button>
          </div>
          {m && (
            <div className="text-sm space-y-1">
              <div><strong>{m.name}</strong>{m.description && <span className="text-muted"> — {m.description}</span>}</div>
              <div className="flex gap-2 flex-wrap">
                <Chip>{plural(m.collections.length, 'scene layout')}</Chip>
                <Chip>{plural(m.profiles.length, 'output setting')}</Chip>
                <Chip>{plural(m.assets.length, 'media file')}</Chip>
                {m.source?.platform && <Chip>made on {m.source.platform === 'win32' ? 'Windows' : m.source.platform === 'darwin' ? 'a Mac' : 'Linux'}</Chip>}
              </div>
              {!bundle?.repoDir && m.repository?.url && (
                <Message tone="good">
                  This setup is kept online at <span className="mono">{m.repository.url}</span>.{existing ? <> You already have it as the preset “{existing.name}”.</> : ''} The file may be older than what is there.
                  <div className="mt-2">
                    <button className="btn btn-accent px-3 py-1" disabled={saving} onClick={useLatest}>{saving ? 'Getting it…' : existing ? 'Get updates and use my preset' : 'Use the latest version from there'}</button>
                  </div>
                </Message>
              )}
              {!bundle?.repoDir && !m.repository?.url && existing && <Message tone="good">You already have this as the preset “{existing.name}”.</Message>}
              {bundle?.repoDir && behind > 0 && (
                <Message tone="warn">
                  A newer version of this preset is online ({plural(behind, 'change')}). Get it first so you apply the latest.
                  <div className="mt-2">
                    <button className="btn btn-accent px-3 py-1" disabled={saving} onClick={getUpdates}>{saving ? 'Getting it…' : 'Get updates first'}</button>
                  </div>
                </Message>
              )}
            </div>
          )}
          {note && !done && <p className="text-sm text-muted">{note}</p>}
        </Step>
      )}

      {m?.containsSecrets && !done && (
        <Message tone="bad">
          <strong>Careful: this file contains stream keys.</strong> Anyone who has it can stream as you. Only use it if you trust where it came from, and delete it afterwards.
        </Message>
      )}

      {m && !done && (
        <>
          <Step n={++step} title="Which OBS should get it?" help={usable.length > 1 ? 'You have more than one OBS on this computer.' : undefined}>
            {usable.length > 1 ? (
              <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)} aria-label="Which OBS">
                {usable.map((i) => <option key={i.id} value={i.id}>{i.label} ({KIND_LABEL[i.kind] ?? i.kind})</option>)}
              </select>
            ) : install ? <p className="text-sm"><strong>{install.label}</strong> <span className="text-muted">({KIND_LABEL[install.kind] ?? install.kind})</span></p> : <Message tone="warn">No OBS found. Add one under “OBS on this computer”.</Message>}
            {install?.running && <Message tone="warn">This OBS is open right now. Close it first: it saves over its files when it closes and would undo it.</Message>}
          </Step>

          <Step n={++step} title="What should be applied?">
            {m.collections.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Scenes</h3>
                {m.collections.map((c) => <Choice key={c.id} checked={scenes.includes(c.id)} onChange={(on) => setScenes(toggle(scenes, c.id, on))} title={c.name} />)}
              </div>
            )}
            {m.profiles.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Output settings <span className="font-normal text-muted">(streaming, recording, video quality)</span></h3>
                {m.profiles.map((c) => <Choice key={c.id} checked={outputs.includes(c.id)} onChange={(on) => setOutputs(toggle(outputs, c.id, on))} title={c.name} />)}
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold">If OBS already has one with the same name</h3>
              <Choice type="radio" name="conflict" checked={conflict === 'replace'} onChange={() => setConflict('replace')} title="Replace it" help="A backup copy of what it replaces is kept first." />
              <Choice type="radio" name="conflict" checked={conflict === 'keep-both'} onChange={() => setConflict('keep-both')} title="Keep both" help="The new one gets “(2)” added to its name." />
              <Choice type="radio" name="conflict" checked={conflict === 'skip'} onChange={() => setConflict('skip')} title="Leave the one OBS has" />
            </div>
            <Choice checked={activate} onChange={setActivate} title="Make OBS use it the next time it starts" />
            {window.obsLoader.platform === 'linux' && (
              <details>
                <summary className="text-sm cursor-pointer text-muted">More options</summary>
                <Choice checked={preferPipewire} onChange={setPreferPipewire} title="Capture screens and windows with PipeWire (Wayland)" help="Only matters if the setup was made on another kind of computer. Untick to use the older X11 capture." />
              </details>
            )}
          </Step>

          {(secretVars.length > 0 || otherVars.length > 0) && (
            <Step
              n={++step} title={m.containsSecrets ? 'Stream keys' : 'Your stream keys'}
              help={m.containsSecrets
                ? 'The keys are inside the file and will be used. Type one only if you want to use a different key.'
                : 'Keys are never stored in a setup file unless the person saving it chose to, so they are asked for here. Leave one empty to keep the key OBS already has.'}
            >
              {secretVars.map((v) => {
                const fromFile = report?.includedSecrets.includes(v.name)
                return (
                  <Field key={v.name} label={v.label ?? 'A stream key'}>
                    <input
                      className="input w-full px-2 py-1.5" type="password" autoComplete="off"
                      placeholder={fromFile ? 'Using the key from the file (type to use a different one)' : 'Leave empty to keep the key OBS already has'}
                      value={variables[v.name] ?? ''}
                      onChange={(e) => setVariables({ ...variables, [v.name]: e.target.value })}
                    />
                  </Field>
                )
              })}
              {otherVars.map((v) => (
                <Field key={v.name} label={v.label ?? v.name}>
                  <input className="input w-full px-2 py-1.5" value={variables[v.name] ?? ''} onChange={(e) => setVariables({ ...variables, [v.name]: e.target.value })} />
                </Field>
              ))}
              {!bundle?.repoDir && !existing && <Choice checked={keepPreset} onChange={setKeepPreset} title="Keep this as a preset on this computer" help={m.repository?.url ? 'Recommended. It stays linked to its online copy, so you can get updates later.' : 'Recommended. You can then load it again, update it and back it up.'} />}
              {secretVars.length > 0 && <Choice checked={remember} onChange={setRemember} title="Remember my stream keys on this computer" help="Kept encrypted by your system's keychain. Nothing is written if your system has none." />}
            </Step>
          )}

          {folderVars.length > 0 && (
            <Step n={++step} title="Where should things be saved?" help="Folders this setup uses. Leave one empty to use the suggested folder.">
              {folderVars.map((v) => (
                <Field key={v.name} label={v.label ?? v.name} hint={v.default ? `Suggested: ${prettyFolder(v.default)}` : undefined}>
                  <div className="flex gap-2">
                    <input className="input flex-1 px-2 py-1.5" value={variables[v.name] ?? ''} onChange={(e) => setVariables({ ...variables, [v.name]: e.target.value })} aria-label={v.label ?? v.name} />
                    <button className="btn px-3" onClick={async () => { const p = await window.obsLoader.files.pick(v.label ?? v.name, true); if (p) setVariables({ ...variables, [v.name]: p }) }}>Browse…</button>
                  </div>
                </Field>
              ))}
            </Step>
          )}

          {bigFiles.length > 0 && (
            <Step n={++step} title="Find your big files" help="These pictures, sounds or videos were too big to put in the file. Tell the app where each one is on this computer (you can also skip this and fix it in OBS later).">
              {bigFiles.map((a) => (
                <div key={a.id} className="bt-row flex items-center gap-3 py-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{a.filename}</div>
                    <div className="text-xs text-muted">{assetFiles[a.id] ?? 'Not chosen yet'}</div>
                  </div>
                  <button className="btn px-3 py-1" onClick={async () => { const p = await window.obsLoader.files.pick(`Find ${a.filename}`); if (p) setAssetFiles({ ...assetFiles, [a.id]: p }) }}>
                    {assetFiles[a.id] ? 'Change…' : 'Find it…'}
                  </button>
                </div>
              ))}
            </Step>
          )}

          {report && install && (
            <Step n={++step} title="Here is what will happen">
              {report.blockers.map((b) => <Message key={b} tone="bad">{b}</Message>)}
              {report.containsSecrets && <Message tone="bad">The stream keys in this file will be put into OBS. Delete the file afterwards.</Message>}

              <ul className="space-y-1.5 text-sm">
                <li>✔ Put {plural(scenes.length, 'scene layout')} and {plural(outputs.length, 'output setting')} into <strong>{install.label}</strong>.</li>
                {(replaced.scenes.length > 0 || replaced.outputs.length > 0) && conflict === 'replace' && (
                  <li>↻ These already exist and will be replaced (a backup copy is kept first): <strong>{[...replaced.scenes, ...replaced.outputs].join(', ')}</strong>.</li>
                )}
                {report.willWrite.some((w) => /\/media\//.test(slashes(w.path))) && <li>✔ Copy the pictures, sounds and videos from the file.</li>}
                {report.includedSecrets.length > 0 && <li>🔑 Use the stream keys from the file ({report.includedSecrets.length}).</li>}
                {report.keptSecrets.length > 0 && <li>🔑 Keep the stream keys OBS already has ({report.keptSecrets.length}).</li>}
                {report.missingVariables.some((v) => v.kind === 'secret') && <li>⚠ No stream key set for: {report.missingVariables.filter((v) => v.kind === 'secret').map((v) => m.variables.find((x) => x.name === v.name)?.label ?? 'a key').join(', ')}. You can add them in OBS later.</li>}
                {report.missingAssets.length > 0 && <li>⚠ Not found yet: {report.missingAssets.map((a) => a.filename).join(', ')}. Those sources will be empty until you point to the files.</li>}
              </ul>

              {report.warnings.map((w) => <Message key={w} tone="warn">{w}</Message>)}

              {report.substitutions.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Screen, window and sound capture</h3>
                  <p className="text-xs text-muted">These work differently on each kind of computer, so they are set up per computer.</p>
                  {report.substitutions.map((s) => (
                    <div key={s.source + s.from} className="text-sm bt-row py-1 space-y-1">
                      <div>
                        <strong>{s.source}</strong>: {s.result === 'variant' ? 'using the version you saved for this kind of computer.'
                          : s.result === 'added' ? `${s.note ?? ''}`
                          : s.result === 'substituted' ? <>this setup was made for another kind of computer, so <strong>{s.toName ?? 'a matching capture'}</strong> was put in place of {s.fromName ?? 'it'}. Choose the window or screen again in OBS.</>
                          : s.key && choices[s.key] === null ? 'hidden, as you chose (not deleted).'
                          : 'there is no equivalent on this computer, so it is hidden (not deleted).'}
                      </div>
                      {(s.result === 'substituted' || s.result === 'disabled') && s.key && (
                        <label className="flex items-center gap-2 pl-3">
                          <span className="text-muted shrink-0">Use instead:</span>
                          <select
                            className="input flex-1 px-2 py-1" aria-label={`What ${s.source} becomes`}
                            value={s.key in choices ? (choices[s.key] === null ? '__hide__' : choices[s.key]!) : ''}
                            onChange={(e) => {
                              const v = e.target.value; const k = s.key!
                              const next = { ...choices }
                              if (v === '') delete next[k]; else next[k] = v === '__hide__' ? null : v
                              setChoices(next)
                            }}
                          >
                            <option value="">{s.result === 'substituted' ? `Automatic: ${s.toName ?? 'a matching capture'}` : 'Automatic: hide it'}</option>
                            <option value="__hide__">Hide it</option>
                            {(s.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {report.plugins.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">OBS plugins this setup uses</h3>
                  <p className="text-xs text-muted">Plugins are not part of the file. A missing plugin never stops you applying it: its sources just stay empty until you install it and restart OBS. Plugins that do not exist for this kind of computer are not needed here.</p>
                  {report.plugins.map((f) => (
                    <div key={f.plugin.id} className="bt-row py-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{f.plugin.name}</span>
                        <Chip tone={f.status === 'present' ? 'good' : f.status === 'missing' ? 'warn' : f.status === 'not-needed' ? undefined : 'warn'}>
                          {f.status === 'present' ? 'installed' : f.status === 'missing' ? 'not installed' : f.status === 'not-needed' ? 'not needed on this computer' : 'could not check'}
                        </Chip>
                        {f.plugin.homepage && <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => window.obsLoader.app.openExternal(f.plugin.homepage!)}>Where to get it</button>}
                      </div>
                      {f.status !== 'present' && f.status !== 'not-needed' && f.plugin.install?.[pluginKey as keyof NonNullable<typeof f.plugin.install>] && (
                        <pre className="cmd mono rounded-theme">{f.plugin.install[pluginKey as keyof NonNullable<typeof f.plugin.install>]}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {liveChanges.length > 0 && (
                <Message tone="warn">
                  OBS has changes that are not saved in this preset yet. Applying it would replace them, so save them to the preset first.
                  <div className="mt-2">
                    <button className="btn btn-accent px-3 py-1" disabled={saving} onClick={async () => {
                      setSaving(true)
                      const r = await window.obsLoader.repos.save(repoDir!, installId, false)
                      setSaving(false)
                      if (r.status === 'dirty') setError('Some files in the preset were changed by hand. Open “Presets” to deal with them first.')
                      else if (r.status === 'error') setError(r.message)
                      else if (r.status === 'conflict') setError('Your OBS and the preset both changed the same part. Open “Presets” to choose which to keep.')
                      else await checkLive()
                    }}>{saving ? 'Saving…' : 'Save them to the preset now'}</button>
                  </div>
                </Message>
              )}

              <details>
                <summary className="text-sm cursor-pointer text-muted">Show details ({plural(report.willWrite.filter((w) => w.action !== 'skip').length, 'file')} will be written)</summary>
                <ul className="mono text-muted mt-2 space-y-0.5">
                  {report.willWrite.map((w) => <li key={w.path}>{w.action}: {w.path}</li>)}
                </ul>
              </details>

              <button className="btn btn-accent px-5 py-2.5 text-base" disabled={busy || report.blockers.length > 0 || report.willWrite.length === 0 || scenes.length + outputs.length === 0} onClick={apply}>
                {busy ? 'Applying…' : liveChanges.length > 0 ? 'Apply to OBS anyway' : 'Apply to OBS'}
              </button>
            </Step>
          )}
        </>
      )}
    </Page>
  )
}
