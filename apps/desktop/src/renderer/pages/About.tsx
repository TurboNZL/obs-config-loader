import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../electron/api'
import { Card, Page } from '../ui'

const describe = (s: UpdateState): string => {
  switch (s.status) {
    case 'checking': return 'Checking for updates…'
    case 'none': return s.message ?? 'You are on the latest version.'
    case 'downloading': return `Downloading ${s.version ?? 'the update'}${s.percent != null ? ` (${s.percent}%)` : ''}…`
    case 'ready': return s.message ? s.message : `${s.version ?? 'The update'} is ready.`
    case 'disabled': return s.message ?? 'Updates are not available here.'
    case 'error': return `Could not check: ${s.message ?? 'unknown error'}`
    default: return ''
  }
}

export function AboutPage() {
  const [v, setV] = useState('')
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    void window.obsLoader.app.version().then(setV)
    void window.obsLoader.updates.state().then(setState)
    return window.obsLoader.updates.onState(setState)
  }, [])
  const open = (u: string) => window.obsLoader.app.openExternal(u)
  const busy = state.status === 'checking' || state.status === 'downloading'
  return (
    <Page title="About">
      <Card>
        <p>OBS Config Loader {v && <span className="text-muted">v{v}</span>}</p>
        <p className="text-sm text-muted">Apply a whole OBS Studio setup (scenes, sources, profiles, media, plugin list) into any OBS install on Linux, Windows or macOS from one open file. MIT licensed.</p>
        <div className="flex gap-2">
          <button className="btn px-3 py-1.5" onClick={() => open('https://github.com/TurboNZL/obs-config-loader')}>Project on GitHub</button>
          <button className="btn px-3 py-1.5" onClick={() => open('https://github.com/TurboNZL/obs-config-loader/blob/main/docs/FORMAT.md')}>Bundle format</button>
        </div>
      </Card>
      <Card title="App updates">
        <p className="text-sm text-muted">The app checks GitHub for a new version when it starts and every few hours, and downloads it in the background.</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button className="btn px-3 py-1.5" disabled={busy} onClick={() => void window.obsLoader.updates.check().then(setState)}>Check for updates</button>
          {state.status === 'ready' && (
            <button className="btn btn-accent px-3 py-1.5" disabled={state.installing} onClick={() => void window.obsLoader.updates.install()}>Restart to update</button>
          )}
          <span className={state.status === 'error' || state.command ? 'text-warn' : 'text-muted'}>{describe(state)}</span>
        </div>
        {state.command && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <code className="select-all rounded-theme bg-raised px-2 py-1 text-xs">{state.command}</code>
            <button className="btn btn-ghost px-3 py-1" onClick={() => void navigator.clipboard?.writeText(state.command!)}>Copy</button>
          </div>
        )}
      </Card>
    </Page>
  )
}
