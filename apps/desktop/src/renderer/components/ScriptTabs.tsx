import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Choice, Field, Message } from '../ui'
import { Icon } from './Icon'

/** One running script and what it last said. The screens are described by the script (docs/SCRIPT_UI.md); this file only draws them. */
export interface ScriptTab {
  key: string
  /** The session in the main process. */
  id: string
  /** Short name, e.g. “Installer”. */
  kind: string
  /** The preset it belongs to, to tell several of the same kind apart. */
  preset: string
  screen: Screen | null
  say: string
  lines: string[]
  ended?: { code: number | null; error?: string }
}
type Block = Record<string, any>
interface Screen { id: string; title: string; sub?: string; blocks: Block[]; buttons: { id: string; label: string; primary?: boolean; disabled?: boolean }[]; wait: boolean }

export const ScriptTabsContext = createContext<{ open: (presetPath: string, stepId: string, kind: string, preset: string) => Promise<string | null> }>({ open: async () => null })
export const useScriptTabs = () => useContext(ScriptTabsContext)

/** Fold one message from a script into the tab's state. */
export function applyScriptEvent(tab: ScriptTab, msg: Record<string, any>): ScriptTab {
  switch (msg.t) {
    case 'screen': return { ...tab, screen: { id: msg.id, title: msg.title, sub: msg.sub, blocks: msg.blocks ?? [], buttons: msg.buttons ?? [], wait: msg.wait !== false }, say: '' }
    case 'update': {
      if (!tab.screen || (msg.id && msg.id !== tab.screen.id)) return tab
      let screen = tab.screen
      if (msg.item) {
        const patch = (bs: Block[]): Block[] => bs.map((b) => b.k === 'steps' ? { ...b, items: b.items.map((i: Block) => i.id === msg.item.id ? { ...i, state: msg.item.state, ...(msg.item.text != null ? { text: msg.item.text } : {}) } : i) } : b.k === 'group' ? { ...b, blocks: patch(b.blocks) } : b)
        screen = { ...screen, blocks: patch(screen.blocks) }
      }
      if (msg.buttons) screen = { ...screen, buttons: msg.buttons }
      return { ...tab, screen, say: msg.say ?? tab.say, lines: msg.log != null ? [...tab.lines, String(msg.log)].slice(-500) : tab.lines }
    }
    case 'raw': return { ...tab, lines: [...tab.lines, String(msg.line)].slice(-500) }
    case 'ended': return { ...tab, ended: { code: msg.code ?? null, error: msg.error } }
    default: return tab
  }
}

const ICON = { run: '…', ok: '✔', warn: '!', fail: '✘', wait: '·' } as const
const TONE: Record<string, string> = { ok: 'text-green-500', warn: 'text-amber-500', fail: 'text-red-500', run: 'text-sky-400', wait: 'text-muted' }

export function ScriptView({ tab, onClose }: { tab: ScriptTab; onClose: () => void }) {
  const s = tab.screen
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  // each new screen starts from the values the script gave its fields
  useEffect(() => {
    const v: Record<string, string | boolean> = {}
    const walk = (bs: Block[]) => bs.forEach((b) => { if (b.k === 'field') v[b.name] = b.value ?? ''; else if (b.k === 'choice') v[b.name] = b.value ?? b.options?.[0]?.value ?? ''; else if (b.k === 'check') v[b.name] = !!b.value; else if (b.k === 'group') walk(b.blocks) })
    if (s) walk(s.blocks)
    setValues(v)
  }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string | boolean) => setValues((x) => ({ ...x, [k]: v }))
  const press = (button: string) => { if (s) void window.obsLoader.script.send(tab.id, { t: 'submit', id: s.id, button, values }) }

  const draw = (bs: Block[]): React.ReactNode => bs.map((b, i) => {
    switch (b.k) {
      case 'text': return <p key={i} className={b.style === 'hint' ? 'text-xs text-muted' : b.style === 'sub' ? 'text-sm font-semibold pt-2' : 'text-sm'} style={{ whiteSpace: 'pre-line' }}>{b.id === 'say' ? tab.say : b.text}</p>
      case 'message': return <Message key={i} tone={b.tone ?? 'warn'}>{b.text}</Message>
      case 'field': return (
        <Field key={i} label={b.label} hint={b.help || undefined}>
          <div className="flex gap-2">
            {b.multiline
              ? <textarea className="input flex-1 px-2 py-1.5 mono text-xs" rows={3} value={String(values[b.name] ?? '')} placeholder={b.placeholder} onChange={(e) => set(b.name, e.target.value)} aria-label={b.label} />
              : <input className="input flex-1 px-2 py-1.5" type={b.secret ? 'password' : 'text'} autoComplete="off" value={String(values[b.name] ?? '')} placeholder={b.placeholder} onChange={(e) => set(b.name, e.target.value)} aria-label={b.label} />}
            {b.browse && <button className="btn px-3" onClick={async () => { const p = await window.obsLoader.files.pick(b.label, b.browse === 'folder'); if (p) set(b.name, p) }}>Choose…</button>}
          </div>
        </Field>
      )
      case 'choice': return (
        <div key={i}>
          {b.label && <h3 className="text-sm font-semibold">{b.label}</h3>}
          {b.options.map((o: Block) => <Choice key={o.value} type="radio" name={b.name} checked={values[b.name] === o.value} onChange={() => set(b.name, o.value)} title={o.label} help={o.help || undefined} />)}
        </div>
      )
      case 'check': return <Choice key={i} checked={!!values[b.name]} onChange={(on) => set(b.name, on)} title={b.label} help={b.help || undefined} />
      case 'steps': return (
        <div key={i} className="space-y-2">
          {b.items.map((it: Block) => (
            <div key={it.id} className="flex gap-3">
              <span className={'w-5 text-center font-bold ' + (TONE[it.state] ?? '')}>{ICON[it.state as keyof typeof ICON] ?? '·'}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{it.title}</div>
                {it.text && <div className={'text-xs ' + (it.state === 'fail' ? 'text-red-500' : it.state === 'warn' ? 'text-amber-500' : 'text-muted')}>{it.text}</div>}
              </div>
            </div>
          ))}
        </div>
      )
      case 'log': return tab.lines.length ? <details key={i}><summary className="text-xs cursor-pointer text-muted">Technical details ({tab.lines.length} lines)</summary><pre className="cmd mono rounded-theme max-h-56 overflow-auto text-xs">{tab.lines.slice(-200).join('\n')}</pre></details> : null
      case 'link': return <button key={i} className="btn px-3 py-1.5" onClick={() => void window.obsLoader.app.openExternal(b.url)}>{b.label}</button>
      case 'actions': return <div key={i} className="flex gap-2 flex-wrap">{b.items.map((a: Block) => <button key={a.id} className={'btn px-3 py-1.5 ' + (a.primary ? 'btn-accent' : '')} onClick={() => press(a.id)}>{a.label}</button>)}</div>
      case 'group': return <section key={i} className="card p-4 space-y-2">{b.title && <h3 className="text-sm font-semibold">{b.title}</h3>}{draw(b.blocks)}</section>
      default: return null
    }
  })

  if (!s) {
    return (
      <div className="p-6 space-y-3 max-w-3xl">
        {tab.ended
          ? <>
              <Message tone={tab.ended.code === 0 ? 'good' : 'bad'}>{tab.ended.error ? `It could not be started: ${tab.ended.error}` : tab.ended.code === 0 ? 'It finished.' : `It stopped (code ${tab.ended.code}) before it showed anything.`}</Message>
              {tab.lines.length > 0 && <pre className="cmd mono rounded-theme max-h-72 overflow-auto text-xs">{tab.lines.join('\n')}</pre>}
              <button className="btn px-3 py-1.5" onClick={onClose}>Close this tab</button>
            </>
          : <p className="text-sm text-muted">Starting…</p>}
      </div>
    )
  }
  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto" aria-label={`${tab.kind} screen`}>
      <header>
        <h1 className="text-2xl font-bold">{s.title}</h1>
        {s.sub && <p className="text-sm text-muted mt-1">{s.sub}</p>}
      </header>
      <div className="space-y-3">{draw(s.blocks)}</div>
      {tab.ended && <Message tone={tab.ended.code === 0 ? 'good' : 'warn'}>The script has ended{tab.ended.code ? ` (code ${tab.ended.code})` : ''}. <button className="underline" onClick={onClose}>Close this tab</button></Message>}
      <div className="flex gap-2 justify-between pt-2">
        <div className="flex gap-2">{s.buttons.filter((b) => !b.primary && (b.id === 'back' || b.id === 'cancel')).map((b) => <button key={b.id} className="btn px-4 py-2" disabled={b.disabled || !!tab.ended} onClick={() => press(b.id)}>{b.label}</button>)}</div>
        <div className="flex gap-2">{s.buttons.filter((b) => !(!b.primary && (b.id === 'back' || b.id === 'cancel'))).map((b) => <button key={b.id} className={'btn px-4 py-2 ' + (b.primary ? 'btn-accent' : '')} disabled={b.disabled || !!tab.ended} onClick={() => press(b.id)}>{b.label}</button>)}</div>
      </div>
    </div>
  )
}

/** The bar above the app while any script is open: the app itself first, then one tab per script. Hidden when none is open. */
export function TabBar({ tabs, current, setCurrent, close }: { tabs: ScriptTab[]; current: string | null; setCurrent: (k: string | null) => void; close: (k: string) => void }) {
  const names = useMemo(() => {
    const seen = new Map<string, number>()
    return tabs.map((t) => { const base = `${t.kind} · ${t.preset}`; const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return n > 1 ? `${base} (${n})` : base })
  }, [tabs])
  if (!tabs.length) return null
  return (
    <div className="flex items-end gap-1 px-2 pt-1 border-b border-line overflow-x-auto" role="tablist" aria-label="Open tabs">
      <button role="tab" aria-selected={current === null} className={'px-3 py-1.5 text-sm rounded-t-theme ' + (current === null ? 'bg-raised font-semibold' : 'text-muted hover:bg-raised')} onClick={() => setCurrent(null)}>Config Loader</button>
      {tabs.map((t, i) => (
        <div key={t.key} className={'flex items-center rounded-t-theme ' + (current === t.key ? 'bg-raised' : 'hover:bg-raised')}>
          <button role="tab" aria-selected={current === t.key} className={'pl-3 pr-1 py-1.5 text-sm whitespace-nowrap ' + (current === t.key ? 'font-semibold' : 'text-muted')} onClick={() => setCurrent(t.key)}>[{names[i].split(' · ')[0]}] {names[i].split(' · ').slice(1).join(' · ')}</button>
          <button className="px-1.5 py-1 text-muted hover:text-current" aria-label={`Close ${names[i]}`} onClick={() => close(t.key)}><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  )
}
