import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import type { Bundle, Manifest } from './types.js'
import type { Host, ObsInstall } from './detect.js'
import { exportBundle } from './export.js'
import { readBundleDir, serializeManifest, writeBundleDir, BundleError } from './bundleIO.js'
import { availableOn, isPlatformSpecific, DEFAULT_PLATFORM_MAP } from './sources.js'
import { unversioned } from './plugins.js'

// ── git runner ───────────────────────────────────────────────────────────────

export interface GitResult { code: number; stdout: string; stderr: string }
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>

/** Runs the user's own git, never prompting (a prompt would hang a GUI). Credentials come from their git setup. */
export const defaultGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, {
      cwd, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GCM_INTERACTIVE: 'never' },
    }, (err, stdout, stderr) => {
      const c = (err as { code?: unknown } | null)?.code
      const code = !err ? 0 : typeof c === 'number' ? c : 127 // a string code (ENOENT) means git itself could not run
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

export async function gitAvailable(git: GitRunner = defaultGit): Promise<boolean> {
  return (await git(['--version'], process.cwd())).code === 0
}

/** Identity flags, only when the user has none configured (their own git config is never touched). */
async function identity(dir: string, git: GitRunner): Promise<string[]> {
  const email = (await git(['config', 'user.email'], dir)).stdout.trim()
  const name = (await git(['config', 'user.name'], dir)).stdout.trim()
  return [...(name ? [] : ['-c', 'user.name=OBS Config Loader']), ...(email ? [] : ['-c', 'user.email=obs-config-loader@localhost'])]
}

// ── status ───────────────────────────────────────────────────────────────────

export interface RepoStatus {
  isRepo: boolean
  branch?: string
  remote?: string
  upstream?: string
  ahead: number
  behind: number
  /** Files with uncommitted changes (relative paths). */
  dirtyFiles: string[]
  hasManifest: boolean
  manifest?: { id: string; name: string }
  /** Number of commits (the repo's revision count). */
  commits: number
}

export async function repoStatus(dir: string, git: GitRunner = defaultGit): Promise<RepoStatus> {
  const empty: RepoStatus = { isRepo: false, ahead: 0, behind: 0, dirtyFiles: [], hasManifest: false, commits: 0 }
  if (!fs.existsSync(dir)) return empty
  const top = await git(['rev-parse', '--show-toplevel'], dir)
  // A folder inside some other repo is not "its own repo": require the folder to be the top level.
  if (top.code !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(nodePath.resolve(dir))) return empty
  const st = await git(['status', '--porcelain=v1', '-b', '--untracked-files=all'], dir)
  const lines = st.stdout.split('\n').filter(Boolean)
  const head = lines.shift() ?? ''
  const m = /^## (?:No commits yet on |Initial commit on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head)
  const out: RepoStatus = {
    isRepo: true, branch: m?.[1], upstream: m?.[2], ahead: 0, behind: 0,
    dirtyFiles: lines.map((l) => l.slice(3).replace(/^"|"$/g, '')), hasManifest: false, commits: 0,
  }
  out.commits = Number((await git(['rev-list', '--count', 'HEAD'], dir)).stdout.trim() || 0)
  const flags = m?.[3] ?? ''
  out.ahead = Number(/ahead (\d+)/.exec(flags)?.[1] ?? 0)
  out.behind = Number(/behind (\d+)/.exec(flags)?.[1] ?? 0)
  const remotes = (await git(['remote'], dir)).stdout.split('\n').filter(Boolean)
  out.remote = remotes[0]
  const mp = nodePath.join(dir, 'manifest.json')
  if (fs.existsSync(mp)) {
    out.hasManifest = true
    try {
      const j = JSON.parse(fs.readFileSync(mp, 'utf8'))
      out.manifest = { id: String(j.id), name: String(j.name) }
    } catch { /* shown as "manifest unreadable" by the caller */ }
  }
  return out
}

export interface LogEntry { hash: string; subject: string; date: string; author: string }

export async function repoLog(dir: string, n = 20, git: GitRunner = defaultGit): Promise<LogEntry[]> {
  const r = await git(['log', `-n${n}`, '--date=iso-strict', '--pretty=format:%h%x1f%s%x1f%ad%x1f%an'], dir)
  if (r.code !== 0) return []
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [hash, subject, date, author] = l.split('\x1f')
    return { hash, subject, date, author }
  })
}

// ── basic operations ─────────────────────────────────────────────────────────

export async function initRepo(dir: string, git: GitRunner = defaultGit): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  const r = await git(['init'], dir)
  if (r.code !== 0) throw new Error(`git init failed: ${r.stderr.trim()}`)
  // Releases and docs key off "main"; set it before the first commit whatever the user's default is.
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir)
}

export async function cloneRepo(url: string, dir: string, git: GitRunner = defaultGit): Promise<void> {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('That folder is not empty.')
  fs.mkdirSync(dir, { recursive: true })
  const r = await git(['clone', '--', url, '.'], dir)
  if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim() || r.stdout.trim()}`)
}

export async function commitAll(dir: string, message: string, git: GitRunner = defaultGit): Promise<string | null> {
  await git(['add', '-A'], dir)
  const staged = await git(['diff', '--cached', '--quiet'], dir)
  if (staged.code === 0) return null // nothing to commit
  const id = await identity(dir, git)
  const r = await git([...id, 'commit', '-m', message], dir)
  if (r.code !== 0) throw new Error(`git commit failed: ${r.stderr.trim() || r.stdout.trim()}`)
  return (await git(['rev-parse', '--short', 'HEAD'], dir)).stdout.trim()
}

export type PullResult =
  | { status: 'up-to-date' }
  | { status: 'updated'; files: string[] }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'dirty'; files: string[] }
  | { status: 'no-remote' }
  | { status: 'error'; message: string }

/** Merge what the remote has. A conflict is aborted cleanly (nothing half-merged is left) and reported. */
export async function pullRepo(dir: string, git: GitRunner = defaultGit): Promise<PullResult> {
  const st = await repoStatus(dir, git)
  if (!st.isRepo) return { status: 'error', message: 'This folder is not a git repository.' }
  if (!st.remote) return { status: 'no-remote' }
  if (st.dirtyFiles.length) return { status: 'dirty', files: st.dirtyFiles }
  const before = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim()
  const id = await identity(dir, git)
  const r = await git([...id, 'pull', '--no-rebase', '--no-edit'], dir)
  if (r.code !== 0) {
    const unmerged = (await git(['diff', '--name-only', '--diff-filter=U'], dir)).stdout.split('\n').filter(Boolean)
    if (unmerged.length) {
      await git(['merge', '--abort'], dir)
      return { status: 'conflict', conflicts: unmerged }
    }
    return { status: 'error', message: (r.stderr.trim() || r.stdout.trim() || 'git pull failed').split('\n').slice(-3).join('\n') }
  }
  const after = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim()
  if (before === after) return { status: 'up-to-date' }
  const files = (await git(['diff', '--name-only', before, after], dir)).stdout.split('\n').filter(Boolean)
  return { status: 'updated', files }
}

export type PushResult = { status: 'pushed' } | { status: 'nothing' } | { status: 'no-remote' } | { status: 'error'; message: string }

export async function pushRepo(dir: string, git: GitRunner = defaultGit): Promise<PushResult> {
  const st = await repoStatus(dir, git)
  if (!st.remote) return { status: 'no-remote' }
  if (st.upstream && st.ahead === 0) return { status: 'nothing' }
  const args = st.upstream ? ['push'] : ['push', '-u', st.remote, 'HEAD']
  const r = await git(args, dir)
  if (r.code !== 0) return { status: 'error', message: (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-3).join('\n') }
  return { status: 'pushed' }
}

// ── live capture ─────────────────────────────────────────────────────────────

/**
 * When the same source exists in the repo with a platform-specific id this machine cannot run (a Windows
 * `window_capture` captured on Linux), the live copy is the *substituted* one made on import. Keep the repo's
 * original, or every capture on another OS would rewrite it and the setups would fight forever.
 */
export function preservePlatformSources(next: any, prev: any, platform: Host['platform']): number {
  if (!next?.sources || !prev?.sources) return 0
  let kept = 0
  const prevByName = new Map<string, any>((prev.sources as any[]).map((s) => [s.name, s]))
  next.sources = (next.sources as any[]).map((s) => {
    const old = prevByName.get(s.name)
    if (!old) return s
    const oldId: string = old.id
    const key = isPlatformSpecific(oldId) ? oldId : unversioned(oldId)
    if (!isPlatformSpecific(key) || availableOn(key, platform)) return s
    // Only when the live one is a stand-in for it. Anything else is the user's own change: keep that.
    const entry = DEFAULT_PLATFORM_MAP.find((e) => e.from === key)
    if (!entry || !Object.values(entry.to).includes(s.id)) return s
    kept++
    return old
  })
  return kept
}

export interface CaptureOptions {
  host: Host
  install: ObsInstall
  dir: string
  /** Name for a brand-new repo; an existing manifest's name always wins. */
  name?: string
  /** `refuse` (default) stops when the repo has uncommitted changes; `commit-first` commits them as their own commit. */
  onDirty?: 'refuse' | 'commit-first'
  /** Only compute what would change. */
  dryRun?: boolean
  bundleBelowBytes?: number
  appVersion?: string
  git?: GitRunner
}

export type CaptureResult =
  | { status: 'unchanged' }
  | { status: 'changes'; files: string[] } // dry run only
  | { status: 'committed'; files: string[]; commit: string; merged: boolean }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'dirty'; files: string[] }
  | { status: 'error'; message: string }

/** Per-install bookmark: the commit OBS last matched. Local to this clone (refs under refs/obs-config-loader are not pushed). */
function syncRef(install: ObsInstall): string {
  return `refs/obs-config-loader/synced/${crypto.createHash('sha1').update(install.id).digest('hex').slice(0, 12)}`
}

async function revParse(dir: string, rev: string, git: GitRunner): Promise<string | null> {
  const r = await git(['rev-parse', '--verify', '--quiet', rev], dir)
  return r.code === 0 ? r.stdout.trim() : null
}

/** The commit live edits are measured against: what OBS last matched, if that is still part of this history. */
async function baseFor(dir: string, install: ObsInstall, git: GitRunner): Promise<{ head: string | null; base: string | null }> {
  const head = await revParse(dir, 'HEAD', git)
  if (!head) return { head: null, base: null }
  const marked = await revParse(dir, syncRef(install), git)
  if (marked && (await git(['merge-base', '--is-ancestor', marked, head], dir)).code === 0) return { head, base: marked }
  return { head, base: head }
}

/** Call after the repo's content has been loaded into OBS: from now on live edits are measured from here. */
export async function markSynced(dir: string, install: ObsInstall, git: GitRunner = defaultGit): Promise<void> {
  const head = await revParse(dir, 'HEAD', git)
  if (head) await git(['update-ref', syncRef(install), head], dir)
}

/** Overlay the live OBS state onto a checkout of the repo (keeps ids, names, platform originals, unknown manifest fields). */
function writeLiveInto(o: CaptureOptions, target: string): void {
  let prev: Bundle | undefined
  try { prev = readBundleDir(target) } catch (e) {
    if (!(e instanceof BundleError && e.code === 'not-a-bundle')) throw e
  }
  const pm = prev?.manifest
  const bundle = exportBundle({
    host: o.host, install: o.install, name: pm?.name ?? o.name ?? 'OBS setup', id: pm?.id,
    description: typeof pm?.description === 'string' ? pm.description : undefined,
    collections: pm?.collections.map((c) => c.name), profiles: pm?.profiles.map((p) => p.name),
    bundleBelowBytes: o.bundleBelowBytes, appVersion: o.appVersion,
    // the repo's history is its revision list: keep these two still so they never cause a merge conflict
    revision: pm?.revision, now: pm?.exportedAt ? new Date(pm.exportedAt) : undefined,
  })
  if (prev) {
    for (const c of bundle.manifest.collections) {
      const old = prev.manifest.collections.find((x) => x.id === c.id)
      const oldRaw = old && prev.files.get(old.file)
      const raw = bundle.files.get(c.file)
      if (!oldRaw || !raw) continue
      try {
        const next = JSON.parse(raw.toString('utf8'))
        if (preservePlatformSources(next, JSON.parse(oldRaw.toString('utf8')), o.host.platform)) {
          bundle.files.set(c.file, Buffer.from(JSON.stringify(next, null, 4) + '\n'))
        }
      } catch { /* leave as exported */ }
    }
    const { collections: _c, profiles: _p, variables: _v, assets: _a, plugins: _pl, platformMap: _pm, ...rest } = prev.manifest
    void _c; void _p; void _v; void _a; void _pl; void _pm
    const merged = { ...rest, ...bundle.manifest, exportedAt: prev.manifest.exportedAt, revision: prev.manifest.revision } as Manifest
    // Same key order as the file already has, so an unchanged manifest is byte-identical and git sees no change.
    const ordered: Record<string, unknown> = {}
    for (const k of Object.keys(prev.manifest)) if (k in merged) ordered[k] = (merged as Record<string, unknown>)[k]
    for (const k of Object.keys(merged)) if (!(k in ordered)) ordered[k] = (merged as Record<string, unknown>)[k]
    bundle.manifest = ordered as Manifest
    if (prev.manifest.revision === undefined) delete (bundle.manifest as Partial<Manifest>).revision
  } else {
    delete (bundle.manifest as Partial<Manifest>).revision
  }
  // A repo never holds the media themselves, so every asset is a placeholder there (writeBundleDir records it so).
  bundle.manifest.assets = bundle.manifest.assets.map((a) => (a.mode === 'bundled' ? { ...a, mode: 'external' as const } : a))
  writeBundleDir(bundle, target, { withMedia: false })
}

/**
 * Save what is in OBS right now into the repo as a commit, merged with whatever the repo has gained since OBS last
 * matched it. This is what keeps edits made in OBS from being reverted by the next change to the repo (by hand, by
 * a pull, by an AI): live edits are committed on top of the commit OBS last matched, then merged (3-way) into HEAD.
 * A conflict is aborted and reported; nothing is left half-merged.
 */
export async function captureLive(o: CaptureOptions): Promise<CaptureResult> {
  const git = o.git ?? defaultGit
  const st = await repoStatus(o.dir, git)
  if (!st.isRepo) return { status: 'error', message: 'This folder is not a git repository.' }
  if (st.dirtyFiles.length && !o.dryRun) {
    if (o.onDirty !== 'commit-first') return { status: 'dirty', files: st.dirtyFiles }
    await commitAll(o.dir, 'Changes made outside OBS Config Loader', git)
  }
  const { head, base } = await baseFor(o.dir, o.install, git)
  const id = await identity(o.dir, git)

  try {
    // First capture into an empty repository: write straight into the working tree.
    if (!head || !base) {
      if (o.dryRun) return { status: 'changes', files: ['manifest.json'] }
      writeLiveInto(o, o.dir)
      const commit = await commitAll(o.dir, `Live edits from ${o.install.label}`, git)
      await markSynced(o.dir, o.install, git)
      return commit ? { status: 'committed', files: ['manifest.json'], commit, merged: false } : { status: 'unchanged' }
    }

    // Everything else happens in a scratch checkout of the base commit.
    const wt = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-live-'))
    try {
      const add = await git(['worktree', 'add', '--detach', wt, base], o.dir)
      if (add.code !== 0) return { status: 'error', message: `Could not prepare a scratch checkout: ${add.stderr.trim()}` }
      writeLiveInto(o, wt)
      await git(['add', '-A'], wt)
      const files = (await git(['diff', '--cached', '--name-only'], wt)).stdout.split('\n').filter(Boolean).sort()
      if (!files.length) return { status: 'unchanged' }
      if (o.dryRun) return { status: 'changes', files }

      const c = await git([...id, 'commit', '-m', `Live edits from ${o.install.label}`], wt)
      if (c.code !== 0) return { status: 'error', message: `git commit failed: ${c.stderr.trim() || c.stdout.trim()}` }
      const live = (await git(['rev-parse', 'HEAD'], wt)).stdout.trim()

      const merged = head !== base
      const m = merged
        ? await git([...id, 'merge', '--no-edit', '-m', `Merge live OBS edits from ${o.install.label}`, live], o.dir)
        : await git([...id, 'merge', '--ff-only', live], o.dir)
      if (m.code !== 0) {
        const conflicts = (await git(['diff', '--name-only', '--diff-filter=U'], o.dir)).stdout.split('\n').filter(Boolean)
        await git(['merge', '--abort'], o.dir)
        if (conflicts.length) return { status: 'conflict', conflicts }
        return { status: 'error', message: (m.stderr.trim() || m.stdout.trim()).split('\n').slice(-3).join('\n') }
      }
      await git(['update-ref', syncRef(o.install), live], o.dir)
      return { status: 'committed', files, commit: (await git(['rev-parse', '--short', 'HEAD'], o.dir)).stdout.trim(), merged }
    } finally {
      await git(['worktree', 'remove', '--force', wt], o.dir)
      await git(['worktree', 'prune'], o.dir)
      fs.rmSync(wt, { recursive: true, force: true })
    }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
}

// ── placeholders for big files ───────────────────────────────────────────────

/** Where this machine keeps each external asset of a repo. Lives outside the repo (it is machine-specific). */
export type AssetLocations = Record<string, string>

export interface AssetNeed {
  id: string
  filename: string
  hint?: string
  /** `missing`: no file chosen (or it vanished). `changed`: the file differs from the one the repo expects. */
  reason: 'missing' | 'changed'
  path?: string
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

/** What the repo asks for that this machine does not have yet (or has a different version of). */
export async function assetNeeds(manifest: Manifest, locations: AssetLocations): Promise<AssetNeed[]> {
  const out: AssetNeed[] = []
  for (const a of manifest.assets) {
    if (a.mode !== 'external') continue
    const p = locations[a.id]
    if (!p || !fs.existsSync(p)) { out.push({ id: a.id, filename: a.filename, hint: a.hint, reason: 'missing' }); continue }
    if (a.sha256) {
      try {
        if ((await sha256File(p)) !== a.sha256) out.push({ id: a.id, filename: a.filename, hint: a.hint, reason: 'changed', path: p })
      } catch { out.push({ id: a.id, filename: a.filename, hint: a.hint, reason: 'missing' }) }
    }
  }
  return out
}

export { serializeManifest }
