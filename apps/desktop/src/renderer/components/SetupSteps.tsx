import { useEffect, useRef, useState } from 'react'
import type { SetupStepInfo } from '../../../electron/api'
import { Chip, Choice, Field, Message } from '../ui'

type Run = { id: string; lines: string[]; done: boolean; exitCode?: number | null; message?: string }

/**
 * What a preset can do for you beyond OBS settings: set up the program it needs, run its own installer. Nobody opens a terminal: each
 * step is a button, shown in words first. Nothing runs by itself, because a preset can come from anyone.
 */
export function SetupSteps({ presetPath, authoring, onChanged, title }: { presetPath: string; authoring?: boolean; onChanged?: () => void; title?: string }) {
  const [steps, setSteps] = useState<SetupStepInfo[] | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const load = async () => { const r = await window.obsLoader.setup.plan(presetPath); setSteps(r.steps); setFolders(r.folders) }
  useEffect(() => { void load(); return () => window.clearTimeout(timer.current) }, [presetPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (s: SetupStepInfo) => {
    setError(null)
    const r = await window.obsLoader.setup.run(presetPath, s.id)
    if (!r.ok) { setError(r.error); return }
    const state: Run = { id: s.id, lines: [], done: false }
    setRun(state)
    const tick = async () => {
      const p = await window.obsLoader.setup.poll(r.runId, state.lines.length)
      state.lines = [...state.lines, ...p.lines]; state.done = p.done; state.exitCode = p.exitCode; state.message = p.message
      setRun({ ...state })
      if (p.done) { await load(); onChanged?.() } else timer.current = window.setTimeout(() => void tick(), 700)
    }
    void tick()
  }

  if (!steps) return null
  if (!steps.length && !authoring) return null
  const busy = !!run && !run.done

  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm">{title ?? 'Setup steps'}</h3>
      {steps.length > 0 && <p className="text-xs text-muted">{authoring ? 'These run on whoever uses this preset, when they press the button. Nothing runs by itself, and nobody needs a terminal.' : 'This setup can finish the job for you. Nothing runs until you press a button, and you never need a terminal.'}</p>}
      {steps.map((s) => (
        <div key={s.id} className="bt-row py-2 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium flex-1 min-w-40">{s.title}</span>
            {s.optional && <Chip>optional</Chip>}
            {s.ranBefore && <Chip tone="good">done earlier</Chip>}
            {s.changedSince && <Chip tone="warn">changed since you last ran it</Chip>}
            {s.command
              ? <button className={'btn px-3 py-1 ' + (s.ranBefore ? '' : 'btn-accent')} disabled={busy} onClick={() => void start(s)}>{run?.id === s.id && busy ? 'Running…' : s.mode === 'open' ? 'Open it' : s.ranBefore ? 'Run again' : 'Run'}</button>
              : null}
            {authoring && <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={async () => { await window.obsLoader.setup.remove(presetPath, s.id); await load(); onChanged?.() }}>Remove</button>}
          </div>
          {s.why && <p className="text-xs text-muted">{s.why}</p>}
          {s.problem && <p className="text-xs text-muted">{s.problem}</p>}
          {s.changedSince && <p className="text-xs">Something in this step is different from last time. Look at what it will run before you press the button.</p>}
          {s.command && (
            <details>
              <summary className="text-xs cursor-pointer text-muted">What exactly will run</summary>
              <p className="mono text-xs mt-1 break-all">{[s.command.program, ...s.command.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}</p>
              <p className="text-xs text-muted">in the folder {s.command.cwd}</p>
            </details>
          )}
          {run?.id === s.id && (
            <div className="space-y-1">
              {!run.done && <p className="text-xs">Working… this can take a few minutes. Keep this window open.</p>}
              {run.done && run.exitCode === 0 && <Message tone="good">{s.mode === 'open' ? 'Opened.' : 'Finished.'}</Message>}
              {run.done && run.exitCode !== 0 && <Message tone="bad">{run.message ?? 'It did not finish.'} Open the details below, fix what it says, and press Run again. Nothing was lost.</Message>}
              {run.lines.length > 0 && (
                <details open={run.done && run.exitCode !== 0}>
                  <summary className="text-xs cursor-pointer text-muted">Show what it said ({run.lines.length} lines)</summary>
                  <pre className="cmd mono rounded-theme max-h-56 overflow-auto text-xs">{run.lines.slice(-200).join('\n')}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      ))}
      {error && <Message tone="bad">{error}</Message>}
      {authoring && (adding
        ? <AddStep presetPath={presetPath} folders={folders} onDone={async (added) => { setAdding(false); if (added) { await load(); onChanged?.() } }} />
        : <button className="btn btn-ghost px-3 py-1 text-sm" onClick={() => setAdding(true)}>Add a setup step…</button>)}
    </div>
  )
}

function AddStep({ presetPath, folders, onDone }: { presetPath: string; folders: string[]; onDone: (added: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [windows, setWindows] = useState('')
  const [unix, setUnix] = useState('')
  const [args, setArgs] = useState('')
  const [open, setOpen] = useState(false)
  const [optional, setOptional] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const r = await window.obsLoader.setup.add(presetPath, { title, why, windows, unix, open, optional, args: args.split('\n').map((a) => a.trim()).filter(Boolean) })
    if (!r.ok) setError(r.error); else onDone(true)
  }
  return (
    <div className="kind-panel kind-file p-3 space-y-2">
      <p className="text-xs text-muted">A setup step runs a file that is part of this preset (for example the installer inside its script folder). Write where the file is with a folder name in double curly brackets, like <span className="mono">{'{{var:SCRIPT_FOLDER}}/install.bat'}</span>. Use <span className="mono">{'{{python}}'}</span> to run a Python file with whatever Python the person has, and <span className="mono">{'{{bundle}}'}</span> for this preset's own folder.</p>
      <Field label="Name of the step"><input className="input w-full px-2 py-1.5" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Set up the voice switcher" /></Field>
      <Field label="What it does, in one sentence"><input className="input w-full px-2 py-1.5" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Downloads what it needs and asks a few questions." /></Field>
      <Field label="What to run on Windows"><input className="input w-full px-2 py-1.5 mono" value={windows} onChange={(e) => setWindows(e.target.value)} placeholder="{{var:SCRIPT_FOLDER}}/install.bat" /></Field>
      <Field label="What to run on Linux and Mac"><input className="input w-full px-2 py-1.5 mono" value={unix} onChange={(e) => setUnix(e.target.value)} placeholder="{{var:SCRIPT_FOLDER}}/install.sh" /></Field>
      <Field label="Extra words to give it (optional, one per line)"><textarea className="input w-full px-2 py-1.5 mono" rows={2} value={args} onChange={(e) => setArgs(e.target.value)} /></Field>
      {folders.length > 0 && <p className="text-xs text-muted">Folders this preset knows: <span className="mono">{folders.join(', ')}</span></p>}
      <Choice checked={open} onChange={setOpen} title="It opens its own window" help="Start it and leave it running, instead of waiting for it to finish." />
      <Choice checked={optional} onChange={setOptional} title="Optional" />
      {error && <Message tone="bad">{error}</Message>}
      <div className="flex gap-2">
        <button className="btn btn-accent px-3 py-1" onClick={() => void save()}>Add it</button>
        <button className="btn btn-ghost px-3 py-1" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  )
}
