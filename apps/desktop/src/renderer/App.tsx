import { useEffect, useState } from 'react'
import type { InstallInfo } from '../../electron/api'
import { HomePage } from './pages/Home'
import { InstallsPage } from './pages/Installs'
import { ImportPage } from './pages/Import'
import { ExportPage } from './pages/Export'
import { ReposPage } from './pages/Repos'
import { AppearancePage } from './pages/Appearance'
import { AboutPage } from './pages/About'
import { GuidesPage } from './pages/Guides'
import { WindowFrame } from './components/WindowFrame'

type Tab = 'home' | 'installs' | 'import' | 'export' | 'repos' | 'guides' | 'appearance' | 'about'
const TABS: [Tab, string][] = [
  ['home', 'Home'], ['export', 'Save my setup'], ['import', 'Load a setup'], ['repos', 'Online backup'],
  ['installs', 'OBS on this computer'], ['guides', 'Help'], ['appearance', 'Look'], ['about', 'About'],
]

export function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [installs, setInstalls] = useState<InstallInfo[] | null>(null)
  const [preselect, setPreselect] = useState<string | undefined>()
  const [openPath, setOpenPath] = useState<string | undefined>()

  const refresh = () => window.obsLoader.installs.list().then(setInstalls)
  useEffect(() => { void refresh() }, [])

  const go = (t: Tab, installId?: string) => { setPreselect(installId); setOpenPath(undefined); setTab(t) }
  const applyRepo = (dir: string, installId?: string) => { setPreselect(installId); setOpenPath(dir); setTab('import') }

  return (
    <div className="flex h-full flex-col">
      <WindowFrame />
      <div className="flex min-h-0 flex-1">
      <nav className="bt-side w-56 shrink-0 p-3 space-y-1" aria-label="Main">
        <div className="px-2 py-3 font-bold">OBS Config Loader</div>
        {TABS.map(([id, label]) => (
          <button key={id} className="bt-nav w-full text-left px-3 py-2" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto">
        {tab === 'home' && <HomePage installs={installs} go={(t) => go(t)} />}
        {tab === 'installs' && <InstallsPage installs={installs} refresh={refresh} go={go} />}
        {tab === 'import' && <ImportPage installs={installs} preselect={preselect} openPath={openPath} refresh={refresh} />}
        {tab === 'export' && <ExportPage installs={installs} preselect={preselect} />}
        {tab === 'repos' && <ReposPage installs={installs} applyRepo={applyRepo} />}
        {tab === 'appearance' && <AppearancePage />}
        {tab === 'guides' && <GuidesPage />}
        {tab === 'about' && <AboutPage />}
      </main>
      </div>
    </div>
  )
}
