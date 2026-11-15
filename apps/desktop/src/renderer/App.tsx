import { useEffect, useState } from 'react'
import type { InstallInfo } from '../../electron/api'
import { HomePage } from './pages/Home'
import { InstallsPage } from './pages/Installs'
import { ImportPage } from './pages/Import'
import { PresetsPage } from './pages/Presets'
import { SettingsPage } from './pages/Settings'
import { AppearancePage } from './pages/Appearance'
import { AboutPage } from './pages/About'
import { GuidesPage } from './pages/Guides'
import { WindowFrame } from './components/WindowFrame'
import { Icon, type IconName } from './components/Icon'
import { ScriptTabsContext, ScriptView, TabBar, applyScriptEvent, type ScriptTab } from './components/ScriptTabs'

type Tab = 'home' | 'presets' | 'installs' | 'import' | 'settings' | 'guides' | 'appearance' | 'about'
const TABS: [Tab, string, IconName][] = [
  ['home', 'Home', 'home'], ['presets', 'Presets', 'layers'], ['installs', 'OBS on this computer', 'monitor'], ['settings', 'Settings', 'settings'],
  ['guides', 'Help', 'help'], ['appearance', 'Look', 'palette'], ['about', 'About', 'info'],
]

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window or blocked storage: the setting just does not stick */ } },
}
/** Which tab the app opens on: the one the person chose in Settings, or the one they were on last time. */
function startTab(): Tab {
  const ids = TABS.map((t) => t[0]) as string[]
  const want = ls.get('obscl.startTab') ?? 'home'
  const pick = want === 'last' ? ls.get('obscl.lastTab') : want
  return pick && ids.includes(pick) ? (pick as Tab) : 'home'
}

export function App() {
  const [tab, setTab] = useState<Tab>(startTab)
  useEffect(() => { if (tab !== 'import') ls.set('obscl.lastTab', tab) }, [tab])
  // the last answer is shown at once while the real one is worked out (a cold start otherwise shows an empty page for seconds)
  const [installs, setInstalls] = useState<InstallInfo[] | null>(() => { try { const c = localStorage.getItem('obscl.cache.installs'); return c ? (JSON.parse(c) as InstallInfo[]).map((i) => ({ ...i, running: false })) : null } catch { return null } })
  const [preselect, setPreselect] = useState<string | undefined>()
  const [openPath, setOpenPath] = useState<string | undefined>()

  // scripts that draw their screens in tabs of their own (hidden until one is opened)
  const [scripts, setScripts] = useState<ScriptTab[]>([])
  const [scriptTab, setScriptTab] = useState<string | null>(null)
  useEffect(() => window.obsLoader.script.onEvent(({ id, msg }) => setScripts((list) => list.map((t) => (t.id === id ? applyScriptEvent(t, msg) : t)))), [])
  const openScript = async (presetPath: string, stepId: string, kind: string, preset: string) => {
    const r = await window.obsLoader.script.start(presetPath, stepId, `${kind} ${preset}`)
    if (!r.ok) return r.error
    const key = r.id
    setScripts((l) => [...l, { key, id: r.id, kind, preset, screen: null, say: '', lines: [] }])
    setScriptTab(key)
    window.dispatchEvent(new Event('obscl:script-opened')) // a manager popup underneath would cover the tab bar
    return null
  }
  const closeScript = (key: string) => {
    const t = scripts.find((x) => x.key === key)
    if (t) void window.obsLoader.script.stop(t.id)
    setScripts((l) => l.filter((x) => x.key !== key))
    setScriptTab((cur) => (cur === key ? null : cur))
  }
  const refresh = () => window.obsLoader.installs.list().then((l) => { setInstalls(l); try { localStorage.setItem('obscl.cache.installs', JSON.stringify(l)) } catch { /* only a speed-up */ } })
  useEffect(() => { void refresh() }, [])

  const go = (t: Tab, installId?: string) => { setPreselect(installId); setOpenPath(undefined); setTab(t); void refresh() }
  const applyRepo = (dir: string, installId?: string) => { setPreselect(installId); setOpenPath(dir); setTab('import') }

  const current = scripts.find((t) => t.key === scriptTab)
  return (
    <ScriptTabsContext.Provider value={{ open: openScript }}>
    <div className="flex h-full flex-col">
      <WindowFrame />
      <TabBar tabs={scripts} current={current ? current.key : null} setCurrent={setScriptTab} close={closeScript} />
      {current && <main className="flex-1 overflow-y-auto"><ScriptView tab={current} onClose={() => closeScript(current.key)} /></main>}
      <div className={'min-h-0 flex-1 ' + (current ? 'hidden' : 'flex')}>
      <nav className="bt-side bt-shell w-56 shrink-0 p-3 space-y-1" aria-label="Main">
        <div className="px-2 py-3 font-bold">OBS Config Loader</div>
        {TABS.map(([id, label, icon]) => (
          <button key={id} className="bt-nav w-full text-left px-3 py-2 flex items-center gap-2.5" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon name={icon} size={17} />{label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto">
        {tab === 'home' && <HomePage installs={installs} go={(t) => go(t)} />}
        {tab === 'installs' && <InstallsPage installs={installs} refresh={refresh} go={go} />}
        {tab === 'import' && <ImportPage installs={installs} preselect={preselect} openPath={openPath} refresh={refresh} onBack={() => go('presets')} />}
        {tab === 'presets' && <PresetsPage installs={installs} applyRepo={applyRepo} go={(t) => go(t)} startWith={preselect} refreshInstalls={refresh} />}
        {tab === 'settings' && <SettingsPage />}
        {tab === 'appearance' && <AppearancePage />}
        {tab === 'guides' && <GuidesPage />}
        {tab === 'about' && <AboutPage />}
      </main>
      </div>
    </div>
    </ScriptTabsContext.Provider>
  )
}
