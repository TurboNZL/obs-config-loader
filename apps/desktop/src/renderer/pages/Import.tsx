import { useEffect, useMemo, useRef, useState } from 'react'
import type { BundleSummary, ConflictMode, ImportReport, ImportRequest, InstallInfo } from '../../../electron/api'
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
  const [remember, setRemember] = useState(true)
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
    setError(null); setDone(null); setReport(null); setNote(null)
    setBundle(r)
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
    handle: bundle!.handle, installId, collections: scenes, profiles: outputs, variables: clean(variables), assetFiles, conflict, activate, preferPipewire,
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
  }, [bundle, installId, scenes, outputs, variables, assetFiles, conflict, activate, preferPipewire])

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
    <Page title="Load a setup into OBS" intro="Open a setup file, choose which OBS it goes into, and check what will happen. Nothing changes until you press the button at the end.">
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
              <button className="btn px-3 py-2" onClick={() => { setDone(null); setBundle(null); setReport(null) }}>Load another file</button>
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
              {!bundle?.repoDir && (
                <button className="btn btn-ghost px-2 py-1 text-xs" disabled={saving} onClick={async () => {
                  setSaving(true); setError(null)
                  const folder = await window.obsLoader.repos.suggestFolder(m.name)
                  const r = await window.obsLoader.repos.fromBundle(bundle!.handle, folder)
                  setSaving(false)
                  if (r.ok) setNote(`Started an online-backup folder for this setup at ${r.repo.path}. Find it under “Online backup”.`); else setError(r.error)
                }}>Start an online backup from this file…</button>
              )}
            </div>
          )}
          {note && !done && <p className="text-sm text-muted">{note}</p>}
        </Step>
      )}

      {m?.containsSecrets && !done && (
        <Message tone="bad">
          <strong>Careful: this file contains stream keys.</strong> Anyone who has it can stream as you. Only load it if you trust where it came from, and delete it afterwards.
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
            {install?.running && <Message tone="warn">This OBS is open right now. Close it first: it saves over its files when it closes and would undo the load.</Message>}
          </Step>

          <Step n={++step} title="What should be loaded?">
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
                <li>✔ Load {plural(scenes.length, 'scene layout')} and {plural(outputs.length, 'output setting')} into <strong>{install.label}</strong>.</li>
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
                    <div key={s.source + s.from} className="text-sm bt-row py-1">
                      <strong>{s.source}</strong>: {s.result === 'variant' ? 'using the version you saved for this kind of computer.'
                        : s.result === 'substituted' ? 'this setup was made for another kind of computer, so a matching capture was put in its place. Choose the window or screen again in OBS.'
                        : 'there is no equivalent on this computer, so it is hidden (not deleted).'}
                    </div>
                  ))}
                </div>
              )}

              {report.plugins.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">OBS plugins this setup uses</h3>
                  <p className="text-xs text-muted">Plugins are not part of the file. Install any that are missing, then restart OBS.</p>
                  {report.plugins.map((f) => (
                    <div key={f.plugin.id} className="bt-row py-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{f.plugin.name}</span>
                        <Chip tone={f.status === 'present' ? 'good' : f.status === 'missing' ? 'bad' : 'warn'}>
                          {f.status === 'present' ? 'installed' : f.status === 'missing' ? 'not installed' : 'could not check'}
                        </Chip>
                        {f.plugin.homepage && <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => window.obsLoader.app.openExternal(f.plugin.homepage!)}>Where to get it</button>}
                      </div>
                      {f.status !== 'present' && f.plugin.install?.[pluginKey as keyof NonNullable<typeof f.plugin.install>] && (
                        <pre className="cmd mono rounded-theme">{f.plugin.install[pluginKey as keyof NonNullable<typeof f.plugin.install>]}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {liveChanges.length > 0 && (
                <Message tone="warn">
                  OBS has changes that are not saved in your online backup yet. Loading would replace them, so save them to the backup first.
                  <div className="mt-2">
                    <button className="btn btn-accent px-3 py-1" disabled={saving} onClick={async () => {
                      setSaving(true)
                      const r = await window.obsLoader.repos.save(repoDir!, installId, false)
                      setSaving(false)
                      if (r.status === 'dirty') setError('Some files in the backup folder were changed by hand. Open “Online backup” to deal with them first.')
                      else if (r.status === 'error') setError(r.message)
                      else if (r.status === 'conflict') setError('Your OBS and the backup both changed the same part. Open “Online backup” to choose which to keep.')
                      else await checkLive()
                    }}>{saving ? 'Saving…' : 'Save them to the backup now'}</button>
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
                {busy ? 'Loading…' : liveChanges.length > 0 ? 'Load into OBS anyway' : 'Load into OBS'}
              </button>
            </Step>
          )}
        </>
      )}
    </Page>
  )
}
