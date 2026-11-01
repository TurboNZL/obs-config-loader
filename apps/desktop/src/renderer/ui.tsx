import type { ReactNode } from 'react'

export function Page({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="bt-page mx-auto max-w-3xl p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
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

export function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone ? { color: `hsl(var(--${tone}))` } : undefined
  return <span className="chip text-xs px-2 py-0.5" style={color}>{children}</span>
}

export function Message({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  // A tinted background and a thick coloured edge: a theme can restyle borders, and a warning must still stand out.
  return (
    <div
      className="card p-3 pl-4 text-sm" role={tone === 'bad' ? 'alert' : 'status'}
      style={{ backgroundColor: `hsl(var(--${tone}) / 0.12)`, boxShadow: `inset 5px 0 0 hsl(var(--${tone}))` }}
    >
      {children}
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
