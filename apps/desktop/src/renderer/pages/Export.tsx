import { useEffect, useState } from 'react'
import type { ExportResult, InstallInfo } from '../../../electron/api'
import { Card, Choice, Field, KIND_LABEL, Message, Page, Step, plural, size } from '../ui'

export function ExportPage({ installs, preselect }: { installs: InstallInfo[] | null; preselect?: string }) {
  const usable = (installs ?? []).filter((i) => i.configExists)
  const [installId, setInstallId] = useState(preselect ?? '')
  const [name, setName] = useState('My OBS setup')
  const [scenes, setScenes] = useState<string[]>([])
  const [outputs, setOutputs] = useState<string[]>([])
  const [media, setMedia] = useState<'small' | 'all' | 'none'>('small')
  const [includeKeys, setIncludeKeys] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!installId || !usable.some((i) => i.id === installId)) setInstallId(usable[0]?.id ?? '')
  }, [installs]) // eslint-disable-line react-hooks/exhaustive-deps
  const install = usable.find((i) => i.id === installId)
  useEffect(() => {
    setScenes(install?.collections ?? [])
    setOutputs(install?.profiles ?? [])
  }, [install?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    const r = await window.obsLoader.export.run({ installId, name: name.trim(), collections: scenes, profiles: outputs, media, includeKeys })
    setBusy(false)
    if (!r) return // the person closed the save window
    if ('error' in r) setError(r.error)
    else setResult(r)
  }
  const toggle = (list: string[], set: (l: string[]) => void, item: string, on: boolean) => set(on ? [...list, item] : list.filter((x) => x !== item))

  return (
    <Page title="Save my OBS setup to a file" intro="This makes one file with your scenes and settings. Copy it to another computer, or keep it as a backup.">
      {error && <Message tone="bad">{error}</Message>}
      {usable.length === 0 && <Message tone="warn">There is no saved OBS setup to copy yet. Open OBS once and set it up, or add OBS from a folder under “OBS on this computer”.</Message>}

      {install && !result && (
        <>
          <Step n={1} title="Which OBS?" help={usable.length > 1 ? 'You have more than one OBS on this computer. Pick the one whose setup you want to save.' : undefined}>
            {usable.length > 1 ? (
              <select className="input w-full px-2 py-1.5" value={installId} onChange={(e) => setInstallId(e.target.value)} aria-label="Which OBS">
                {usable.map((i) => <option key={i.id} value={i.id}>{i.label} ({KIND_LABEL[i.kind] ?? i.kind})</option>)}
              </select>
            ) : <p className="text-sm"><strong>{install.label}</strong> <span className="text-muted">({KIND_LABEL[install.kind] ?? install.kind})</span></p>}
          </Step>

          <Step n={2} title="What should go in the file?">
            <div>
              <h3 className="text-sm font-semibold">Scenes</h3>
              <p className="text-xs text-muted mb-1">Your scene layouts and everything in them: sources, filters, transitions. (OBS calls each set a “Scene Collection”.)</p>
              {install.collections.length === 0 && <p className="text-sm text-muted">No scenes saved in this OBS yet.</p>}
              {install.collections.map((c) => <Choice key={c} checked={scenes.includes(c)} onChange={(on) => toggle(scenes, setScenes, c, on)} title={c} />)}
            </div>
            <div>
              <h3 className="text-sm font-semibold">Output settings</h3>
              <p className="text-xs text-muted mb-1">How you stream and record: service, video quality, encoder, audio. (OBS calls each set a “Profile”.)</p>
              {install.profiles.map((c) => <Choice key={c} checked={outputs.includes(c)} onChange={(on) => toggle(outputs, setOutputs, c, on)} title={c} />)}
            </div>
            <div>
              <h3 className="text-sm font-semibold">Pictures, music and videos your scenes use</h3>
              <Choice type="radio" name="media" checked={media === 'small'} onChange={() => setMedia('small')} title="Small files only (recommended)" help="Files under 5 MB go in the file. Bigger ones are left out, and you point to them when you load the setup." />
              <Choice type="radio" name="media" checked={media === 'all'} onChange={() => setMedia('all')} title="Every file" help="Nothing to find again later, but the file can become very big." />
              <Choice type="radio" name="media" checked={media === 'none'} onChange={() => setMedia('none')} title="None" help="You point to each one when you load the setup." />
            </div>
          </Step>

          <Step n={3} title="Stream keys" help="A stream key is the secret that lets OBS go live on your channel.">
            <Choice
              checked={includeKeys} onChange={setIncludeKeys}
              title="Include my stream keys in the file"
              help="Off is safest: the file is then safe to share, and you type your keys again when you load it. Turn it on only if this file is just for you, for example to move to your other computer in one step."
            />
            {includeKeys && (
              <Message tone="bad">
                <strong>Keep this file private.</strong> Anyone who gets it can stream as you. The file will be marked “CONTAINS STREAM KEYS” in its name and inside, and this app will warn you every time it is opened. Delete it once you have loaded it. Never post it or put it in a git repository.
              </Message>
            )}
          </Step>

          <Step n={4} title="Save it">
            <Field label="Give this setup a name" hint="Shown when you open the file later. You choose where to save it next.">
              <input className="input w-full px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <p className="text-sm text-muted">This will save {plural(scenes.length, 'scene layout')} and {plural(outputs.length, 'output setting')}{includeKeys ? ', including your stream keys' : ', without your stream keys'}.</p>
            <button className="btn btn-accent px-4 py-2" disabled={busy || !name.trim() || scenes.length + outputs.length === 0} onClick={run}>
              {busy ? 'Saving…' : 'Save to a file…'}
            </button>
          </Step>
        </>
      )}

      {result && <Saved result={result} again={() => setResult(null)} />}
    </Page>
  )
}

function Saved({ result, again }: { result: ExportResult; again: () => void }) {
  return (
    <>
      <Message tone="good"><strong>Saved.</strong> Your setup is in one file{result.sizeBytes ? ` (${size(result.sizeBytes)})` : ''}.</Message>
      <Card title="Your file">
        <p className="mono">{result.path}</p>
        <div className="flex gap-2 flex-wrap">
          <button className="btn px-3 py-1.5" onClick={() => void window.obsLoader.files.reveal(result.path)}>Show in folder</button>
          <button className="btn btn-ghost px-3 py-1.5" onClick={again}>Save another</button>
        </div>
      </Card>

      {result.containsSecrets ? (
        <Message tone="bad"><strong>This file contains your stream keys.</strong> Keep it private and delete it once you have loaded it. Never post it or put it in a git repository.</Message>
      ) : result.secrets.length > 0 && (
        <Card title="What you will type again when you load it">
          <p className="text-sm text-muted">Your stream keys are not in the file, so it is safe to share. When you load it, you will be asked for:</p>
          <ul className="list-disc pl-5 text-sm">{result.secrets.map((s) => <li key={s}>{s}</li>)}</ul>
        </Card>
      )}

      <Card title="What is in it">
        <ul className="list-disc pl-5 text-sm space-y-0.5">
          <li>{plural(result.collections, 'scene layout')} and {plural(result.profiles, 'output setting')}</li>
          <li>{plural(result.assets.bundled, 'picture, sound or video')} included{result.assets.external > 0 && `; ${result.assets.external} too big to include (you will point to ${result.assets.external === 1 ? 'it' : 'them'} when loading)`}</li>
        </ul>
      </Card>

      {result.plugins.length > 0 && (
        <Card title="Install these OBS plugins on the other computer first">
          <p className="text-sm text-muted">Your scenes use these plugins. Plugins are not inside the file, so the other OBS needs them too, or those parts will be empty.</p>
          <ul className="list-disc pl-5 text-sm">{result.plugins.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="text-xs text-muted">When you load the file, the app tells you which ones are missing and how to get them.</p>
        </Card>
      )}
    </>
  )
}
