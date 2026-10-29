import { useEffect, useState } from 'react'
import type { ExportResult, InstallInfo } from '../../../electron/api'
import { Card, Chip, Field, KIND_LABEL, Message, Page } from '../ui'

export function ExportPage({ installs, preselect }: { installs: InstallInfo[] | null; preselect?: string }) {
  const usable = (installs ?? []).filter((i) => i.configExists)
  const [installId, setInstallId] = useState(preselect ?? '')
  const [name, setName] = useState('My OBS setup')
  const [collections, setCollections] = useState<string[]>([])
  const [profiles, setProfiles] = useState<string[]>([])
  const [media, setMedia] = useState<'small' | 'all' | 'none'>('small')
  const [format, setFormat] = useState<'file' | 'folder'>('file')
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!installId || !usable.some((i) => i.id === installId)) setInstallId(usable[0]?.id ?? '')
  }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  const install = usable.find((i) => i.id === installId)
  useEffect(() => {
    setCollections(install?.collections ?? [])
    setProfiles(install?.profiles ?? [])
  }, [install?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    const r = await window.obsLoader.export.run({ installId, name, collections, profiles, media, format })
    setBusy(false)
    if (!r) return
    if ('error' in r) setError(r.error)
    else setResult(r)
  }

  return (
    <Page title="Export a setup" intro="Turn an OBS install into one portable bundle. Stream keys and other secrets are never written into it.">
      {error && <Message tone="bad">{error}</Message>}
      {usable.length === 0 && <Message tone="warn">No OBS install with a saved setup was found. Start OBS once, or add a portable install first.</Message>}
      {install && (
        <>
          <Card title="What to export">
            <Field label="OBS install">
              <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)}>
                {usable.map((i) => <option key={i.id} value={i.id}>{i.label}: {KIND_LABEL[i.kind] ?? i.kind}</option>)}
              </select>
            </Field>
            <Field label="Name of the setup"><input className="input w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Scene collections</legend>
              {install.collections.length === 0 && <p className="text-sm text-muted">None saved yet.</p>}
              {install.collections.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={collections.includes(c)} onChange={(e) => setCollections(e.target.checked ? [...collections, c] : collections.filter((x) => x !== c))} /> {c}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Profiles (output, video and stream settings)</legend>
              {install.profiles.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={profiles.includes(c)} onChange={(e) => setProfiles(e.target.checked ? [...profiles, c] : profiles.filter((x) => x !== c))} /> {c}
                </label>
              ))}
            </fieldset>
          </Card>

          <Card title="How to package it">
            <Field label="Media files (images, videos, audio)" hint="Larger files can always be located again on import.">
              <select className="input w-full px-2 py-1.5" value={media} onChange={(e) => setMedia(e.target.value as typeof media)}>
                <option value="small">Include small files (up to 5 MB), leave big ones out</option>
                <option value="all">Include everything (can be very large)</option>
                <option value="none">Include none (placeholders only)</option>
              </select>
            </Field>
            <Field label="Format" hint={format === 'folder' ? 'Plain files in a folder: commit it to git. Media are never written here, only placeholders with their checksums.' : 'One .obsbundle file you can send or keep.'}>
              <select className="input w-full px-2 py-1.5" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="file">One file (.obsbundle)</option>
                <option value="folder">A folder for git</option>
              </select>
            </Field>
            <button className="btn btn-accent px-4 py-2" disabled={busy || !name.trim() || (collections.length + profiles.length === 0)} onClick={run}>
              {busy ? 'Exporting…' : 'Export…'}
            </button>
          </Card>
        </>
      )}

      {result && (
        <Card title="Exported">
          <p className="mono">{result.path}</p>
          <div className="flex gap-2 flex-wrap">
            <Chip>{result.collections} collection{result.collections === 1 ? '' : 's'}</Chip>
            <Chip>{result.profiles} profile{result.profiles === 1 ? '' : 's'}</Chip>
            <Chip>{result.assets.bundled} media file{result.assets.bundled === 1 ? '' : 's'} included</Chip>
            <Chip>{result.assets.external} left as placeholders</Chip>
          </div>
          {result.secrets.length > 0 && <p className="text-sm">Left out on purpose and asked for again on import: <span className="mono">{result.secrets.join(', ')}</span></p>}
          {result.plugins.length > 0 && <p className="text-sm">Plugins this setup relies on (not bundled): {result.plugins.join(', ')}</p>}
        </Card>
      )}
    </Page>
  )
}
