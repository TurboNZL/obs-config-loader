import { useEffect, useState } from 'react'
import type { ExtrasInfo, FileChoice, RepoInfo } from '../../../electron/api'
import { Choice, Message, size } from '../ui'
import { BigFiles, KeysChoice } from './SaveOptions'
import { Icon } from './Icon'
import { friendlyFile } from './DiffView'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

/**
 * Export a preset: the whole thing as one setup file (.obsbundle), or only the extras (.obsextras), the parts that are not on GitHub,
 * to go with the GitHub copy.
 */
export function ExportPanel({ repo, onDone, onClose }: { repo: RepoInfo; onDone: (m: Msg) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'file' | 'extras'>('file')
  const [files, setFiles] = useState<FileChoice[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [keys, setKeys] = useState({ count: 0, canStore: true })
  const [withKeys, setWithKeys] = useState(false)
  const [independent, setIndependent] = useState(true)
  const [extras, setExtras] = useState<ExtrasInfo | null>(null)
  const [extraMedia, setExtraMedia] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const online = !!repo.remoteUrl

  useEffect(() => {
    void window.obsLoader.presets.scanFile(repo.path).then(setFiles).catch(() => setFiles([]))
    void window.obsLoader.presets.keys(repo.path).then(setKeys)
    void window.obsLoader.presets.extrasInfo(repo.path).then((x) => { setExtras(x); setExtraMedia(x.media.map((m) => m.id)) }).catch(() => setExtras(null))
  }, [repo.path])

  const run = async () => {
    setBusy(true); setError(null)
    try {
      if (mode === 'file') {
        const r = await window.obsLoader.presets.exportFile(repo.path, { includeKeys: withKeys, bigFiles: chosen, independent })
        if (r.ok) {
          onDone({
            tone: r.keys ? 'warn' : 'good',
            text: `Saved the file ${r.path}.${r.keys ? ` It has ${r.keys} stream key${r.keys === 1 ? '' : 's'} inside: treat it like a password, anyone with it can stream as you.` : ''}${r.independent ? ' Whoever opens it gets a preset of their own, with no link to yours.' : online ? ' It stays linked to this preset’s GitHub copy.' : ''}${r.missingMedia.length ? ` ${r.missingMedia.length} big file${r.missingMedia.length === 1 ? ' is' : 's are'} not inside (${r.missingMedia.slice(0, 3).join(', ')}${r.missingMedia.length > 3 ? '…' : ''}); the other computer will ask for ${r.missingMedia.length === 1 ? 'it' : 'them'}.` : ''}`,
          })
          onClose()
        } else if (!r.cancelled) setError(r.error)
      } else {
        const r = await window.obsLoader.presets.exportExtras(repo.path, { includeKeys: withKeys, mediaIds: extraMedia })
        if (r.ok) {
          onDone({ tone: r.keys ? 'warn' : 'good', text: `Saved the extras file ${r.path} (${size(r.bytes)}): ${r.files} part${r.files === 1 ? '' : 's'} of the preset, ${r.media} file${r.media === 1 ? '' : 's'}${r.keys ? `, ${r.keys} stream key${r.keys === 1 ? '' : 's'} (keep it private)` : ''}. Import it on the other computer after getting the preset from GitHub.` })
          onClose()
        } else if (!r.cancelled) setError(r.error)
      }
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="kind-panel kind-file p-3 space-y-3" role="group" aria-label="Export this preset">
      <div className="flex items-center gap-2">
        <Icon name="fileUp" className="kind-text" />
        <span className="text-xs font-semibold uppercase tracking-wide kind-text">Export</span>
        <span className="flex-1" />
        <button className="btn btn-ghost px-1.5 py-1" aria-label="Close export" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      {error && <Message tone="bad">{error}</Message>}

      <div className="grid sm:grid-cols-2 gap-2">
        <button type="button" className={'btn kind-btn kind-file p-3 text-left !flex !flex-col !items-start gap-0.5 whitespace-normal h-auto ' + (mode === 'file' ? 'is-on' : '')} aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
          <div className="font-semibold text-sm flex items-center gap-2"><Icon name="file" size={15} /> The whole preset in one file</div>
          <div className="text-xs text-muted">A setup file (.obsbundle) for another computer or another person.</div>
        </button>
        <button type="button" className={'btn kind-btn kind-file p-3 text-left !flex !flex-col !items-start gap-0.5 whitespace-normal h-auto ' + (mode === 'extras' ? 'is-on' : '')} aria-pressed={mode === 'extras'} onClick={() => setMode('extras')}>
          <div className="font-semibold text-sm flex items-center gap-2"><Icon name="box" size={15} /> Only the extras</div>
          <div className="text-xs text-muted">Just what GitHub does not have (an .obsextras file), to go with the GitHub copy.</div>
        </button>
      </div>

      {mode === 'file' && (
        <div className="space-y-3">
          <BigFiles files={files} chosen={chosen} setChosen={setChosen} forPreset />
          <KeysChoice
            checked={withKeys} onChange={setWithKeys} available={keys.count > 0}
            help={keys.count ? `${keys.count} kept in this preset. Off is safest: the file is then safe to share.` : 'No stream keys are kept in this preset yet. Press “Save OBS to this preset” first.'}
          />
          <Choice
            checked={independent} onChange={setIndependent}
            title="Give whoever opens it a preset of their own (best for sharing)"
            help={independent
              ? 'They get their own copy and their own GitHub backup. What they change never touches yours, and what you change never reaches them.'
              : online ? 'It stays linked to this preset’s GitHub copy, so another computer of yours can get updates from it.' : 'It keeps this preset’s identity, so another computer of yours treats it as the same preset.'}
          />
        </div>
      )}

      {mode === 'extras' && (
        <div className="space-y-3">
          {!online && <Message tone="warn">This preset is not backed up on GitHub, so everything is only on this computer. An extras file is meant to go with a GitHub copy; for a complete copy use “The whole preset in one file”.</Message>}
          {extras === null ? <p className="text-sm text-muted">Reading the preset…</p> : (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">What is in it</h3>
              {extras.files.length > 0
                ? <p className="text-sm">{extras.files.length === 1 ? '1 part' : `${extras.files.length} parts`} you chose not to upload: {extras.files.map(friendlyFile).join('; ')}.</p>
                : <p className="text-sm text-muted">Every scene layout, output setting and script is uploaded, so none of those are needed here.</p>}
              {extras.media.length > 0 ? (
                <>
                  <p className="text-xs text-muted">Files the scenes use (GitHub does not keep them). Untick any you do not need.</p>
                  {extras.media.map((m) => (
                    <Choice key={m.id} checked={extraMedia.includes(m.id)} onChange={(on) => setExtraMedia(on ? [...extraMedia, m.id] : extraMedia.filter((x) => x !== m.id))}
                      title={<>{m.filename} <span className="text-muted">({size(m.size)})</span></>} />
                  ))}
                </>
              ) : <p className="text-sm text-muted">No files are kept in this preset.</p>}
              <KeysChoice checked={withKeys} onChange={setWithKeys} available={keys.count > 0} help={keys.count ? `${keys.count} kept in this preset. Off is safest.` : 'No stream keys are kept in this preset yet.'} />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-3 py-1.5" disabled={busy} onClick={run}>{busy ? 'Saving…' : 'Choose where to save…'}</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
