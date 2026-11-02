import type { FileChoice } from '../../../electron/api'
import { Choice, Message, size } from '../ui'

const SMALL = 5 * 1024 * 1024

/**
 * The pictures, sounds and videos a setup uses, for a file. Small ones go in by themselves; big ones are listed with their size
 * and only go in when ticked, so the person sees what makes the file big before it is made.
 */
export function BigFiles({ files, chosen, setChosen, forPreset }: { files: FileChoice[]; chosen: string[]; setChosen: (ids: string[]) => void; forPreset?: boolean }) {
  const small = files.filter((f) => f.available && f.size <= SMALL)
  const big = files.filter((f) => !small.includes(f))
  const tick = (id: string, on: boolean) => setChosen(on ? [...chosen, id] : chosen.filter((x) => x !== id))
  const total = small.reduce((n, f) => n + f.size, 0) + big.filter((f) => chosen.includes(f.id)).reduce((n, f) => n + f.size, 0)
  if (!files.length) return <p className="text-sm text-muted">Your scenes use no pictures, sounds or videos from files.</p>
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">Pictures, music and videos your scenes use</h3>
      {small.length > 0 && <p className="text-sm">{small.length === 1 ? '1 small file goes' : `${small.length} small files go`} in the file by itself ({size(small.reduce((n, f) => n + f.size, 0))}).</p>}
      {big.length > 0 && (
        <>
          <p className="text-xs text-muted">
            {big.length === 1 ? 'This file is' : 'These files are'} big, so {big.length === 1 ? 'it is' : 'they are'} left out unless you tick {big.length === 1 ? 'it' : 'them'}. Left out files are asked for again when the file is loaded.
          </p>
          {big.map((f) => (
            <Choice
              key={f.id} checked={chosen.includes(f.id)} disabled={!f.available} onChange={(on) => tick(f.id, on)}
              title={<>{f.filename} <span className="text-muted">({f.size ? size(f.size) : 'size unknown'})</span></>}
              help={f.available ? undefined : forPreset ? 'This computer does not have it yet. Use “Locate…” on the preset first.' : 'Not found on this computer.'}
            />
          ))}
        </>
      )}
      {total > 50 * 1024 * 1024 && <Message tone="warn">The file will be about {size(total)}.</Message>}
    </div>
  )
}

/** "Include my stream keys": off unless asked for, with the warning right under it. */
export function KeysChoice({ checked, onChange, available, help }: { checked: boolean; onChange: (on: boolean) => void; available: boolean; help?: string }) {
  return (
    <>
      <Choice
        checked={checked} disabled={!available} onChange={onChange} title="Include my stream keys in the file"
        help={help ?? 'Off is safest: the file is then safe to share, and you type your keys again when you load it. Turn it on only if this file is just for you.'}
      />
      {checked && (
        <Message tone="bad">
          <strong>Keep this file private.</strong> Anyone who gets it can stream as you. The file will be marked “CONTAINS STREAM KEYS” in its name and inside, and this app will warn you every time it is opened. Delete it once you have loaded it. Never post it or put it in a git repository.
        </Message>
      )}
    </>
  )
}
