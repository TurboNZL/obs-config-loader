import { useEffect, useState } from 'react'
import type { InstallInfo, LogEntry, PresetOverview, RepoInfo } from '../../../electron/api'
import { Card, Chip, Message, KIND_LABEL, Page, plural, size } from '../ui'
import { Icon, type IconName } from '../components/Icon'

type Go = (t: 'installs' | 'import' | 'presets' | 'settings') => void

interface Facts { repo: RepoInfo; ov: PresetOverview | null; last?: LogEntry; obsChanges: number | null; obsLabel?: string }

function Stat({ icon, value, label, kind }: { icon: IconName; value: string; label: string; kind?: 'local' | 'cloud' | 'file' }) {
  return (
    <div className={`card p-4 flex items-center gap-3 ${kind ? 'kind-' + kind : ''}`}>
      <div className={'rounded-theme p-2 ' + (kind ? 'kind-panel' : 'bg-raised')}><Icon name={icon} size={20} className={kind ? 'kind-text' : 'text-muted'} /></div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="text-xs text-muted mt-1">{label}</div>
      </div>
    </div>
  )
}

type Note = { tone: 'good' | 'warn' | 'bad'; icon: IconName; text: string; action?: string }

const ago = (iso?: string) => {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`
  return `${Math.round(s / 86400)} days ago`
}

export function HomePage({ installs, go }: { installs: InstallInfo[] | null; go: Go }) {
  const [facts, setFacts] = useState<Facts[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const repos = await window.obsLoader.repos.list()
      const base: Facts[] = await Promise.all(repos.map(async (repo) => ({
        repo,
        ov: await window.obsLoader.presets.overview(repo.path).catch(() => null),
        last: (await window.obsLoader.repos.log(repo.path).catch(() => []))[0],
        obsChanges: null,
      })))
      if (!alive) return
      setFacts(base)
      // what OBS has that a linked preset does not: one at a time, because it reads the real files
      for (const f of base) {
        const inst = f.repo.installId ? (installs ?? []).find((i) => i.id === f.repo.installId) : undefined
        if (!inst) continue
        const r = await window.obsLoader.repos.live(f.repo.path, inst.id).catch(() => null)
        if (!alive) return
        if (r && !('error' in r)) setFacts((cur) => cur && cur.map((x) => (x.repo.path === f.repo.path ? { ...x, obsChanges: r.changed.length, obsLabel: inst.label } : x)))
      }
    })()
    return () => { alive = false }
  }, [installs])

  const found = installs ?? []
  const list = facts ?? []
  const total = (pick: (o: PresetOverview) => number) => list.reduce((n, f) => n + (f.ov ? pick(f.ov) : 0), 0)
  const online = list.filter((f) => f.repo.remoteUrl).length
  const notes: Note[] = []
  for (const f of list) {
    const n = f.repo.name
    if (f.obsChanges) notes.push({ tone: 'warn', icon: 'monitor', text: `${f.obsLabel ?? 'Your OBS'} has ${plural(f.obsChanges, 'change')} that “${n}” does not have yet.`, action: 'Update the preset from OBS' })
    if (f.repo.status.ahead > 0 && f.repo.remoteUrl) notes.push({ tone: 'warn', icon: 'cloudUp', text: `“${n}” has ${plural(f.repo.status.ahead, 'save')} that are not backed up on GitHub yet.`, action: 'Upload' })
    if (f.repo.status.behind > 0) notes.push({ tone: 'warn', icon: 'download', text: `GitHub has ${plural(f.repo.status.behind, 'newer change')} for “${n}”.`, action: 'Get updates' })
    if (f.repo.status.dirtyFiles.length) notes.push({ tone: 'warn', icon: 'pencil', text: `“${n}” has ${plural(f.repo.status.dirtyFiles.length, 'file')} changed by hand and not saved.` })
    const missing = f.ov?.files.filter((x) => !x.available).length ?? 0
    if (missing) notes.push({ tone: 'warn', icon: 'image', text: `“${n}” needs ${plural(missing, 'file')} this computer does not have yet.`, action: 'Find them' })
    if (!f.repo.remoteUrl) notes.push({ tone: 'good', icon: 'cloud', text: `“${n}” is only on this computer. Switch on online backup to keep a copy on GitHub.` })
    if (f.ov && f.ov.keys.count === 0 && f.ov.keys.keep && f.repo.installId) notes.push({ tone: 'good', icon: 'key', text: `“${n}” has no stream keys kept in it. Update the preset from OBS to keep them.` })
  }
  if (installs && found.length === 0) notes.push({ tone: 'bad', icon: 'monitor', text: 'No OBS was found on this computer. Install OBS Studio, or tell this app where yours is.', action: 'OBS on this computer' })
  const urgent = notes.filter((x) => x.tone !== 'good')
  const maxSize = Math.max(1, ...list.map((f) => f.ov?.sizeBytes ?? 0))

  return (
    <Page wide icon="home" title="Home" intro="How your presets are doing, and anything that needs a look.">
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-accent px-4 py-2 inline-flex items-center gap-2" onClick={() => go('presets')}><Icon name="layers" /> My presets</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="layers" value={String(list.length)} label={list.length === 1 ? 'preset' : 'presets'} kind="local" />
        <Stat icon="cloud" value={`${online} / ${list.length}`} label="backed up on GitHub" kind="cloud" />
        <Stat icon="grid" value={String(total((o) => o.layouts.reduce((n, l) => n + l.scenes, 0)))} label={`scenes in ${plural(total((o) => o.layouts.length), 'scene layout')}`} />
        <Stat icon="image" value={String(total((o) => o.files.length))} label={`files used (${size(total((o) => o.files.reduce((n, f) => n + f.size, 0)))})`} />
        <Stat icon="key" value={String(total((o) => o.keys.count))} label="stream keys kept on this computer" />
        <Stat icon="drive" value={size(total((o) => o.sizeBytes))} label="space the presets take" kind="local" />
        <Stat icon="monitor" value={String(found.length)} label={found.length === 1 ? 'OBS on this computer' : 'OBS installs on this computer'} />
        <Stat icon="link" value={`${list.filter((f) => f.repo.installId).length} / ${list.length}`} label="presets linked to an OBS" />
      </div>

      <Card title={<span className="inline-flex items-center gap-2"><Icon name="bell" /> Needs a look</span>}>
        {facts === null && <p className="text-sm text-muted">Looking…</p>}
        {facts && urgent.length === 0 && <Message tone="good">Everything is saved and backed up.</Message>}
        <ul className="space-y-1.5">
          {[...urgent, ...notes.filter((x) => x.tone === 'good')].map((n, i) => (
            <li key={i}>
              <div className="flex items-center gap-2 text-sm rounded-theme px-2 py-1.5" style={{ backgroundColor: `hsl(var(--${n.tone}) / 0.1)` }}>
                <Icon name={n.icon} size={15} style={{ color: `hsl(var(--${n.tone}))` }} />
                <span className="flex-1 min-w-0">{n.text}</span>
                <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => go(n.action === 'OBS on this computer' ? 'installs' : 'presets')}>{n.action ?? 'Open presets'}</button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {list.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title={<span className="inline-flex items-center gap-2"><Icon name="chart" /> Where the space goes</span>}>
            <ul className="space-y-2">
              {[...list].sort((a, b) => (b.ov?.sizeBytes ?? 0) - (a.ov?.sizeBytes ?? 0)).map((f) => (
                <li key={f.repo.path} className="kind-local">
                  <div className="flex justify-between text-sm"><span className="truncate">{f.repo.name}</span><span className="text-muted">{size(f.ov?.sizeBytes ?? 0)}</span></div>
                  <div className="bar"><span style={{ width: `${Math.max(2, ((f.ov?.sizeBytes ?? 0) / maxSize) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><Icon name="clock" /> Last saved</span>}>
            <ul className="space-y-1.5">
              {[...list].sort((a, b) => (b.last?.date ?? '').localeCompare(a.last?.date ?? '')).map((f) => (
                <li key={f.repo.path} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">{f.repo.name}</span>
                  {f.repo.installId ? <Chip icon="link">linked</Chip> : <Chip icon="unlink">on its own</Chip>}
                  <span className="text-muted w-32 text-right">{ago(f.last?.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card title={<span className="inline-flex items-center gap-2"><Icon name="monitor" /> OBS on this computer</span>} right={<button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => go('installs')}>Manage…</button>}>
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
    </Page>
  )
}
