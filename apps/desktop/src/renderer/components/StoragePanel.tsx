import { useState } from 'react'
import type { PresetOverview, RepoInfo } from '../../../electron/api'
import { Message, size } from '../ui'
import { Icon, type IconName } from './Icon'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

function Box({ checked, onChange, label, disabled, kind }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; kind: 'local' | 'cloud' }) {
  return <input type="checkbox" aria-label={label} title={label} className={`kind-${kind}`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
}

function Row({ icon, label, aria, note, local, cloudOn, onLocal, onCloud, cloudDisabled, cloudNote, busy }: {
  icon: IconName; label: string; aria?: string; note?: string; local: boolean; cloudOn: boolean; onLocal?: (on: boolean) => void; onCloud?: (on: boolean) => void; cloudDisabled?: boolean; cloudNote?: string; busy: boolean
}) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-2"><div className="flex items-center gap-2 text-sm"><Icon name={icon} size={14} className="text-muted" /><span className="min-w-0">{label}</span></div>{note && <div className="text-xs text-muted pl-6">{note}</div>}</td>
      <td className="text-center w-24">{onLocal ? <Box kind="local" checked={local} disabled={busy} onChange={onLocal} label={`Keep ${aria ?? label} on this computer`} /> : <Icon name="check" size={15} className="kind-local kind-text inline" />}</td>
      <td className="text-center w-24">
        {onCloud ? <Box kind="cloud" checked={cloudOn && local} disabled={busy || !local || cloudDisabled} onChange={onCloud} label={`Upload ${aria ?? label} to GitHub`} /> : <span title={cloudNote} className="text-muted text-xs">{cloudNote ?? '—'}</span>}
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

  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-semibold text-sm">Where each part is kept</h3>
        <p className="text-xs text-muted">The preset on this computer can hold everything. Untick a part in the GitHub column to keep it only here.{online ? '' : ' (This preset is not backed up online yet, so nothing is uploaded until you switch that on.)'}</p>
      </div>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      <table className="w-full">
        <thead>
          <tr className="text-xs text-muted">
            <th className="text-left font-normal pb-1">Part</th>
            <th className="font-normal pb-1 kind-local"><span className="inline-flex items-center gap-1 kind-text"><Icon name="drive" size={13} /> This computer</span></th>
            <th className="font-normal pb-1 kind-cloud"><span className="inline-flex items-center gap-1 kind-text"><Icon name="cloud" size={13} /> GitHub</span></th>
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
              cloudDisabled={f.tooBigForGithub || !f.available}
              />
          ))}
          <Row busy={busy} icon="key" label="Stream keys" note={ov.keys.count ? `${ov.keys.count} kept` : 'none kept yet'} local={ov.keys.keep} cloudOn={false}
            onLocal={(on) => run(() => window.obsLoader.presets.setStorage(repo.path, { keepKeys: on }), on ? 'Changed. Keys are kept the next time you update this preset from OBS.' : 'Changed. The keys that were kept were removed from this preset.')}
            cloudNote="never" />
        </tbody>
      </table>
      {ov.files.some((f) => f.tooBigForGithub) && <p className="text-xs text-muted">GitHub does not accept a file over 100 MB, so the biggest files can only stay on this computer (or go in a file when you export).</p>}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Why can't stream keys go to GitHub?</summary>
        <p className="mt-1">GitHub has a place for secrets (“Actions secrets”), but it is write-only: a program can put a secret in, and only GitHub's own automation can use it. Nothing, not even you or this app, can read it back. So a key stored there could never be brought to another computer. Keys stay in the preset on this computer; to move them, export the preset to a file with “Include my stream keys” ticked and keep that file private.</p>
      </details>
    </div>
  )
}
