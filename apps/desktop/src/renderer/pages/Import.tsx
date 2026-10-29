import { useEffect, useMemo, useRef, useState } from 'react'
import type { BundleSummary, ConflictMode, ImportReport, ImportRequest, InstallInfo } from '../../../electron/api'
import { Card, Chip, Field, KIND_LABEL, Message, Page } from '../ui'

export function ImportPage({ installs, preselect, openPath, refresh }: { installs: InstallInfo[] | null; preselect?: string; openPath?: string; refresh: () => Promise<void> }) {
  const [bundle, setBundle] = useState<BundleSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installId, setInstallId] = useState<string>(preselect ?? '')
  const [collections, setCollections] = useState<string[]>([])
  const [profiles, setProfiles] = useState<string[]>([])
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [assetFiles, setAssetFiles] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState<ConflictMode>('replace')
  const [activate, setActivate] = useState(true)
  const [preferPipewire, setPreferPipewire] = useState(true)
  const [remember, setRemember] = useState(true)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [liveChanges, setLiveChanges] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const usable = useMemo(() => (installs ?? []), [installs])
  useEffect(() => { if (!installId && usable[0]) setInstallId(usable[0].id) }, [usable, installId])
  const install = usable.find((i) => i.id === installId)

  const load = async (r: BundleSummary | { error: string } | null) => {
    if (!r) return
    if ('error' in r) { setError(r.error); return }
    setError(null); setDone(null); setReport(null)
    setBundle(r)
    setCollections(r.manifest.collections.map((c) => c.id))
    setProfiles(r.manifest.profiles.map((c) => c.id))
    // what this computer remembers about the bundle: where its media are, folder choices, secrets
    const [loc, secrets] = await Promise.all([window.obsLoader.locations.load(r.manifest.id), window.obsLoader.secrets.load(r.manifest.id)])
    setAssetFiles(loc.assets)
    setVariables({ ...loc.variables, ...secrets })
  }

  useEffect(() => { if (openPath) void window.obsLoader.bundle.openPath(openPath).then(load) }, [openPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // A repository folder: warn when OBS has edits the repo does not have yet, because importing would replace them.
  const repoDir = bundle?.repoDir
  const checkLive = async () => {
    if (!repoDir || !installId) { setLiveChanges([]); return }
    const r = await window.obsLoader.repos.live(repoDir, installId)
    setLiveChanges('error' in r ? [] : r.changed)
  }
  useEffect(() => { void checkLive() }, [repoDir, installId, done]) // eslint-disable-line react-hooks/exhaustive-deps

  const request = (): ImportRequest => ({
    handle: bundle!.handle, installId, collections, profiles, variables: clean(variables), assetFiles, conflict, activate, preferPipewire,
  })

  // Re-run the dry run whenever an answer changes, so the report is always about what "Import" would do.
  const seq = useRef(0)
  useEffect(() => {
    if (!bundle || !installId) return
    const n = ++seq.current
    const t = setTimeout(() => {
      window.obsLoader.import.plan(request()).then((r) => { if (n === seq.current) setReport(r) }).catch((e) => setError(String(e.message ?? e)))
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, installId, collections, profiles, variables, assetFiles, conflict, activate, preferPipewire])

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
      setDone(`Imported ${r.written} file${r.written === 1 ? '' : 's'}.` + (r.backedUp ? ` ${r.backedUp} existing file${r.backedUp === 1 ? ' was' : 's were'} backed up to ${r.backupDir}.` : ''))
      await refresh()
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const m = bundle?.manifest
  const pluginKey = window.obsLoader.platform === 'win32' ? 'windows' : window.obsLoader.platform === 'darwin' ? 'macos'
    : install?.kind === 'flatpak' ? 'linux-flatpak' : 'linux-native'

  return (
    <Page title="Import a setup" intro="Open a bundle, pick the OBS to load it into, check the report, then import. Nothing is written until you press Import.">
      {error && <Message tone="bad">{error}</Message>}
      {done && <Message tone="good">{done} Start OBS to use it.</Message>}

      <Card title="1. The bundle">
        <div
          className={'bt-sel p-4 text-center text-sm rounded-theme border border-dashed border-line' + (drag ? ' bg-raised' : '')}
          data-selected={drag ? '' : undefined}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={async (e) => {
            e.preventDefault(); setDrag(false)
            const f = e.dataTransfer.files[0]
            if (f) await load(await window.obsLoader.bundle.openPath(window.obsLoader.pathForFile(f)))
          }}
        >
          Drop a <span className="mono">.obsbundle</span> or <span className="mono">.zip</span> here
        </div>
        <div className="flex gap-2">
          <button className="btn btn-accent px-3 py-1.5" onClick={async () => load(await window.obsLoader.bundle.open())}>Open a file…</button>
          <button className="btn px-3 py-1.5" onClick={async () => load(await window.obsLoader.bundle.openFolder())}>Open a folder (git checkout)…</button>
        </div>
        {m && (
          <div className="text-sm space-y-1">
            <div><strong>{m.name}</strong> {m.description && <span className="text-muted">: {m.description}</span>}</div>
            <div className="flex gap-2 flex-wrap">
              <Chip>{m.collections.length} scene collection{m.collections.length === 1 ? '' : 's'}</Chip>
              <Chip>{m.profiles.length} profile{m.profiles.length === 1 ? '' : 's'}</Chip>
              <Chip>{m.assets.length} media file{m.assets.length === 1 ? '' : 's'}</Chip>
              {m.source?.platform && <Chip>made on {m.source.platform}</Chip>}
            </div>
          </div>
        )}
      </Card>

      {m && (
        <>
          <Card title="2. Where to load it">
            <Field label="OBS install">
              <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)}>
                {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
              </select>
            </Field>
            {install && <p className="mono text-muted">{install.configDir}</p>}
            {m.collections.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Scene collections</legend>
                {m.collections.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={collections.includes(c.id)} onChange={(e) => setCollections(toggle(collections, c.id, e.target.checked))} /> {c.name}
                  </label>
                ))}
              </fieldset>
            )}
            {m.profiles.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Profiles</legend>
                {m.profiles.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={profiles.includes(c.id)} onChange={(e) => setProfiles(toggle(profiles, c.id, e.target.checked))} /> {c.name}
                  </label>
                ))}
              </fieldset>
            )}
            <Field label="If something with the same name already exists">
              <select className="input w-full px-2 py-1.5" value={conflict} onChange={(e) => setConflict(e.target.value as ConflictMode)}>
                <option value="replace">Replace it (a backup is kept)</option>
                <option value="keep-both">Keep both (import as “Name (2)”)</option>
                <option value="skip">Skip it</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Make it the active collection and profile</label>
            {window.obsLoader.platform === 'linux' && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preferPipewire} onChange={(e) => setPreferPipewire(e.target.checked)} /> Use PipeWire for screen and window capture (Wayland), not X11</label>
            )}
          </Card>

          {m.variables.length > 0 && (
            <Card title="3. Your details">
              <p className="text-sm text-muted">Secrets are never stored in a bundle, so they are asked for here. Leave a folder blank to use the suggested place.</p>
              {m.variables.map((v) => (
                <Field key={v.name} label={v.label ?? v.name} hint={v.kind === 'path' && v.default ? `Left blank: ${prettyFolder(v.default)}` : undefined}>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 px-2 py-1.5"
                      type={v.kind === 'secret' ? 'password' : 'text'}
                      autoComplete="off"
                      value={variables[v.name] ?? ''}
                      onChange={(e) => setVariables({ ...variables, [v.name]: e.target.value })}
                    />
                    {v.kind === 'path' && (
                      <button className="btn px-3" onClick={async () => { const p = await window.obsLoader.files.pick(v.label ?? v.name, true); if (p) setVariables({ ...variables, [v.name]: p }) }}>Browse…</button>
                    )}
                  </div>
                </Field>
              ))}
              {m.variables.some((v) => v.kind === 'secret') && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember secrets on this computer (encrypted with the system keychain)</label>
              )}
            </Card>
          )}

          {m.assets.some((a) => a.mode === 'external') && (
            <Card title="4. Media you need to point to">
              <p className="text-sm text-muted">These files are too big or private to travel with the setup. Choose where each one is on this computer.</p>
              {m.assets.filter((a) => a.mode === 'external').map((a) => (
                <div key={a.id} className="bt-row flex items-center gap-3 py-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{a.filename}</div>
                    <div className="text-xs text-muted">{assetFiles[a.id] ?? a.hint ?? 'Not chosen yet'}</div>
                  </div>
                  <button className="btn px-3 py-1" onClick={async () => { const p = await window.obsLoader.files.pick(`Find ${a.filename}`); if (p) setAssetFiles({ ...assetFiles, [a.id]: p }) }}>
                    {assetFiles[a.id] ? 'Change…' : 'Locate…'}
                  </button>
                </div>
              ))}
            </Card>
          )}

          {report && (
            <Card title="Report: what Import will do">
              {report.blockers.map((b) => <Message key={b} tone="bad">{b}</Message>)}
              {report.warnings.map((w) => <Message key={w} tone="warn">{w}</Message>)}

              {report.plugins.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Plugins this setup uses</h3>
                  {report.plugins.map((f) => (
                    <div key={f.plugin.id} className="bt-row py-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{f.plugin.name}</span>
                        <Chip tone={f.status === 'present' ? 'good' : f.status === 'missing' ? 'bad' : 'warn'}>
                          {f.status === 'present' ? 'installed' : f.status === 'missing' ? 'not installed' : "can't tell"}
                        </Chip>
                        {f.plugin.homepage && <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => window.obsLoader.app.openExternal(f.plugin.homepage!)}>Project page</button>}
                      </div>
                      {f.status !== 'present' && f.plugin.install?.[pluginKey as keyof NonNullable<typeof f.plugin.install>] && (
                        <pre className="cmd mono rounded-theme">{f.plugin.install[pluginKey as keyof NonNullable<typeof f.plugin.install>]}</pre>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-muted">Plugins are never part of a bundle. Install them yourself, then start OBS.</p>
                </div>
              )}

              {report.substitutions.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-semibold text-sm">Sources that had to change for this computer</h3>
                  {report.substitutions.map((s) => (
                    <div key={s.source + s.from} className="text-sm bt-row py-1">
                      <strong>{s.source}</strong>: {s.result === 'substituted' ? <>now <span className="mono">{s.to}</span> (was <span className="mono">{s.from}</span>)</> : <>no equivalent for <span className="mono">{s.from}</span>, kept but hidden</>}
                      {s.note && <span className="text-muted"> {s.note}</span>}
                    </div>
                  ))}
                </div>
              )}

              {(report.missingVariables.length > 0 || report.missingAssets.length > 0) && (
                <Message tone="warn">
                  Still empty: {[...report.missingVariables.map((v) => v.name), ...report.missingAssets.map((a) => a.filename)].join(', ')}. You can import now and fill these in OBS later.
                </Message>
              )}

              <details>
                <summary className="text-sm cursor-pointer">{report.willWrite.filter((w) => w.action !== 'skip').length} files will be written</summary>
                <ul className="mono text-muted mt-2 space-y-0.5">
                  {report.willWrite.map((w) => <li key={w.path}>{w.action}: {w.path}</li>)}
                </ul>
              </details>

              {liveChanges.length > 0 && (
                <Message tone="warn">
                  OBS has changes that are not in this repository yet ({liveChanges.join(', ')}). Importing replaces them (a backup is kept), so save them to the repository first.
                  <div className="mt-2">
                    <button className="btn btn-accent px-3 py-1" disabled={saving} onClick={async () => {
                      setSaving(true)
                      const r = await window.obsLoader.repos.save(repoDir!, installId, false)
                      setSaving(false)
                      if (r.status === 'dirty') setError(`The repository has uncommitted edits (${r.files.join(', ')}). Use the Git repositories page to commit them first.`)
                      else if (r.status === 'error') setError(r.message)
                      else if (r.status === 'conflict') setError(`OBS and the repository changed the same part of ${r.conflicts.join(', ')}. Resolve it on the Git repositories page first.`)
                      else await checkLive()
                    }}>{saving ? 'Saving…' : 'Save them to the repository now'}</button>
                  </div>
                </Message>
              )}
              <div className="flex gap-2">
                <button className="btn btn-accent px-4 py-2" disabled={busy || report.blockers.length > 0 || report.willWrite.length === 0} onClick={apply}>
                  {busy ? 'Importing…' : liveChanges.length > 0 ? 'Import anyway' : 'Import'}
                </button>
              </div>
            </Card>
          )}
        </>
      )}
    </Page>
  )
}

const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))
const clean = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))

const FOLDER_NAMES: Record<string, string> = { home: 'your home folder', documents: 'Documents', videos: 'Videos', music: 'Music', pictures: 'Pictures', desktop: 'Desktop' }
const prettyFolder = (d: string) => d.replace(/^\{\{([a-z]+)\}\}/, (_w, k: string) => FOLDER_NAMES[k] ?? k).replace(/\//g, ' › ')
