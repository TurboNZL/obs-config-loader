import type { InstallInfo } from '../../../electron/api'
import { Card, Chip, Message, KIND_LABEL, plural } from '../ui'

type Go = (t: 'installs' | 'import' | 'presets' | 'settings') => void

function Big({ title, text, onClick, accent }: { title: string; text: string; onClick: () => void; accent?: boolean }) {
  return (
    <button className={'card p-5 text-left w-full space-y-1 ' + (accent ? 'bt-sel' : '')} data-selected={accent ? '' : undefined} onClick={onClick}>
      <div className="text-lg font-semibold">{title}</div>
      <div className="text-sm text-muted">{text}</div>
    </button>
  )
}

export function HomePage({ installs, go }: { installs: InstallInfo[] | null; go: Go }) {
  const found = installs ?? []
  return (
    <div className="bt-page mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">What would you like to do?</h1>
        <p className="text-muted mt-1">Keep your whole OBS setup (scenes, settings, plugin list) as presets: move it between computers, or keep it safely backed up.</p>
      </header>

      <div className="space-y-3">
        <Big title="My presets" text="Save your OBS setup as a preset. Apply it back to OBS, save it to a file for another computer, or switch on online backup." onClick={() => go('presets')} accent />
        <Big title="Open a setup file" text="Someone sent you a setup file, or you exported one earlier: put it into the OBS on this computer." onClick={() => go('import')} />
      </div>

      <Card title="OBS on this computer" right={<button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => go('installs')}>Manage…</button>}>
        {installs === null && <p className="text-sm text-muted">Looking for OBS…</p>}
        {installs && found.length === 0 && <Message tone="warn">No OBS found yet. Install OBS Studio, or tell this app where yours is under “OBS on this computer”.</Message>}
        {found.length > 0 && (
          <ul className="space-y-1">
            {found.map((i) => (
              <li key={i.id} className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-medium">{i.label}</span>
                <Chip>{KIND_LABEL[i.kind] ?? i.kind}</Chip>
                {i.configExists && <span className="text-muted">{plural(i.collections.length, 'scene layout')}, {plural(i.profiles.length, 'output setting')}</span>}
                {!i.configExists && <Chip tone="warn">not opened yet</Chip>}
                {i.running && <Chip tone="warn">open now</Chip>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
