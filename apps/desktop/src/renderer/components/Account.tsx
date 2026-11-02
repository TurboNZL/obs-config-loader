import { useState } from 'react'
import type { GithubState, GitState } from '../../../electron/api'
import { Card, Chip, Message } from '../ui'

// ── git is not installed ─────────────────────────────────────────────────────

export function GitMissing({ git, recheck }: { git: GitState; recheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Card title="One more thing is needed: Git">
      <p className="text-sm">Online backup uses a free tool called Git, which is not installed on this computer yet.</p>
      {msg && <Message tone="warn">{msg}</Message>}
      <div className="flex gap-2 flex-wrap">
        {git.help.auto && (
          <button className="btn btn-accent px-3 py-1.5" disabled={busy} onClick={async () => {
            setBusy(true); setMsg(null)
            const r = await window.obsLoader.git.install()
            setBusy(false)
            if (!r.ok) setMsg(r.message)
            await recheck()
          }}>{busy ? 'Installing…' : git.help.auto.label}</button>
        )}
        <button className="btn px-3 py-1.5" onClick={() => void recheck()}>Check again</button>
      </div>
      <p className="text-sm text-muted">{git.help.manual}</p>
      {git.help.commandLine && <pre className="cmd mono rounded-theme">{git.help.commandLine}</pre>}
    </Card>
  )
}

// ── GitHub account ───────────────────────────────────────────────────────────

export function GithubCard({ gh, refresh }: { gh: GithubState; refresh: () => Promise<void> }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Card title="GitHub account" right={gh.connected ? <Chip tone="good">{gh.login ? `signed in as ${gh.login}` : 'signed in'}</Chip> : <Chip>optional</Chip>}>
      {gh.connected ? (
        <>
          <p className="text-sm text-muted">
            You can create repositories on GitHub and pick from yours without leaving the app.
            {gh.sessionOnly && ' This computer has no system keychain, so the sign-in is only kept until you close the app.'}
          </p>
          <button className="btn px-3 py-1.5" onClick={async () => { await window.obsLoader.github.disconnect(); await refresh() }}>Sign out</button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Sign in to create repositories on GitHub and clone yours from a list. Without it, you can still use any git address your own git setup can reach.
          </p>
          <ol className="text-sm list-decimal pl-5 space-y-1">
            <li>
              <button className="btn px-2 py-0.5" onClick={() => window.obsLoader.app.openExternal(window.obsLoader.github.tokenUrl)}>Open GitHub's token page</button>
              {' '}and press <strong>Generate token</strong> (the right permission is already ticked).
            </li>
            <li>Copy the token it shows and paste it here.</li>
          </ol>
          <div className="flex gap-2">
            <input className="input flex-1 px-2 py-1.5" type="password" autoComplete="off" placeholder="ghp_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub token" />
            <button className="btn btn-accent px-3" disabled={busy || !token.trim()} onClick={async () => {
              setBusy(true); setError(null)
              const r = await window.obsLoader.github.connect(token)
              setBusy(false)
              if (r.ok) { setToken(''); await refresh() } else setError(r.error)
            }}>{busy ? 'Checking…' : 'Sign in'}</button>
          </div>
          {error && <Message tone="bad">{error}</Message>}
        </>
      )}
    </Card>
  )
}

