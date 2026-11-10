import { useEffect, useState } from 'react'
import type { PresetOverview, RepoInfo } from '../../../electron/api'
import { Message, size } from '../ui'
import { Icon, type IconName } from './Icon'
import { StorageForm } from './StorageCard'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

function Box({ checked, onChange, label, disabled, kind }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; kind: 'local' | 'cloud' | 'store' }) {
  return <input type="checkbox" aria-label={label} title={label} className={`kind-${kind}`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
}

function Row({ icon, label, aria, note, local, cloudOn, onLocal, onCloud, cloudDisabled, cloudNote, busy, store }: {
  icon: IconName; label: string; aria?: string; note?: string; local: boolean; cloudOn: boolean; onLocal?: (on: boolean) => void; onCloud?: (on: boolean) => void; cloudDisabled?: boolean; cloudNote?: string; busy: boolean
  /** The third column: only files can be kept in the big-file storage. */
  store?: { on: boolean; set: (on: boolean) => void; disabled?: boolean; progress?: string }
}) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-2"><div className="flex items-center gap-2 text-sm"><Icon name={icon} size={14} className="text-muted" /><span className="min-w-0">{label}</span></div>{note && <div className="text-xs text-muted pl-6">{note}</div>}</td>
      <td className="text-center w-24">{onLocal ? <Box kind="local" checked={local} disabled={busy} onChange={onLocal} label={`Keep ${aria ?? label} on this computer`} /> : <Icon name="check" size={15} className="kind-local kind-text inline" />}</td>
      <td className="text-center w-24">
        {onCloud ? <Box kind="cloud" checked={cloudOn && local} disabled={busy || !local || cloudDisabled} onChange={onCloud} label={`Upload ${aria ?? label} to GitHub`} /> : <span title={cloudNote} className="text-muted text-xs">{cloudNote ?? '—'}</span>}
      </td>
      <td className="text-center w-24">
        {store ? (store.progress ? <span className="text-xs kind-store kind-text">{store.progress}</span> : <Box kind="store" checked={store.on} disabled={busy || store.disabled} onChange={store.set} label={`Keep ${aria ?? label} in the big-file storage`} />) : <span className="text-muted text-xs">—</span>}
      </td>
    </tr>
 
  )
}

/**
 * Where each part of a preset lives. The first column is the preset on this computer (it can hold everything); the second is what
 * is uploaded when the preset is backed up on GitHub. Stream keys are never uploaded.
 */
export function StoragePanel({ repo, ov, changed }: { repo: RepoInfo; ov: PresetOverview; changed: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  const online = !!repo.remoteUrl
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState(false)
  useEffect(() => window.obsLoader.storage.onProgress((p) => setProgress((cur) => ({ ...cur, [p.id]: p.done >= p.total ? '' : `${Math.round((p.done / Math.max(1, p.total)) * 100)}%` }))), [])

  const run = async (f: () => Promise<{ ok: boolean; error?: string; pushed?: boolean } | void>, ok?: string) => {
    setBusy(true); setMsg(null)
    const r = await f()
    setBusy(false)
    if (r && !r.ok) setMsg({ tone: 'bad', text: r.error ?? 'That did not work.' })
    else setMsg({ tone: 'good', text: ok ?? 'Changed.' })
    await changed()
  }
  const flip = (list: string[], id: string, on: boolean) => (on ? list.filter((x) => x !== id) : [...list, id])
  const skippedLayouts = ov.layouts.filter((l) => !l.cloud).map((l) => l.id)
  const skippedOutputs = ov.outputs.filter((l) => !l.cloud).map((l) => l.id)
  const cloud = (patch: NonNullable<Parameters<typeof window.obsLoader.presets.setStorage>[1]['cloud']>) =>
    run(() => window.obsLoader.presets.setStorage(repo.path, { cloud: patch }), online ? 'Changed. GitHub is updated.' : 'Changed. It applies when this preset is backed up online.')
  const exclude = async (part: 'collections' | 'profiles' | 'scripts' | 'remoteControl', name: string | undefined, keep: boolean) => {
    const d = await window.obsLoader.presets.details(repo.path)
    const ex = { ...d.exclude }
    if (part === 'collections' || part === 'profiles') ex[part] = keep ? (ex[part] ?? []).filter((n) => n !== name) : [...(ex[part] ?? []), name!]
    else ex[part] = !keep
    return window.obsLoader.presets.setExclude(repo.path, ex)
  }
  const mediaUp = ov.files.filter((f) => f.cloud).map((f) => f.id)
  const copyOff = ov.files.filter((f) => !f.keepCopy).map((f) => f.id)
  const stored = ov.files.filter((f) => f.stored).map((f) => f.id)
  const missingStored = ov.files.filter((f) => f.stored && !f.available)
  const storageOn = useStorageOn()

  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-semibold text-sm">Where each part is kept</h3>
        <p className="text-xs text-muted">The preset on this computer can hold everything. Untick a part in the GitHub column to keep it only here.{online ? '' : ' (This preset is not backed up online yet, so nothing is uploaded until you switch that on.)'}</p>
      </div>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      {ov.storage && !ov.storage.connected && (
        <Message tone="warn">
          <p>This preset keeps big files in <strong>{ov.storage.label}</strong>, and this computer has no keys for it yet.</p>
          {connecting
            ? <div className="mt-2"><StorageForm fixed={ov.storage.target} onSaved={async () => { setConnecting(false); setMsg({ tone: 'good', text: 'Connected.' }); await changed() }} onCancel={() => setConnecting(false)} /></div>
            : <button className="btn px-3 py-1 mt-1" onClick={() => setConnecting(true)}>Enter the keys…</button>}
        </Message>
      )}
      <PairBox repo={repo} hasStorage={!!ov.storage} own={!!ov.storage?.own} done={async (text) => { setMsg({ tone: 'good', text }); await changed() }} />
      {missingStored.length > 0 && ov.storage?.connected && (
        <Message tone="warn">
          <p>{missingStored.length === 1 ? '1 file is' : `${missingStored.length} files are`} in your big-file storage but not on this computer yet ({missingStored.map((f) => f.filename).join(', ')}).</p>
          <button className="btn px-3 py-1 mt-1" disabled={busy} onClick={() => run(async () => {
            const r = await window.obsLoader.presets.fetchStored(repo.path)
            if (!r.ok) return r
            if (r.failed.length) return { ok: false, error: r.failed.map((x) => `${x.filename}: ${x.error}`).join(' ') }
          }, 'Downloaded.')}>{busy ? 'Downloading…' : 'Download from storage'}</button>
        </Message>
      )}
      <table className="w-full">
        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left font-normal pb-1">Part</th>
            <th className="font-normal pb-1 kind-local"><span className="inline-flex items-center gap-1 kind-text"><Icon name="drive" size={13} /> This computer</span></th>
            <th className="font-normal pb-1 kind-cloud"><span className="inline-flex items-center gap-1 kind-text"><Icon name="cloud" size={13} /> GitHub</span></th>
            <th className="font-normal pb-1 kind-store"><span className="inline-flex items-center gap-1 kind-text"><Icon name="box" size={13} /> Big-file storage</span></th>
          </tr>
        </thead>
        <tbody>
          {ov.layouts.map((l) => (
            <Row busy={busy} key={'l' + l.id} icon="grid" label={l.name} aria={`scene layout ${l.name}`} note={`scene layout · ${l.scenes} scenes`} local={l.local} cloudOn={l.cloud}
              onLocal={(on) => run(() => exclude('collections', l.name, on), 'Changed. It applies the next time you update this preset from OBS.')}
              onCloud={(on) => cloud({ layouts: flip(skippedLayouts, l.id, on) })} />
          ))}
          {ov.outputs.map((o) => (
            <Row busy={busy} key={'o' + o.id} icon="settings" label={o.name} aria={`output settings ${o.name}`} note="output settings" local={o.local} cloudOn={o.cloud}
              onLocal={(on) => run(() => exclude('profiles', o.name, on), 'Changed. It applies the next time you update this preset from OBS.')}
              onCloud={(on) => cloud({ outputs: flip(skippedOutputs, o.id, on) })} />
          ))}
          {(ov.scripts.names.length > 0 || !ov.scripts.local) && (
            <Row busy={busy} icon="code" label="Scripts" note={ov.scripts.names.length ? ov.scripts.names.join(', ') : 'left out of this preset'} local={ov.scripts.local} cloudOn={ov.scripts.cloud}
              onLocal={(on) => run(() => exclude('scripts', undefined, on), 'Changed. It applies the next time you update this preset from OBS.')}
              onCloud={(on) => cloud({ scripts: !on })} />
          )}
          {(ov.remoteControl.present || !ov.remoteControl.local) && (
            <Row busy={busy} icon="plug" label="Remote-control settings (WebSocket)" note="the password is never kept in the preset" local={ov.remoteControl.local} cloudOn={ov.remoteControl.cloud}
              onLocal={(on) => run(() => exclude('remoteControl', undefined, on), 'Changed. It applies the next time you update this preset from OBS.')}
              onCloud={(on) => cloud({ remoteControl: !on })} />
          )}
          {ov.files.map((f) => (
            <Row busy={busy} key={'f' + f.id} icon="image" label={f.filename} note={`${f.size ? size(f.size) : 'size unknown'}${f.available ? '' : ' · not on this computer'}`} local={f.keepCopy} cloudOn={f.cloud}
              onLocal={(on) => run(() => window.obsLoader.presets.setStorage(repo.path, { skipLocalMedia: on ? copyOff.filter((x) => x !== f.id) : [...copyOff, f.id] }), on ? 'Changed. A copy is added the next time you update this preset from OBS.' : 'Changed. The copy inside the preset was removed.')}
              onCloud={(on) => cloud({ media: on ? [...mediaUp, f.id] : mediaUp.filter((x) => x !== f.id) })}
              cloudDisabled={f.tooBigForGithub || !f.available || f.stored}
              store={{
                on: f.stored, disabled: !f.stored && (!f.available || !ov.storage?.connected && !storageOn), progress: progress[f.id],
                set: (on) => run(() => window.obsLoader.presets.setStored(repo.path, on ? [...stored, f.id] : stored.filter((x) => x !== f.id)), on ? 'Done. The file is in your storage, and the preset only keeps a note of it.' : 'Changed. The file stays in your storage, but this preset no longer uses it from there.'),
              }}
              />
          ))}
          <Row busy={busy} icon="key" label="Stream keys" note={ov.keys.count ? `${ov.keys.count} kept` : 'none kept yet'} local={ov.keys.keep} cloudOn={false}
            onLocal={(on) => run(() => window.obsLoader.presets.setStorage(repo.path, { keepKeys: on }), on ? 'Changed. Keys are kept the next time you update this preset from OBS.' : 'Changed. The keys that were kept were removed from this preset.')}
            cloudNote="never" />
        </tbody>
      </table>
      {ov.files.some((f) => f.tooBigForGithub) && <p className="text-xs text-muted">GitHub does not accept a file over 100 MB, so the biggest files can only stay on this computer{storageOn ? ' or go in your big-file storage' : ' (or go in a file when you export). Set up big-file storage under Settings to keep them online without GitHub'}.</p>}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Why can't stream keys go to GitHub?</summary>
        <p className="mt-1">GitHub has a place for secrets (“Actions secrets”), but it is write-only: a program can put a secret in, and only GitHub's own automation can use it. Nothing, not even you or this app, can read it back. So a key stored there could never be brought to another computer. Keys stay in the preset on this computer; to move them, export the preset to a file with “Include my stream keys” ticked and keep that file private.</p>
      </details>
    </div>
  )
}

/** Has this computer a big-file storage set up (so a file can be put in it)? */
function useStorageOn(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => { void window.obsLoader.storage.state().then((s) => setOn(!!s.target && s.hasKeys)) }, [])
  return on
}


/** A preset's own big-file storage, shared with one pasteable line. The line holds the access keys: it is a secret. */
function PairBox({ repo, hasStorage, own, done }: { repo: RepoInfo; hasStorage: boolean; own: boolean; done: (text: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Storage pairing code{own ? ' (this preset has its own storage)' : ''}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted">Big files can live in a storage of their own for each preset. A pairing code is one line that lets another computer use the same storage for this preset. It contains the access keys, so send it privately. It stays on this computer and is never uploaded with the preset.</p>
        {hasStorage && (
          <button className="btn px-3 py-1.5" onClick={async () => {
            const r = await window.obsLoader.storage.pairCode(repo.path)
            if (!r.ok) { setErr(r.error); return }
            await navigator.clipboard.writeText(r.code); setErr(null); await done('Pairing code copied. Paste it into a private message.')
          }}>Copy this preset’s pairing code</button>
        )}
        <textarea className="input w-full px-2 py-1.5 mono text-xs" rows={2} placeholder="Paste a pairing code here (starts with OBSSTORE1:)" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Storage pairing code" />
        {err && <Message tone="bad">{err}</Message>}
        <button className="btn px-3 py-1.5" disabled={busy || !code.trim()} onClick={async () => {
          setBusy(true); const r = await window.obsLoader.storage.pair(repo.path, code); setBusy(false)
          if (!r.ok) { setErr(r.error); return }
          setErr(null); setCode(''); await done('Paired. This preset now uses that storage.')
        }}>{busy ? 'Checking…' : 'Use this code for this preset'}</button>
      </div>
    </details>
  )
}
