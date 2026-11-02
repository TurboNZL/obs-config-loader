import { useEffect, useState } from 'react'
import type { AppSettings, GithubState, GitState } from '../../../electron/api'
import { Card, Chip, Choice, Message, Page } from '../ui'
import { GitMissing, GithubCard } from '../components/Account'

export function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  const [gh, setGh] = useState<GithubState>({ connected: false })
  const load = () => window.obsLoader.settings.get().then(setS)
  const refreshGit = () => window.obsLoader.git.state().then(setGit)
  const refreshGh = () => window.obsLoader.github.state().then(setGh)
  useEffect(() => { void load(); void refreshGit(); void refreshGh() }, [])

  return (
    <Page title="Settings" intro="Where your presets are kept, how stream keys are handled, and your online backup account.">
      {s && (
        <Card title="Where presets are kept">
          <p className="text-sm text-muted">Every preset gets its own folder here. Changing this does not move presets you already have; they stay where they are.</p>
          <p className="mono" aria-label="Presets folder">{s.presetsRoot}</p>
          <div className="flex gap-2 flex-wrap">
            <button className="btn px-3 py-1.5" onClick={async () => {
              const p = await window.obsLoader.files.pick('Choose where presets are kept', true)
              if (p) { await window.obsLoader.settings.setPresetsRoot(p); await load() }
            }}>Change folder…</button>
            {!s.isDefault && <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.settings.setPresetsRoot(null); await load() }}>Use the app's own folder again</button>}
            <button className="btn btn-ghost px-3 py-1.5" onClick={() => window.obsLoader.files.reveal(s.presetsRoot)}>Open folder</button>
          </div>
        </Card>
      )}

      {s && (
        <Card title="Stream keys" right={s.canStoreKeys ? <Chip tone="good">kept safe</Chip> : <Chip tone="warn">not available</Chip>}>
          <Choice
            checked={s.rememberKeys && s.canStoreKeys} disabled={!s.canStoreKeys}
            onChange={async (on) => { await window.obsLoader.settings.setRememberKeys(on); await load() }}
            title="Remember my stream keys on this computer"
            help="When you save a preset, your stream keys are kept encrypted on this computer only, so you can load that preset again without typing them, or put them in a file when you choose to. They are never stored in the preset folder and never uploaded."
          />
          {!s.canStoreKeys && <Message tone="warn">This computer has no system keychain to keep them safe in, so stream keys are not remembered. You can still type them when you load a preset.</Message>}
          {s.canStoreKeys && !s.rememberKeys && <p className="text-sm text-muted">Turning this off also forgets the keys already remembered.</p>}
        </Card>
      )}

      {git && !git.available && <GitMissing git={git} recheck={refreshGit} />}
      <GithubCard gh={gh} refresh={refreshGh} />
    </Page>
  )
}
