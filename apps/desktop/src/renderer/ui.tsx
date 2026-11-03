import type { ReactNode } from 'react'
import { Icon, type IconName } from './components/Icon'

export function Page({ title, intro, children, wide, icon }: { title: string; intro?: ReactNode; children: ReactNode; wide?: boolean; icon?: IconName }) {
  return (
    <div className={'bt-page mx-auto p-6 space-y-5 ' + (wide ? 'max-w-6xl' : 'max-w-3xl')}>
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">{icon && <Icon name={icon} size={24} className="text-muted" />}{title}</h1>
        {intro && <p className="text-muted mt-1">{intro}</p>}
      </header>
      {children}
    </div>
  )
}

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-4 space-y-3">
      {(title || right) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="bt-panel-title font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** A numbered step: what to do here, said once in plain words, then the controls. */
export function Step({ n, title, help, children }: { n: number; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4 space-y-3" aria-label={title}>
      <div>
        <h2 className="bt-panel-title font-semibold text-lg"><span className="text-muted mr-2">{n}.</span>{title}</h2>
        {help && <p className="text-sm text-muted mt-1">{help}</p>}
      </div>
      {children}
    </section>
  )
}

export function Chip({ children, tone, icon }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad'; icon?: IconName }) {
  const color = tone ? { color: `hsl(var(--${tone}))` } : undefined
  return <span className="chip text-xs px-2 py-0.5 inline-flex items-center gap-1" style={color}>{icon && <Icon name={icon} size={12} />}{children}</span>
}

export function Message({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const icon: IconName = tone === 'good' ? 'checkCircle' : 'alert'
  // A tinted background and a thick coloured edge: a theme can restyle borders, and a warning must still stand out.
  return (
    <div
      className="card p-3 pl-4 text-sm" role={tone === 'bad' ? 'alert' : 'status'}
      style={{ backgroundColor: `hsl(var(--${tone}) / 0.12)`, boxShadow: `inset 5px 0 0 hsl(var(--${tone}))` }}
    >
      <div className="flex gap-2 items-start"><Icon name={icon} size={16} className="mt-0.5" style={{ color: `hsl(var(--${tone}))` }} /><div className="min-w-0 flex-1">{children}</div></div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

/** A line with a checkbox/radio and a one-line explanation under it. */
export function Choice({ type = 'checkbox', checked, onChange, title, help, name, disabled }: {
  type?: 'checkbox' | 'radio'; checked: boolean; onChange: (on: boolean) => void; title: ReactNode; help?: ReactNode; name?: string; disabled?: boolean
}) {
  return (
    <label className="flex items-start gap-2 py-0.5">
      <input type={type} name={name} className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm">{title}</span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
    </label>
  )
}

/** Plain-language file size: "12 MB". */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** What kind of OBS this is, in words a person uses. */
export const KIND_LABEL: Record<string, string> = {
  windows: 'installed OBS', 'windows-portable': 'OBS in a folder', macos: 'installed OBS',
  'linux-native': 'installed OBS', flatpak: 'Flatpak OBS', snap: 'Snap OBS', 'linux-portable': 'OBS in a folder', instance: 'separate OBS',
}

/** A button that is only a picture (with its words for screen readers and as a tooltip). */
export function IconButton({ icon, label, onClick, disabled, active, className, kind }: {
  icon: IconName; label: string; onClick: () => void; disabled?: boolean; active?: boolean; className?: string; kind?: 'local' | 'cloud' | 'file'
}) {
  return (
    <button
      type="button" className={`btn kind-btn ${kind ? 'kind-' + kind : ''} ${active ? 'is-on' : ''} p-1.5 inline-flex items-center justify-center ${className ?? ''}`}
      aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  )
}

/** A coloured block for one of the three ways a preset is saved. */
export function KindPanel({ kind, icon, title, children, right }: { kind: 'local' | 'cloud' | 'file'; icon: IconName; title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={`kind-panel kind-${kind} p-3 space-y-1.5`} role="group" aria-label={title}>
      <div className="flex items-center gap-2">
        <Icon name={icon} size={15} className="kind-text" />
        <span className="text-xs font-semibold uppercase tracking-wide kind-text">{title}</span>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  )
}
