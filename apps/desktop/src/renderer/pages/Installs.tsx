import { useState } from 'react'
import type { InstallInfo } from '../../../electron/api'
import { Card, Chip, KIND_LABEL, Message, Page } from '../ui'

export function InstallsPage({ installs, refresh, go }: {
  installs: InstallInfo[] | null
  refresh: () => Promise<void>
  go: (t: 'import' | 'export', installId?: string) => void
}) {
  const [msg, setMsg] = useState<string | null>(null)

  const addPortable = async () => {
    const r = await window.obsLoader.installs.addPortable()
    if (r.error) setMsg(r.error)
    else if (r.added) { setMsg(null); await refresh() }
  }

  return (
    <Page
      title="OBS installs"
      intro="Every OBS Studio this app can find on this computer. A portable install is a folder, so add those by hand."
    >
      {msg && <Message tone="bad">{msg}</Message>}
      {installs === null && <p className="text-muted">Looking for OBS…</p>}
      {installs?.length === 0 && (
        <Message tone="warn">
          No OBS install found in the usual places. Install OBS Studio, or add a portable one below.
        </Message>
      )}
      {installs?.map((i) => (
        <Card
          key={i.id}
          title={<span>{i.label}</span>}
          right={<div className="flex gap-2 flex-wrap justify-end">
            <Chip>{KIND_LABEL[i.kind] ?? i.kind}</Chip>
            {i.running && <Chip tone="warn">running</Chip>}
            {!i.configExists && <Chip tone="warn">never started</Chip>}
            {i.custom && <Chip>added by you</Chip>}
          </div>}
        >
          <p className="mono text-muted">{i.configDir}</p>
          {i.configExists && (
            <p className="text-sm text-muted">
              {i.collections.length} scene collection{i.collections.length === 1 ? '' : 's'}, {i.profiles.length} profile{i.profiles.length === 1 ? '' : 's'}
              {i.collections.length > 0 && <>: {i.collections.slice(0, 4).join(', ')}{i.collections.length > 4 ? '…' : ''}</>}
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-accent px-3 py-1.5" onClick={() => go('import', i.id)}>Import a setup here</button>
            <button className="btn px-3 py-1.5" disabled={!i.configExists} onClick={() => go('export', i.id)}>Export this setup</button>
            <button className="btn btn-ghost px-3 py-1.5" disabled={!i.configExists} onClick={() => window.obsLoader.installs.openFolder(i.id)}>Open folder</button>
            {i.custom && <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.installs.remove(i.id); await refresh() }}>Remove from list</button>}
          </div>
        </Card>
      ))}
      <div className="flex gap-2">
        <button className="btn px-3 py-1.5" onClick={addPortable}>Add a portable install…</button>
        <button className="btn btn-ghost px-3 py-1.5" onClick={() => void refresh()}>Refresh</button>
      </div>
    </Page>
  )
}
