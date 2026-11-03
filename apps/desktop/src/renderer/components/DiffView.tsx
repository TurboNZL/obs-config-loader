import { useState } from 'react'
import type { ChangeDetail } from '../../../electron/api'
import { Chip } from '../ui'
import { Icon } from './Icon'

/** A file name inside a preset, in words a person would use. */
export function friendlyFile(file: string): string {
  let m: RegExpMatchArray | null
  if (file === 'manifest.json') return 'Preset information (plugins, versions, names)'
  if (file === 'assets.lock.json') return 'List of files the scenes use'
  if ((m = file.match(/^collections\/(.+)\.platforms\.json$/))) return `Scene layout “${m[1]}”: sources that differ per system`
  if ((m = file.match(/^collections\/(.+)\.json$/))) return `Scene layout “${m[1]}”`
  if ((m = file.match(/^profiles\/([^/]+)\/service\.json$/))) return `Output settings “${m[1]}”: streaming service`
  if ((m = file.match(/^profiles\/([^/]+)\/basic\.ini$/))) return `Output settings “${m[1]}”: main settings`
  if ((m = file.match(/^profiles\/([^/]+)\/(.+)$/))) return `Output settings “${m[1]}”: ${m[2]}`
  if (file === 'global/obs-websocket.json') return 'Remote-control settings (WebSocket)'
  if ((m = file.match(/^scripts\/projects\/[^/]+\/(.+)$/))) return `Script folder file: ${m[1]}`
  if ((m = file.match(/^scripts\/[^/]+\/(.+)$/))) return `Script: ${m[1]}`
  if (file === 'local/keys.json') return 'Stream keys (kept only inside the preset, on this computer)'
  if ((m = file.match(/^local\/media\/[^/]+\/(.+)$/))) return `Copy of the file ${m[1]}`
  if ((m = file.match(/^media\/[^/]+\/(.+)$/))) return `File: ${m[1]}`
  return file
}

function Patch({ text }: { text: string }) {
  return (
    <div className="diff rounded-theme border border-line mt-1">
      {text.split('\n').map((l, i) => <div key={i} className={l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l || ' '}</div>)}
    </div>
  )
}

/** What would change, file by file: green for what OBS adds, red for what it takes away. Lines open on a click. */
export function DiffView({ details, files }: { details?: ChangeDetail[]; files: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const rows: ChangeDetail[] = details?.length ? details : files.map((f) => ({ file: f, status: 'modified' as const, added: 0, removed: 0 }))
  return (
    <ul className="space-y-1" aria-label="What changed">
      {rows.map((d) => {
        const color = d.status === 'added' ? '--good' : d.status === 'deleted' ? '--bad' : '--warn'
        const can = !!d.patch
        return (
          <li key={d.file} className="rounded-theme border border-line bg-raised/40">
            <button type="button" className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm" disabled={!can} aria-expanded={can ? open === d.file : undefined} onClick={() => setOpen(open === d.file ? null : d.file)}>
              <Icon name={d.status === 'added' ? 'plus' : d.status === 'deleted' ? 'trash' : 'pencil'} size={14} style={{ color: `hsl(var(${color}))` }} />
              <span className="flex-1 min-w-0 truncate">{friendlyFile(d.file)}</span>
              {d.local && <Chip icon="drive">only on this computer</Chip>}
              {(d.added > 0 || d.removed > 0) && (
                <span className="text-xs mono shrink-0"><span style={{ color: 'hsl(var(--good))' }}>+{d.added}</span> <span style={{ color: 'hsl(var(--bad))' }}>−{d.removed}</span></span>
              )}
              {can && <Icon name={open === d.file ? 'up' : 'down'} size={14} className="text-muted" />}
            </button>
            {open === d.file && d.patch && <div className="px-2 pb-2"><Patch text={d.patch} /></div>}
          </li>
        )
      })}
    </ul>
  )
}
