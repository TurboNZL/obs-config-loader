import { useEffect, useState } from 'react'
import { Card, Page } from '../ui'

export function AboutPage() {
  const [v, setV] = useState('')
  useEffect(() => { void window.obsLoader.app.version().then(setV) }, [])
  const open = (u: string) => window.obsLoader.app.openExternal(u)
  return (
    <Page title="About">
      <Card>
        <p>OBS Config Loader {v && <span className="text-muted">v{v}</span>}</p>
        <p className="text-sm text-muted">Load a whole OBS Studio setup (scenes, sources, profiles, media, plugin list) into any OBS install on Linux, Windows or macOS from one open file. MIT licensed.</p>
        <div className="flex gap-2">
          <button className="btn px-3 py-1.5" onClick={() => open('https://github.com/TurboNZL/obs-config-loader')}>Project on GitHub</button>
          <button className="btn px-3 py-1.5" onClick={() => open('https://github.com/TurboNZL/obs-config-loader/blob/main/docs/FORMAT.md')}>Bundle format</button>
        </div>
      </Card>
    </Page>
  )
}
