import { useEffect, useState } from 'react'
import type { FileChoice, PresetDetails, RepoInfo } from '../../../electron/api'
import { Choice, Message, size } from '../ui'
import { KeysChoice } from './SaveOptions'
import { Icon } from './Icon'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

/**
 * Export a preset as one setup file (.obsbundle), in a popup. Everything is included unless it is unticked; stream keys are off by
 * default; the file is the same preset by default (making it a separate preset for whoever opens it is a choice, not the default).
 */
export function ExportPanel({ repo, onDone, onClose }: { repo: RepoInfo; onDone: (m: Msg) => void; onClose: () => void }) {
  const [files, setFiles] = useState<FileChoice[]>([])
  const [media, setMedia] = useState<string[]>([])
  const [d, setD] = useState<PresetDetails | null>(null)
  const [left, setLeft] = useState<{ collections: string[]; profiles: string[]; scripts: boolean; remoteControl: boolean }>({ collections: [], profiles: [], scripts: false, remoteControl: false })
  const [keys, setKeys] = useState({ count: 0, canStore: true })
  const [withKeys, setWithKeys] = useState(false)
  const [separate, setSeparate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const online = !!repo.remoteUrl

  useEffect(() => {
    void window.obsLoader.presets.scanFile(repo.path).then((f) => { setFiles(f); setMedia(f.filter((x) => x.available).map((x) => x.id)) }).catch(() => setFiles([]))
    void window.obsLoader.presets.keys(repo.path).then(setKeys)
    void window.obsLoader.presets.details(repo.path).then(setD).catch(() => setD(null))
  }, [repo.path])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))
  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await window.obsLoader.presets.exportFile(repo.path, { includeKeys: withKeys, bigFiles: [], independent: separate, mediaIds: media, leaveOut: left })
      if (r.ok) {
        onDone({
          tone: r.keys ? 'warn' : 'good',
          text: `Saved the file ${r.path}.${r.keys ? ` It has ${r.keys} stream key${r.keys === 1 ? '' : 's'} inside: treat it like a password, anyone with it can stream as you.` : ''}${r.independent ? ' Whoever opens it gets a preset of their own, with no link to yours.' : online ? ' It stays linked to this preset’s GitHub copy.' : ''}${r.missingMedia.length ? ` ${r.missingMedia.length} file${r.missingMedia.length === 1 ? ' is' : 's are'} not inside (${r.missingMedia.slice(0, 3).join(', ')}${r.missingMedia.length > 3 ? '…' : ''}); the other computer will ask for ${r.missingMedia.length === 1 ? 'it' : 'them'}.` : ''}`,
        })
        onClose()
      } else if (!r.cancelled) setError(r.error)
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const totalBytes = files.filter((f) => media.includes(f.id)).reduce((n, f) => n + f.size, 0)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card p-5 w-full max-w-xl max-h-[88vh] overflow-y-auto space-y-4" role="dialog" aria-modal="true" aria-label={`Export ${repo.name}`}>
        <div className="flex items-center gap-2">
          <Icon name="fileUp" className="kind-file kind-text" />
          <h2 className="font-semibold flex-1">Export “{repo.name}” as a setup file</h2>
          <button className="btn btn-ghost px-1.5 py-1" aria-label="Close export" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <p className="text-sm text-muted">One file (.obsbundle) that another computer can open. Untick anything you do not want inside it.</p>
        {error && <Message tone="bad">{error}</Message>}

        {d && (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Parts</h3>
            {d.layouts.map((l) => <Choice key={l.id} checked={!left.collections.includes(l.id)} onChange={(on) => setLeft({ ...left, collections: toggle(left.collections, l.id, !on) })} title={`Scene layout “${l.name}”`} />)}
            {d.outputs.map((o) => <Choice key={o.id} checked={!left.profiles.includes(o.id)} onChange={(on) => setLeft({ ...left, profiles: toggle(left.profiles, o.id, !on) })} title={`Output settings “${o.name}”`} help={o.systems?.length ? `Saved on ${o.systems.join(', ')}` : undefined} />)}
            {d.scripts.length > 0 && <Choice checked={!left.scripts} onChange={(on) => setLeft({ ...left, scripts: !on })} title={`Scripts and the files beside them (${d.scripts[0]}…)`} />}
            {d.remoteControl && <Choice checked={!left.remoteControl} onChange={(on) => setLeft({ ...left, remoteControl: !on })} title="Remote-control settings (the password is never inside)" />}
          </div>
        )}

        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Files the scenes use <span className="font-normal text-muted">({size(totalBytes)} inside)</span></h3>
          {files.length === 0 && <p className="text-sm text-muted">This preset uses no files.</p>}
          {files.map((f) => (
            <Choice key={f.id} checked={media.includes(f.id)} disabled={!f.available} onChange={(on) => setMedia(toggle(media, f.id, on))}
              title={<>{f.filename} <span className="text-muted">({size(f.size)})</span></>} help={f.available ? undefined : 'Not on this computer, so it cannot go inside.'} />
          ))}
        </div>

        <KeysChoice
          checked={withKeys} onChange={setWithKeys} available={keys.count > 0}
          help={keys.count ? `${keys.count} kept in this preset. Off is safest: the file is then safe to share.` : 'No stream keys are kept in this preset yet. Press “Update preset from OBS” first.'}
        />
        <Choice
          checked={separate} onChange={setSeparate}
          title="Make it a separate preset for whoever opens it"
          help={separate ? 'They get their own copy and their own GitHub backup; nothing they change reaches yours.' : online ? 'Off: it stays the same preset, linked to this one’s GitHub copy.' : 'Off: it stays the same preset, so another computer of yours treats it as this one.'}
        />

        <div className="flex gap-2 flex-wrap justify-end">
          <button className="btn btn-ghost px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent px-3 py-1.5" disabled={busy} onClick={run}>{busy ? 'Saving…' : 'Choose where to save…'}</button>
        </div>
      </div>
    </div>
  )
}
