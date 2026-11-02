import { useEffect, useState } from 'react'
import type { InstallInfo } from '../../../electron/api'
import { Card, Chip, Field, KIND_LABEL, Message, Page } from '../ui'

export function InstallsPage({ installs, refresh, go }: {
  installs: InstallInfo[] | null
  refresh: () => Promise<void>
  go: (t: 'import' | 'export', installId?: string) => void
}) {
  const [msg, setMsg] = useState<string | null>(null)

  const addPortable = async () => {
    const r = await window.obsLoader.installs.addPortable()
    if (r.error) setMsg(r.error)
    else if (r.added) { setMsg(null); await refresh() }
  }

  return (
    <Page
      title="OBS on this computer"
      intro="Every copy of OBS this app can find. If you keep OBS in its own folder, add it by hand below."
    >
      {msg && <Message tone="bad">{msg}</Message>}
      {installs === null && <p className="text-muted">Looking for OBS…</p>}
      {installs?.length === 0 && (
        <Message tone="warn">
          No OBS found in the usual places. Install OBS Studio, or add one that lives in its own folder below.
        </Message>
      )}
      {installs?.map((i) => <InstallCard key={i.id} i={i} refresh={refresh} go={go} />)}
      <div className="flex gap-2">
        <button className="btn px-3 py-1.5" onClick={addPortable}>Add OBS from a folder…</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={() => void refresh()}>Refresh</button>
      </div>
      {installs && installs.length > 0 && <NewInstance installs={installs} refresh={refresh} />}
    </Page>
  )
}

type Start = { phase: 'idle' } | { phase: 'starting' } | { phase: 'checking' } | { phase: 'own' } | { phase: 'notown' } | { phase: 'failed'; message: string; command?: string }

function InstallCard({ i, refresh, go }: { i: InstallInfo; refresh: () => Promise<void>; go: (t: 'import' | 'export', installId?: string) => void }) {
  const [start, setStart] = useState<Start>({ phase: 'idle' })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const isInstance = i.kind === 'instance'

  const launch = async () => {
    setStart({ phase: 'starting' })
    const since = Date.now()
    const r = await window.obsLoader.installs.launch(i.id)
    if (!r.ok) { setStart({ phase: 'failed', message: r.message, command: r.command }); return }
    if (!isInstance) { setStart({ phase: 'idle' }); void refresh(); return }
    // a separate OBS must show up with its own settings folder; if it does not, it is using the main one
    setStart({ phase: 'checking' })
    for (let n = 0; n < 15; n++) {
      await new Promise((res) => setTimeout(res, 2000))
      if ((await window.obsLoader.installs.verify(i.id, since)).usesOwnSettings) { setStart({ phase: 'own' }); void refresh(); return }
    }
    setStart({ phase: 'notown' })
  }

  return (
    <Card
      title={<span>{i.label}</span>}
      right={<div className="flex gap-2 flex-wrap justify-end">
        <Chip>{isInstance ? `second OBS · made from ${i.baseLabel ?? '?'}` : KIND_LABEL[i.kind] ?? i.kind}</Chip>
        {i.running && <Chip tone="warn">open now</Chip>}
        {!i.configExists && <Chip tone="warn">never opened</Chip>}
        {i.custom && !isInstance && <Chip>added by you</Chip>}
      </div>}
    >
      <p className="mono text-muted">{i.configDir}</p>
      {i.configExists && (
        <p className="text-sm text-muted">
          {i.collections.length} scene layout{i.collections.length === 1 ? '' : 's'}, {i.profiles.length} output setting{i.profiles.length === 1 ? '' : 's'}
          {i.collections.length > 0 && <>: {i.collections.slice(0, 4).join(', ')}{i.collections.length > 4 ? '…' : ''}</>}
        </p>
      )}
      {isInstance && <p className="text-sm text-muted">Plugins you put in <span className="mono">{i.pluginDirs[0]}</span> only load in this OBS.</p>}

      {start.phase === 'starting' && <p className="text-sm text-muted">Starting…</p>}
      {start.phase === 'checking' && <p className="text-sm text-muted">Started. Checking that it is using its own settings (about 30 seconds)…</p>}
      {start.phase === 'own' && <Message tone="good">It is open and using its own settings.</Message>}
      {start.phase === 'notown' && (
        <Message tone="warn">
          OBS did not create its own settings folder within 30 seconds. Either it is still starting, or {i.instance?.baseKind === 'flatpak'
            ? 'Flatpak ignored the setting and it opened with your main OBS settings'
            : 'it opened with your main OBS settings'}. Do not import into it until this shows "running with its own settings". Close it and press Start again to re-check.
        </Message>
      )}
      {start.phase === 'failed' && (
        <Message tone="bad">
          {start.message}
          {start.command && <div className="mt-1"><span className="text-xs text-muted">It tried to run:</span> <span className="mono">{start.command}</span></div>}
        </Message>
      )}

      <div className="flex gap-2 flex-wrap">
        {i.launch && <button className="btn px-3 py-1.5" disabled={start.phase === 'starting' || start.phase === 'checking'} onClick={launch}>Start OBS</button>}
        <button className="btn btn-accent px-3 py-1.5" onClick={() => go('import', i.id)}>Load a setup here</button>
        <button className="btn px-3 py-1.5" disabled={!i.configExists} onClick={() => go('export', i.id)}>Save this setup to a file</button>
        <button className="btn btn-ghost px-3 py-1.5" disabled={!i.configExists} onClick={() => window.obsLoader.installs.openFolder(i.id)}>Show its folder</button>
        {isInstance && <button className="btn btn-ghost px-3 py-1.5" onClick={() => window.obsLoader.instances.openPlugins(i.id)}>Show plugins folder</button>}
        {i.custom && <button className="btn btn-ghost px-3 py-1.5" onClick={() => setConfirmRemove(true)}>Remove from this list…</button>}
      </div>

      {confirmRemove && (
        <Message tone="warn">
          Remove “{i.label}” from the list?
          {isInstance && (
            <label className="flex items-center gap-2 text-sm mt-1"><input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} /> Also delete its settings and plugins (cannot be undone)</label>
          )}
          <div className="mt-2 flex gap-2">
            <button className="btn btn-accent px-3 py-1" onClick={async () => {
              if (isInstance) await window.obsLoader.instances.remove(i.id, deleteFiles); else await window.obsLoader.installs.remove(i.id)
              setConfirmRemove(false); await refresh()
            }}>Remove</button>
            <button className="btn btn-ghost px-3 py-1" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </div>
        </Message>
      )}
    </Card>
  )
}

/** Make another OBS with its own settings and plugins (e.g. a light one for everyday and one with heavy plugins). */
function NewInstance({ installs, refresh }: { installs: InstallInfo[]; refresh: () => Promise<void> }) {
  const bases = installs.filter((i) => i.kind !== 'instance')
  const [baseId, setBaseId] = useState('')
  const [name, setName] = useState('Second OBS')
  const [copy, setCopy] = useState(true)
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!baseId && bases[0]) setBaseId(bases[0].id) }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!baseId) return
    void window.obsLoader.instances.support(baseId, name).then((s) => setReason(s.ok ? null : s.reason))
  }, [baseId, name])

  const base = bases.find((b) => b.id === baseId)
  return (
    <Card title="Make a second OBS (with its own plugins)">
      <p className="text-sm text-muted">
        A second copy of OBS that keeps its own scenes, settings and plugins. Put a heavy plugin (like a multistream add-on) only in this one, and your everyday OBS stays quick to start. Both can be open at the same time.
      </p>
      {error && <Message tone="bad">{error}</Message>}
      <Field label="Make it from which OBS?">
        <select className="input w-full px-2 py-1.5" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.label}: {KIND_LABEL[b.kind] ?? b.kind}</option>)}
        </select>
      </Field>
      {reason && <Message tone="warn">{reason}</Message>}
      {!reason && base?.kind === 'flatpak' && (
        <Message tone="warn">Flatpak is new ground for this: the app starts it and then checks that it really got its own settings folder, and tells you if it did not.</Message>
      )}
      <Field label="Name"><input className="input w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Start with a copy of that OBS's scenes and settings (plugins are never copied)</label>
      <button className="btn btn-accent px-4 py-2" disabled={busy || !!reason || !name.trim() || !baseId} onClick={async () => {
        setBusy(true); setError(null)
        const r = await window.obsLoader.instances.create({ baseId, name: name.trim(), copySettings: copy })
        setBusy(false)
        if (r.ok) await refresh(); else setError(r.error)
      }}>{busy ? 'Making it…' : 'Make it'}</button>
    </Card>
  )
}
