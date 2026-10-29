import type { ReactNode } from 'react'

export function Page({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="bt-page mx-auto max-w-4xl p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        {intro && <p className="text-muted mt-1 text-sm">{intro}</p>}
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

export function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone ? { color: `hsl(var(--${tone}))` } : undefined
  return <span className="chip text-xs px-2 py-0.5" style={color}>{children}</span>
}

export function Message({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <div className="card p-3 text-sm" role={tone === 'bad' ? 'alert' : 'status'} style={{ borderColor: `hsl(var(--${tone}))` }}>
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

export const KIND_LABEL: Record<string, string> = {
  windows: 'Windows install', 'windows-portable': 'Windows portable', macos: 'macOS app',
  'linux-native': 'System package', flatpak: 'Flatpak', snap: 'Snap', 'linux-portable': 'Portable build',
}
