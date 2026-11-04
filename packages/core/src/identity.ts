import { defaultGit, type GitIdentity, type GitRunner } from './repo.js'

/** Everyone who signed a save in this preset, and how many saves each has. */
export async function listAuthors(dir: string, git: GitRunner = defaultGit): Promise<(GitIdentity & { saves: number })[]> {
  const r = await git(['log', '--branches', '--tags', '--format=%an%x1f%ae'], dir)
  if (r.code !== 0) return []
  const counts = new Map<string, { name: string; email: string; saves: number }>()
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [name, email] = line.split('\x1f')
    const k = `${name}\x1f${email}`
    const hit = counts.get(k)
    if (hit) hit.saves++; else counts.set(k, { name, email, saves: 1 })
  }
  return [...counts.values()].sort((a, b) => b.saves - a.saves)
}

const BACKUP_REF = 'refs/obs-config-loader-backup/before-name-change'

export type RewriteResult = { ok: true; rewritten: number; changed: boolean } | { ok: false; message: string }

/**
 * Make every save in this preset (all branches, tags and the app's own bookkeeping refs) say it was made by `who`.
 * Nothing but the name and address changes: same files, same messages, same dates. Done with git's own plumbing, so it
 * works wherever git does. The old history is kept under a backup ref until `discardNameChangeBackup` removes it.
 * Online copies are NOT touched here: the caller has to send the new history (a forced upload).
 */
export async function rewriteAuthor(dir: string, who: GitIdentity, git: GitRunner = defaultGit): Promise<RewriteResult> {
  const name = who.name.trim(), email = who.email.trim()
  if (!name || !email) return { ok: false, message: 'Give both a name and an email address.' }
  if (/[<>\n]/.test(name) || /[<>\s]/.test(email)) return { ok: false, message: 'The name or address has characters that are not allowed.' }

  const refList = await git(['for-each-ref', '--format=%(refname) %(objecttype) %(objectname) %(*objectname)', 'refs/heads', 'refs/tags', 'refs/obs-config-loader/'], dir)
  if (refList.code !== 0) return { ok: false, message: refList.stderr.trim() || 'git could not list the saves.' }
  const refs = refList.stdout.split('\n').filter(Boolean).map((l) => {
    const [ref, type, obj, peeled] = l.split(' ')
    return { ref, tip: type === 'tag' ? peeled : obj }
  }).filter((r) => r.tip)
  if (!refs.length) return { ok: true, rewritten: 0, changed: false }

  // every commit reachable from those refs, parents before children
  const log = await git(['log', '--topo-order', '--reverse', '--date=raw', '--format=%H%x1f%T%x1f%P%x1f%ad%x1f%cd%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e', ...refs.map((r) => r.tip)], dir)
  if (log.code !== 0) return { ok: false, message: log.stderr.trim() || 'git could not read the saves.' }
  const rows = log.stdout.split('\x1e').map((x) => x.replace(/^\n/, '')).filter((x) => x.trim())
  const map = new Map<string, string>()
  let changed = false
  for (const row of rows) {
    const [hash, tree, parents, ad, cd, an, ae, cn, ce, ...rest] = row.split('\x1f')
    const message = rest.join('\x1f').replace(/\s+$/, '')
    if (an !== name || ae !== email || cn !== name || ce !== email) changed = true
    const ps = parents.split(' ').filter(Boolean).map((p) => map.get(p) ?? p)
    const args = ['commit-tree', tree, ...ps.flatMap((p) => ['-p', p]), '-m', message || 'Save']
    const c = await git(args, dir, { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: cd })
    if (c.code !== 0) return { ok: false, message: `git could not rewrite a save: ${c.stderr.trim()}` }
    map.set(hash, c.stdout.trim())
  }
  if (!changed) return { ok: true, rewritten: 0, changed: false }

  const head = (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], dir)).stdout.trim()
  if (head) await git(['update-ref', BACKUP_REF, head], dir)
  for (const r of refs) {
    const n = map.get(r.tip)
    if (!n) continue
    const u = await git(['update-ref', r.ref, n, r.tip], dir)
    if (u.code !== 0) return { ok: false, message: `git could not move ${r.ref}: ${u.stderr.trim()}` }
  }
  return { ok: true, rewritten: rows.length, changed: true }
}

/** After the new history is safe (here and online), forget the old one completely, so the old name is nowhere in this folder. */
export async function discardNameChangeBackup(dir: string, git: GitRunner = defaultGit): Promise<void> {
  await git(['update-ref', '-d', BACKUP_REF], dir)
  await git(['reflog', 'expire', '--expire=now', '--all'], dir)
  await git(['gc', '--prune=now', '-q'], dir)
}
