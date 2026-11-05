import { useEffect, useState } from 'react'
import { Field } from '../ui'

/**
 * "Put it under: my account / <an organisation>". Only shown to people who belong to an organisation on GitHub, so everyone
 * else sees nothing new. `value` is '' for the person's own account.
 */
export function OwnerPick({ value, onChange, login }: { value: string; onChange: (org: string) => void; login?: string }) {
  const [orgs, setOrgs] = useState<string[]>([])
  useEffect(() => { void window.obsLoader.github.orgs().then((r) => setOrgs(r.ok ? r.orgs : [])).catch(() => setOrgs([])) }, [])
  if (!orgs.length) return null
  return (
    <Field label="Put it under" hint="Your own account, or a group you belong to on GitHub. Choose before switching backup on.">
      <select className="input w-full px-2 py-1.5" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Put it under">
        <option value="">{login ? `My account (${login})` : 'My account'}</option>
        {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  )
}
