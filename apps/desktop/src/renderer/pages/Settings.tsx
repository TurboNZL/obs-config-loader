import { useEffect, useState } from 'react'
import type { AppSettings, GithubState, GitState, RepoInfo } from '../../../electron/api'
import { Card, Chip, Choice, Message, Page } from '../ui'
import { Icon } from '../components/Icon'
import { GitMissing, GithubCard } from '../components/Account'
import { IdentityCard } from '../components/Identity'
import { StorageCard } from '../components/StorageCard'

export function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [gh, setGh] = useState<GithubState>({ connected: false })
  const [outside, setOutside] = useState<RepoInfo[]>([])
  const [moveMsg, setMoveMsg] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const load = async () => {
    const next = await window.obsLoader.settings.get()
    setS(next)
    const all = await window.obsLoader.repos.list()
    const norm = (p: string) => p.replace(/[\\/]+$/, '')
    setOutside(all.filter((r) => norm(r.path.replace(/[\\/][^\\/]*$/, '')) !== norm(next.presetsRoot)))
  }
  const refreshGit = () => window.obsLoader.git.state().then(setGit)
  const refreshGh = () => window.obsLoader.github.state().then(setGh)
  useEffect(() => { void load(); void refreshGit(); void refreshGh() }, [])

  return (
    <Page icon="settings" title="Settings" intro="Where your presets are kept, how stream keys are handled, your online backup account, who your saves are by, and where big files go.">
      <Card title={<span className="inline-flex items-center gap-2"><Icon name="home" /> When the app opens</span>}>
          <StartTabChoice />
        </Card>
      {s && (
        <Card title={<span className="inline-flex items-center gap-2"><Icon name="folder" /> Where presets are kept</span>}>
          <p className="text-sm text-muted">Every preset gets its own folder here, in the place your system keeps an app's own data. Changing this does not move presets you already have; they stay where they are.</p>
          <p className="mono" aria-label="Presets folder">{s.presetsRoot}</p>
          {moveMsg && <Message tone={moveMsg.tone}>{moveMsg.text}</Message>}
          <div className="flex gap-2 flex-wrap">
            <button className="btn px-3 py-1.5" onClick={async () => {
              const p = await window.obsLoader.files.pick('Choose where presets are kept', true)
              if (p) { await window.obsLoader.settings.setPresetsRoot(p); await load() }
            }}>Change folder…</button>
            {outside.length > 0 && (
              <button className="btn px-3 py-1.5" disabled={moving} onClick={async () => {
                setMoving(true); setMoveMsg(null)
                let moved = 0; const failed: string[] = []
                for (const r of outside) { const m = await window.obsLoader.presets.move(r.path, s.presetsRoot); if (m.ok) moved++; else failed.push(`${r.name}: ${m.error}`) }
                setMoving(false)
                setMoveMsg(failed.length ? { tone: 'warn', text: `Moved ${moved}. Not moved: ${failed.join(' ')}` } : { tone: 'good', text: `Moved ${moved} preset${moved === 1 ? '' : 's'} into this folder.` })
                await load()
              }}>{moving ? 'Moving…' : `Move my ${outside.length} existing preset${outside.length === 1 ? '' : 's'} here too`}</button>
            )}
            {!s.isDefault && <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.settings.setPresetsRoot(null); await load() }}>Use the app's own folder again</button>}
            <button className="btn btn-ghost px-3 py-1.5" onClick={() => window.obsLoader.files.reveal(s.presetsRoot)}>Open folder</button>
          </div>
        </Card>
      )}

      {s && (
        <Card title={<span className="inline-flex items-center gap-2"><Icon name="key" /> Stream keys</span>} right={<Chip tone="good" icon="drive">this computer only</Chip>}>
          <Choice
            checked={s.rememberKeys}
            onChange={async (on) => { await window.obsLoader.settings.setRememberKeys(on); await load() }}
            title="Keep my stream keys inside my presets"
            help="When you make or update a preset from OBS, your stream keys are kept in that preset's own private part on this computer (the “local” folder inside it), so applying the preset puts them back without typing. They are never uploaded to GitHub and never go into the preset's history. You can change this for one preset under its details."
          />
          <p className="text-sm text-muted">They are stored as a plain file, the same way OBS itself keeps them, so protect the presets folder like you protect OBS's own folder. Turning this off only stops keeping keys in presets saved from now on.</p>
        </Card>
      )}

      {git && !git.available && <GitMissing git={git} recheck={refreshGit} />}
      <GithubCard gh={gh} refresh={refreshGh} />
      <IdentityCard key={gh.login ?? (gh.connected ? 'on' : 'off')} />
      <StorageCard />
    </Page>
  )
}


/** Which tab the app opens on. Kept in this computer's browser storage (it is only a convenience). */
function StartTabChoice() {
  const get = () => { try { return localStorage.getItem('obscl.startTab') ?? 'home' } catch { return 'home' } }
  const [v, setV] = useState(get)
  return (
    <label className="block text-sm">
      <span className="text-muted">Open on</span>
      <select className="input w-full px-2 py-1.5 mt-1" value={v} onChange={(e) => { setV(e.target.value); try { localStorage.setItem('obscl.startTab', e.target.value) } catch { /* not kept */ } }} aria-label="Tab to open on">
        <option value="home">Home</option>
        <option value="presets">Presets</option>
        <option value="installs">OBS on this computer</option>
        <option value="last">The tab I was on last time</option>
      </select>
    </label>
  )
}
