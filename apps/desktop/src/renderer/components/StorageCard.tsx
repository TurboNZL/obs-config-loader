import { useEffect, useState } from 'react'
import type { StorageState, StorageTargetInfo } from '../../../electron/api'
import { Card, Chip, Message } from '../ui'
import { Icon } from './Icon'

type Msg = { tone: 'good' | 'warn' | 'bad'; text: string }

/** The keys form on its own, for a preset that says where its big files are and only needs this computer's keys. */
export function StorageForm({ fixed, onSaved, onCancel }: { fixed?: StorageTargetInfo; onSaved: () => Promise<void> | void; onCancel?: () => void }) {
  const [provider, setProvider] = useState<'b2' | 'r2' | 'other'>('b2')
  const [endpoint, setEndpoint] = useState(fixed?.endpoint ?? '')
  const [region, setRegion] = useState(fixed?.region ?? '')
  const [bucket, setBucket] = useState(fixed?.bucket ?? '')
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b2Region = /s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(endpoint)?.[1]
  const needsRegion = !fixed && !b2Region
  return (
    <div className="space-y-2">
      {!fixed && (
        <>
          <label className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-muted">Provider</span>
            <select className="input flex-1 px-2 py-1.5" value={provider} onChange={(e) => { const v = e.target.value as typeof provider; setProvider(v); if (v === 'r2') setRegion('auto') }}>
              <option value="b2">Backblaze B2</option>
              <option value="r2">Cloudflare R2</option>
              <option value="other">Another one that works like Amazon S3</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-muted">Address</span>
            <input className="input flex-1 px-2 py-1.5 mono" placeholder={provider === 'r2' ? 'your-account-id.r2.cloudflarestorage.com' : 'storage address, like s3.us-west-004.backblazeb2.com'} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} aria-label="Storage address" />
          </label>
          {needsRegion && (
            <label className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-muted">Region</span>
              <input className="input flex-1 px-2 py-1.5 mono" placeholder={provider === 'r2' ? 'auto' : 'for example us-east-1'} value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Storage region" />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-muted">Storage space</span>
            <input className="input flex-1 px-2 py-1.5 mono" placeholder="the name you gave it (Backblaze and Cloudflare call it a bucket)" value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="Storage space name" />
          </label>
        </>
      )}
      {fixed && <p className="text-sm">This preset keeps big files in <strong>{fixed.label || fixed.bucket}</strong> ({fixed.endpoint}). Enter the access keys for it to use them on this computer.</p>}
      <label className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-muted">Key ID</span>
        <input className="input flex-1 px-2 py-1.5 mono" autoComplete="off" value={keyId} onChange={(e) => setKeyId(e.target.value)} aria-label="Storage key ID" />
      </label>
      <label className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0 text-muted">Secret key</span>
        <input className="input flex-1 px-2 py-1.5 mono" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Storage secret key" />
      </label>
      {error && <Message tone="bad">{error}</Message>}
      <div className="flex gap-2">
        <button className="btn btn-accent px-3 py-1.5" disabled={busy || !keyId.trim() || !secret.trim()} onClick={async () => {
          setBusy(true); setError(null)
          const target: StorageTargetInfo = fixed ?? { endpoint, region: region || b2Region || (provider === 'r2' ? 'auto' : ''), bucket }
          const r = await window.obsLoader.storage.save(target, { accessKeyId: keyId, secretAccessKey: secret })
          setBusy(false)
          if (r.ok) { setKeyId(''); setSecret(''); await onSaved() } else setError(r.error)
        }}>{busy ? 'Trying it…' : 'Test and save'}</button>
        {onCancel && <button className="btn btn-ghost px-3 py-1.5" onClick={onCancel}>Cancel</button>}
      </div>
      <p className="text-xs text-muted">The app writes a small test file, reads it back and removes it before it keeps anything. The keys are kept encrypted by your system on this computer and are never put in a preset or on GitHub.</p>
    </div>
  )
}

/** Settings: a place for big files that is not GitHub. */
export function StorageCard() {
  const [st, setSt] = useState<StorageState | null>(null)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const load = () => window.obsLoader.storage.state().then(setSt)
  useEffect(() => { void load() }, [])
  if (!st) return null
  const on = !!st.target && st.hasKeys
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Icon name="box" /> Big-file storage</span>} right={on ? <Chip tone="good">{st.target!.label || st.target!.bucket}</Chip> : <Chip>optional</Chip>}>
      <p className="text-sm text-muted">Videos and other big files do not belong on GitHub: it refuses files over 100 MB and every copy of the preset would carry them forever. Put them in a storage space of your own instead. A preset then keeps only a short note saying which file it needs, and the app fetches it from there, checking it is the right file.</p>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
      {on && !editing ? (
        <>
          <p className="text-sm">Connected to <strong>{st.target!.bucket}</strong> <span className="text-muted mono">({st.target!.endpoint})</span>.{st.sessionOnly && ' This computer has no system keychain, so the keys are only kept until you close the app.'}</p>
          <div className="flex gap-2">
            <button className="btn px-3 py-1.5" onClick={() => setEditing(true)}>Change…</button>
            <button className="btn btn-ghost px-3 py-1.5" onClick={async () => { await window.obsLoader.storage.forget(); setMsg({ tone: 'good', text: 'Disconnected. Files already in the storage stay there; presets that use them will ask you to connect again.' }); await load() }}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <details className="text-sm">
            <summary className="cursor-pointer">How do I get a storage space? (free ones exist)</summary>
            <ol className="list-decimal pl-5 mt-1 space-y-1 text-muted">
              <li>Make an account with a provider that sells S3-style storage. <button className="underline" onClick={() => window.obsLoader.app.openExternal('https://www.backblaze.com/cloud-storage')}>Backblaze B2</button> and <button className="underline" onClick={() => window.obsLoader.app.openExternal('https://www.cloudflare.com/developer-platform/products/r2/')}>Cloudflare R2</button> both list a free amount of about 10 GB; check their pages for today's terms, and whether they ask for a payment card.</li>
              <li>Create a <strong>private</strong> space (a “bucket”) and give it a name.</li>
              <li>Create an access key that is only allowed to use that space, and copy its <strong>key ID</strong> and <strong>secret key</strong> (the secret is shown once).</li>
              <li>Copy the space's <strong>address</strong> (Backblaze shows it as “Endpoint”, for example s3.us-west-004.backblazeb2.com) and paste all of it below.</li>
            </ol>
          </details>
          <StorageForm onSaved={async () => { setEditing(false); setMsg({ tone: 'good', text: 'Connected. In a preset’s details, tick “Big-file storage” next to a file to keep it there.' }); await load() }} onCancel={on ? () => setEditing(false) : undefined} />
        </>
      )}
    </Card>
  )
}
