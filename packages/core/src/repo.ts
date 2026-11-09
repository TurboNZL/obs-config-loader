import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import type { Bundle, Manifest } from './types.js'
import type { Host, ObsInstall } from './detect.js'
import { exportBundle, deriveManifestFields, stripSecrets } from './export.js'
import { readBundleDir, serializeManifest, writeBundleDir, BundleError } from './bundleIO.js'
import { availableOn, isPlatformSpecific, DEFAULT_PLATFORM_MAP } from './sources.js'
import { unversioned } from './plugins.js'
import { applyVersions, type DetectedVersions } from './versions.js'
import { mergeProfileVariants } from './profilevariants.js'
import {
  cloudSkippedPaths, copyLocalOnly, isSkipped, localOnlyDiffs, mediaToCopy, pruneLocalMedia, readLocalKeys, readLocalSettings, storeLocalMedia, writeExclude, writeLocalKeys, writeLocalSettings, writeSharedSettings, SHARED_SETTINGS,
  localMediaLocations, localMediaPath, safeSegment, type LocalSettings, type SeenAsset,
} from './local.js'
import { extractVariants, parseVariants, serializeVariants, variantsPathFor } from './variants.js'

// ── git runner ───────────────────────────────────────────────────────────────

export interface GitResult { code: number; stdout: string; stderr: string }
/** `env` is added to git's environment for this one call (a sign-in header, who the saves are by). */
export type GitRunner = (args: string[], cwd: string, env?: Record<string, string>) => Promise<GitResult>

/** Runs the user's own git, never prompting (a prompt would hang a GUI). Credentials come from their git setup. */
export const defaultGit: GitRunner = (args, cwd, env) =>
  new Promise((resolve) => {
    execFile('git', args, {
      cwd, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GCM_INTERACTIVE: 'never', ...env },
    }, (err, stdout, stderr) => {
      const c = (err as { code?: unknown } | null)?.code
      const code = !err ? 0 : typeof c === 'number' ? c : 127 // a string code (ENOENT) means git itself could not run
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

export async function gitAvailable(git: GitRunner = defaultGit): Promise<boolean> {
  return (await git(['--version'], process.cwd())).code === 0
}

/** Who a save is by. Given to git through its environment for each call: nobody's git config is ever written. */
export interface GitIdentity { name: string; email: string }

/** A runner whose commits are by `who` (author and committer), whatever this computer's own git settings say. */
export function withIdentity(base: GitRunner, who: GitIdentity | undefined): GitRunner {
  if (!who?.name.trim() || !who.email.trim()) return base
  const e = { GIT_AUTHOR_NAME: who.name.trim(), GIT_AUTHOR_EMAIL: who.email.trim(), GIT_COMMITTER_NAME: who.name.trim(), GIT_COMMITTER_EMAIL: who.email.trim() }
  return (args, cwd, env) => base(args, cwd, { ...e, ...env })
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

/**
 * Two spellings of one folder: git prints `C:/Users/RUNNER~1/x` where Node has `C:\\Users\\runneradmin\\x`
 * (forward slashes, 8.3 short names, different case). Resolve both the way the OS does, then compare.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let r = nodePath.resolve(p)
    try { r = fs.realpathSync.native(r) } catch { /* not there: compare as written */ }
    r = r.replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

export async function repoStatus(dir: string, git: GitRunner = defaultGit): Promise<RepoStatus> {
  const empty: RepoStatus = { isRepo: false, ahead: 0, behind: 0, dirtyFiles: [], hasManifest: false, commits: 0 }
  if (!fs.existsSync(dir)) return empty
  const top = await git(['rev-parse', '--show-toplevel'], dir)
  // A folder inside some other repo is not "its own repo": require the folder to be the top level.
  if (top.code !== 0 || !samePath(top.stdout.trim(), dir)) return empty
  // independent questions asked together: starting git is the slow part on Windows
  const [st, count, remote] = await Promise.all([
    git(['--no-optional-locks', 'status', '--porcelain=v1', '-b', '--untracked-files=all'], dir), // read-only: never take the index lock, so a check can never collide with a save
    git(['rev-list', '--count', 'HEAD'], dir),
    git(['remote'], dir),
  ])
  const lines = st.stdout.split('\n').filter(Boolean)
  const head = lines.shift() ?? ''
  const m = /^## (?:No commits yet on |Initial commit on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head)
  const out: RepoStatus = {
    isRepo: true, branch: m?.[1], upstream: m?.[2], ahead: 0, behind: 0,
    dirtyFiles: lines.map((l) => l.slice(3).replace(/^"|"$/g, '')), hasManifest: false, commits: 0,
  }
  out.commits = Number(count.stdout.trim() || 0)
  const flags = m?.[3] ?? ''
  out.ahead = Number(/ahead (\d+)/.exec(flags)?.[1] ?? 0)
  out.behind = Number(/behind (\d+)/.exec(flags)?.[1] ?? 0)
  const remotes = remote.stdout.split('\n').filter(Boolean)
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
export type PullConflictChoice = 'abort' | 'keep-mine' | 'keep-theirs'

export async function pullRepo(dir: string, git: GitRunner = defaultGit, onConflict: PullConflictChoice = 'abort'): Promise<PullResult> {
  const st = await repoStatus(dir, git)
  if (!st.isRepo) return { status: 'error', message: 'This folder is not a git repository.' }
  if (!st.remote) return { status: 'no-remote' }
  if (st.dirtyFiles.length) return { status: 'dirty', files: st.dirtyFiles }
  const before = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim()
  const id = await identity(dir, git)
  // keep-mine / keep-theirs only decide the clashing lines; everything that merges cleanly merges either way
  const strategy = onConflict === 'keep-mine' ? ['-X', 'ours'] : onConflict === 'keep-theirs' ? ['-X', 'theirs'] : []
  let r = await git([...id, 'pull', '--no-rebase', '--no-edit', ...strategy], dir)
  // the online copy was started separately (no shared history): combine them anyway, as the person asked to get updates
  if (r.code !== 0 && /unrelated histories/i.test(r.stderr + r.stdout)) r = await git([...id, 'pull', '--no-rebase', '--no-edit', '--allow-unrelated-histories', ...strategy], dir)
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

/** Ask the online copy what is new (so "N to download" is true, not a guess from the last time). Never changes any file. */
export async function fetchRepo(dir: string, git: GitRunner = defaultGit): Promise<{ ok: boolean; message?: string }> {
  const st = await repoStatus(dir, git)
  if (!st.isRepo || !st.remote) return { ok: true }
  const r = await git(['fetch', '--quiet', st.remote], dir)
  return r.code === 0 ? { ok: true } : { ok: false, message: (r.stderr.trim() || r.stdout.trim() || 'Could not reach the online copy.').split('\n').slice(-2).join('\n') }
}

export type PushResult = { status: 'pushed' } | { status: 'nothing' } | { status: 'no-remote' } | { status: 'error'; message: string; rejected?: boolean }

/**
 * Send saves online. `force` replaces the online copy with this one (only if nobody has pushed since the last time we looked:
 * `--force-with-lease`), for when this computer's version is the right one and the online one is the stale one.
 */
export async function pushRepo(dir: string, git: GitRunner = defaultGit, opts: { force?: boolean } = {}): Promise<PushResult> {
  const st = await repoStatus(dir, git)
  if (!st.remote) return { status: 'no-remote' }
  if (st.upstream && st.ahead === 0 && !opts.force) return { status: 'nothing' }
  const lease = opts.force ? ['--force-with-lease'] : []
  const args = st.upstream ? ['push', ...lease] : ['push', ...lease, '-u', st.remote, 'HEAD']
  const r = await git(args, dir)
  if (r.code !== 0) {
    const message = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-3).join('\n')
    return { status: 'error', message, rejected: /rejected|non-fast-forward|fetch first|stale info/i.test(r.stderr + r.stdout) }
  }
  return { status: 'pushed' }
}

export interface OnlineComparison {
  ahead: number
  behind: number
  /** Newest save on this computer and online (ISO dates, with who/what), so a person can tell which is really newer. */
  mine?: { date: string; subject: string }
  theirs?: { date: string; subject: string; author: string }
  /** The two have no history in common (the online copy was started separately). */
  unrelated: boolean
}

/** After asking the online copy (`fetchRepo`): how this computer's version and the online one relate. */
export async function onlineComparison(dir: string, git: GitRunner = defaultGit): Promise<OnlineComparison | null> {
  const st = await repoStatus(dir, git)
  if (!st.remote || !st.upstream) return null
  const one = async (rev: string) => {
    const r = await git(['log', '-1', '--date=iso-strict', '--pretty=format:%ad%x1f%s%x1f%an', rev], dir)
    const [date, subject, author] = r.stdout.split('\x1f')
    return r.code === 0 && date ? { date, subject, author } : undefined
  }
  const base = await git(['merge-base', 'HEAD', st.upstream], dir)
  return { ahead: st.ahead, behind: st.behind, mine: await one('HEAD'), theirs: await one(st.upstream), unrelated: base.code !== 0 }
}

/**
 * Make this computer's copy exactly the online one. Nothing is lost: the version being replaced is kept on a branch named
 * `before-online-<time>` (still in History, and recoverable). Refuses when there are unsaved changes.
 */
export async function useOnlineVersion(dir: string, git: GitRunner = defaultGit): Promise<{ ok: true; kept: string } | { ok: false; message: string }> {
  const st = await repoStatus(dir, git)
  if (!st.remote || !st.upstream) return { ok: false, message: 'This preset is not backed up online yet.' }
  if (st.dirtyFiles.length) return { ok: false, message: 'This preset has changes that are not saved yet. Save them first.' }
  const kept = `before-online-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  await git(['branch', kept, 'HEAD'], dir)
  const r = await git(['reset', '--hard', st.upstream], dir)
  if (r.code !== 0) return { ok: false, message: (r.stderr.trim() || 'Could not switch to the online version.').split('\n').slice(-2).join('\n') }
  return { ok: true, kept }
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

type CaptureOptionsAsset = (a: { id: string; filename: string; path: string; size: number }) => void

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
  /** This computer's OBS and plugin versions, recorded in the setup (the newest ever saved is kept). */
  versions?: DetectedVersions
  /** Told where each file the scenes use really is on this computer, so the preset can remember it. */
  onAsset?: CaptureOptionsAsset
  /** See `ExportOptions.assetIdHints`: files renamed outside the app keep their id. */
  assetIdHints?: Record<string, string>
  /** What a brand-new preset leaves out. An existing preset's own list always wins. */
  exclude?: Manifest['exclude']
  /** When the repo and OBS changed the same lines: stop (default), or settle just those lines in favour of one side. */
  onConflict?: 'abort' | 'keep-repo' | 'keep-obs'
  /** With `dryRun`: also say what changed line by line. */
  withDiff?: boolean
  /** Also keep this computer's own part of the preset up to date (stream keys, copies of big files, parts not uploaded). Default yes. */
  keepLocal?: boolean
  /** Whether a preset that has not said otherwise keeps stream keys. Default yes. */
  keepKeysDefault?: boolean
  git?: GitRunner
}

/** One file that would change, for showing a preview. */
export interface ChangeDetail { file: string; status: 'added' | 'modified' | 'deleted'; added: number; removed: number; patch?: string; /** Only kept on this computer (not part of what is uploaded). */ local?: boolean }

export type CaptureResult =
  | { status: 'unchanged' }
  | { status: 'changes'; files: string[]; details?: ChangeDetail[]; localChanges?: string[] } // dry run only
  | { status: 'committed'; files: string[]; commit: string; merged: boolean; keys?: number; copied?: number }
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

/**
 * What the preset has that this OBS has not got yet: saves that came after the last time the preset was put into OBS or OBS was
 * saved into it (typically after "Get updates"). `null` when nobody has said yet, so nothing can be claimed.
 */
export async function pendingForObs(dir: string, install: ObsInstall, git: GitRunner = defaultGit, platform: Host['platform'] = install.platform): Promise<string[] | null> {
  const head = await revParse(dir, 'HEAD', git)
  const marked = await revParse(dir, syncRef(install), git)
  if (!head || !marked) return null
  if (marked === head) return []
  if ((await git(['merge-base', '--is-ancestor', marked, head], dir)).code !== 0) return null
  const r = await git(['diff', '--name-only', marked, head], dir)
  const skipped = cloudSkippedPaths(readLocalSettings(dir).cloud?.skip)
  const out: string[] = []
  for (const f of r.stdout.split('\n').filter(Boolean)) {
    if (f === SHARED_SETTINGS || isSkipped(f, skipped)) continue
    if (f === 'assets.lock.json') continue // a list of files; changes OBS itself does not get from applying
    // one file holds every system's version of a source or an encoder: another system's change does nothing to this OBS
    if (/(^|\/)([^/]+\.)?platforms\.json$/.test(f)) {
      const [a, b] = await Promise.all([marked, head].map(async (rev) => {
        const t = await git(['show', `${rev}:${f}`], dir)
        if (t.code !== 0) return undefined
        try {
          const j = JSON.parse(t.stdout) as Record<string, any>
          // profiles/<id>/platforms.json is { <system>: ... }; collections/<id>.platforms.json is { <source>: { <system>: ... } }
          if (f.startsWith('collections/')) return JSON.stringify(Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v?.[platform] ?? null])))
          return JSON.stringify(j[platform] ?? null)
        } catch { return t.stdout }
      }))
      if (a === b) continue
    }
    out.push(f)
  }
  return out
}

/** A commit that only changed how the preset is stored: what OBS last matched moves along with it, so OBS still counts as matching. */
async function moveSyncRefs(dir: string, from: string | null, git: GitRunner): Promise<void> {
  const to = await revParse(dir, 'HEAD', git)
  if (!from || !to || from === to) return
  const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/obs-config-loader/synced'], dir)).stdout.split('\n').filter(Boolean)
  for (const line of refs) { const [ref, sha] = line.split(' '); if (sha === from) await git(['update-ref', ref, to], dir) }
}

/** Call after the repo's content has been loaded into OBS: from now on live edits are measured from here. */
export async function markSynced(dir: string, install: ObsInstall, git: GitRunner = defaultGit): Promise<void> {
  const head = await revParse(dir, 'HEAD', git)
  if (head) await git(['update-ref', syncRef(install), head], dir)
}

/** Overlay the live OBS state onto a checkout of the repo (keeps ids, names, platform originals, unknown manifest fields). */
function writeLiveInto(o: CaptureOptions, target: string, excludeNow?: Manifest['exclude'], uploadMedia: string[] = []): { secrets: Record<string, string> } {
  let prev: Bundle | undefined
  try { prev = readBundleDir(target) } catch (e) {
    if (!(e instanceof BundleError && e.code === 'not-a-bundle')) throw e
  }
  const pm = prev?.manifest
  const bundle = exportBundle({
    host: o.host, install: o.install, name: pm?.name ?? o.name ?? 'OBS setup', id: pm?.id,
    description: typeof pm?.description === 'string' ? pm.description : undefined,
    // No name filter: OBS is the source of truth for which scenes/profiles exist. (Filtering by the names saved
    // earlier made a renamed collection or profile vanish, and the folder was then wiped.)
    bundleBelowBytes: o.bundleBelowBytes, alsoBundle: uploadMedia, appVersion: o.appVersion, versions: o.versions, exclude: excludeNow ?? pm?.exclude ?? o.exclude, onAsset: o.onAsset, assetIdHints: o.assetIdHints,
    // the stream keys are read here and kept apart: they go into the preset's own local-only area, never into what git tracks
    includeSecrets: true,
    // the repo's history is its revision list: keep these two still so they never cause a merge conflict
    revision: pm?.revision, now: pm?.exportedAt ? new Date(pm.exportedAt) : undefined,
  })
  const secrets = stripSecrets(bundle)
  // Never turn a working repo into an empty one because of a name mismatch or an odd OBS state.
  if (prev && (prev.manifest.collections.length && !bundle.manifest.collections.length
    || prev.manifest.profiles.length && !bundle.manifest.profiles.length)) {
    throw new Error('OBS shows no scene layouts or no output settings to save, so nothing was changed. Open OBS once and try again.')
  }
  if (prev) {
    mergeProfileVariants(bundle, prev, o.host.platform)
    for (const c of bundle.manifest.collections) {
      const old = prev.manifest.collections.find((x) => x.id === c.id)
      const oldRaw = old && prev.files.get(old.file)
      const raw = bundle.files.get(c.file)
      if (!oldRaw || !raw) continue
      try {
        const next = JSON.parse(raw.toString('utf8'))
        const oldJson = JSON.parse(oldRaw.toString('utf8'))
        // this OS's version of each capture source goes into the variants file; the other OSes' entries stay as they are
        const vf = variantsPathFor(c.file)
        const variants = extractVariants(next, o.host.platform, parseVariants(prev.files.get(vf)), oldJson)
        if (Object.keys(variants).length) bundle.files.set(vf, Buffer.from(serializeVariants(variants))); else bundle.files.delete(vf)
        if (preservePlatformSources(next, oldJson, o.host.platform)) {
          bundle.files.set(c.file, Buffer.from(JSON.stringify(next, null, 4) + '\n'))
        }
      } catch { /* leave as exported */ }
    }
    // a folder's suggested place is the first saver's, so two computers with different folders never rewrite it back and forth
    bundle.manifest.variables = bundle.manifest.variables.map((v) => {
      const old = prev.manifest.variables.find((x) => x.name === v.name)
      return old && old.default !== undefined ? { ...v, default: old.default } : v
    })
    const { collections: _c, profiles: _p, variables: _v, assets: _a, plugins: _pl, platformMap: _pm, ...rest } = prev.manifest
    void _c; void _p; void _v; void _a; void _pl; void _pm
    const merged = { ...rest, ...bundle.manifest, exportedAt: prev.manifest.exportedAt, revision: prev.manifest.revision } as Manifest
    // Same key order as the file already has, so an unchanged manifest is byte-identical and git sees no change.
    const ordered: Record<string, unknown> = {}
    for (const k of Object.keys(prev.manifest)) if (k in merged) ordered[k] = (merged as Record<string, unknown>)[k]
    for (const k of Object.keys(merged)) if (!(k in ordered)) ordered[k] = (merged as Record<string, unknown>)[k]
    bundle.manifest = ordered as Manifest
    if (prev.manifest.revision === undefined) delete (bundle.manifest as Partial<Manifest>).revision
    // who first saved it and with which app version are history, not state: freezing them keeps every machine's save identical
    if (prev.manifest.source) bundle.manifest.source = prev.manifest.source
    if (prev.manifest.generator) bundle.manifest.generator = prev.manifest.generator
  } else {
    delete (bundle.manifest as Partial<Manifest>).revision
    if (o.exclude && Object.values(o.exclude).some((v) => (Array.isArray(v) ? v.length : v))) bundle.manifest.exclude = o.exclude
  }
  deriveManifestFields(bundle) // from the final files (canonical + every platform's variants), not from this machine alone
  applyVersions(bundle.manifest, prev?.manifest, o.versions)

  // Files are placeholders in what git tracks (this computer's own copies are in `local/`), except the ones chosen to be uploaded.
  const up = new Set(uploadMedia)
  bundle.manifest.assets = bundle.manifest.assets.map((a) => (a.mode === 'bundled' && a.role !== 'script' && !up.has(a.id) ? { ...a, mode: 'external' as const } : a))
  writeBundleDir(bundle, target, { withMedia: false, mediaIds: uploadMedia })
  return { secrets }
}

/** What changed, file by file, in the staged changes of a checkout. */
async function describeStaged(wt: string, git: GitRunner): Promise<ChangeDetail[]> {
  const status = (await git(['diff', '--cached', '--name-status', '--no-renames'], wt)).stdout.split('\n').filter(Boolean)
  const num = new Map<string, [number, number]>()
  for (const l of (await git(['diff', '--cached', '--numstat', '--no-renames'], wt)).stdout.split('\n').filter(Boolean)) {
    const [a, r, ...f] = l.split('\t')
    num.set(f.join('\t'), [Number(a) || 0, Number(r) || 0])
  }
  const out: ChangeDetail[] = []
  for (const l of status) {
    const [st, ...f] = l.split('\t')
    const file = f.join('\t')
    const [added, removed] = num.get(file) ?? [0, 0]
    const d: ChangeDetail = { file, status: st === 'A' ? 'added' : st === 'D' ? 'deleted' : 'modified', added, removed }
    if (out.length < 30 && added + removed > 0) {
      const lines = (await git(['diff', '--cached', '--no-color', '-U2', '--no-renames', '--', file], wt)).stdout.split('\n')
      const body = lines.slice(lines.findIndex((x) => x.startsWith('@@')))
      d.patch = (body.length > 160 ? [...body.slice(0, 160), `… ${body.length - 160} more lines`] : body).join('\n')
    }
    out.push(d)
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * Save what is in OBS right now into the repo as a commit, merged with whatever the repo has gained since OBS last
 * matched it. This is what keeps edits made in OBS from being reverted by the next change to the repo (by hand, by
 * a pull, by an AI): live edits are committed on top of the commit OBS last matched, then merged (3-way) into HEAD.
 * A conflict is aborted and reported; nothing is left half-merged.
 */
export async function captureLive(o0: CaptureOptions): Promise<CaptureResult> {
  const git = o0.git ?? defaultGit
  const seen: SeenAsset[] = []
  const o: CaptureOptions = { ...o0, onAsset: (a) => { seen.push(a); o0.onAsset?.(a) } }
  // what stays on this computer: git is told first, so it never sees those parts (and `local/` is always out of its sight)
  const settings: LocalSettings = readLocalSettings(o.dir)
  const skipped = cloudSkippedPaths(settings.cloud?.skip)
  const before = settings.kept ?? []
  writeExclude(o.dir, skipped)
  const id = await identity(o.dir, git)
  // parts that are uploaded again from now on: they are on disk but were never tracked, so they are added as they are
  const released = before.filter((x) => !skipped.includes(x) && fs.existsSync(nodePath.join(o.dir, x)))
  if (released.length && !o.dryRun && (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], o.dir)).code === 0) {
    await git(['add', '-f', '--', ...released], o.dir)
    await git([...id, 'commit', '-q', '-m', 'Upload some parts again'], o.dir)
  }
  if (!o.dryRun && (before.length !== skipped.length || before.some((x) => !skipped.includes(x)))) writeLocalSettings(o.dir, { ...settings, kept: skipped })
  // the preset's own settings are saved inside it too (so GitHub and files carry them): one small commit when they changed
  if (!o.dryRun && (await revParse(o.dir, 'HEAD', git)) && writeSharedSettings(o.dir)) {
    const from = await revParse(o.dir, 'HEAD', git)
    await git(['add', '-f', '--', SHARED_SETTINGS], o.dir)
    if ((await git(['diff', '--cached', '--quiet'], o.dir)).code !== 0) { await git([...id, 'commit', '-q', '-m', 'Saved this preset\'s settings'], o.dir); await moveSyncRefs(o.dir, from, git) }
  }
  const st = await repoStatus(o.dir, git)
  if (!st.isRepo) return { status: 'error', message: 'This folder is not a git repository.' }
  const keepLocal = o.keepLocal !== false
  const uploadMedia = settings.cloud?.media ?? []
  if (st.dirtyFiles.length && !o.dryRun) {
    if (o.onDirty !== 'commit-first') return { status: 'dirty', files: st.dirtyFiles }
    await commitAll(o.dir, 'Changes made outside OBS Config Loader', git)
  }
  const { head, base } = await baseFor(o.dir, o.install, git)
  // What the preset leaves out is what it says NOW (its current files), not what it said at the commit OBS last matched.
  let excludeNow: Manifest['exclude'] | undefined
  try { excludeNow = readBundleDir(o.dir).manifest.exclude ?? {} } catch { /* first save: nothing yet */ }

  /** Keys, copies of big files, pruning: this computer's part of the preset. */
  const finishLocal = (secrets: Record<string, string>): { keys: number; copied: number } => {
    if (!keepLocal) return { keys: 0, copied: 0 }
    let keys = 0
    if ((settings.keepKeys ?? o.keepKeysDefault ?? true) && Object.keys(secrets).length) keys = writeLocalKeys(o.dir, secrets)
    const copied = storeLocalMedia(o.dir, seen, settings).length
    try { pruneLocalMedia(o.dir, readBundleDir(o.dir).manifest, settings) } catch { /* nothing to prune against yet */ }
    return { keys, copied }
  }
  /** What this computer's part would gain from a save. */
  const localChanges = (fresh: string | undefined, secrets: Record<string, string>): string[] => {
    if (!keepLocal) return []
    const out = fresh ? localOnlyDiffs(fresh, o.dir, skipped) : []
    if ((settings.keepKeys ?? o.keepKeysDefault ?? true)) {
      const had = readLocalKeys(o.dir)
      if (Object.entries(secrets).some(([k, v]) => had[k] !== v)) out.push('local/keys.json')
    }
    for (const a of mediaToCopy(o.dir, seen, settings)) out.push(`local/media/${a.id}/${a.filename}`)
    return out
  }

  try {
    // First capture into an empty repository: write straight into the working tree.
    if (!head || !base) {
      if (o.dryRun) return { status: 'changes', files: ['manifest.json'] }
      const { secrets } = writeLiveInto(o, o.dir, undefined, uploadMedia)
      const commit = await commitAll(o.dir, `Live edits from ${o.install.label}`, git)
      await markSynced(o.dir, o.install, git)
      const loc = finishLocal(secrets)
      return commit ? { status: 'committed', files: ['manifest.json'], commit, merged: false, ...loc } : { status: 'unchanged' }
    }

    // Everything else happens in a scratch checkout of the base commit.
    const wt = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-live-'))
    try {
      const add = await git(['worktree', 'add', '--detach', wt, base], o.dir)
      if (add.code !== 0) return { status: 'error', message: `Could not prepare a scratch checkout: ${add.stderr.trim()}` }
      // parts that stay on this computer may still be in older saves: stop tracking them here, so the live commit and HEAD agree
      if (skipped.length) {
        await git(['rm', '-rfq', '--ignore-unmatch', '--', ...skipped.map((x) => x.replace(/\/$/, ''))], wt)
        if ((await git(['diff', '--cached', '--quiet'], wt)).code !== 0) await git([...id, 'commit', '-q', '-m', 'Keep some parts on this computer'], wt)
      }
      const { secrets } = writeLiveInto(o, wt, excludeNow, uploadMedia)
      await git(['add', '-A'], wt)
      const files = (await git(['diff', '--cached', '--name-only'], wt)).stdout.split('\n').filter(Boolean).sort()
      const local = localChanges(wt, secrets)
      // stopping the upload of a part is a commit of its own in the scratch checkout; it has to reach the preset too
      const stopped = skipped.length > 0 && (await git(['rev-parse', 'HEAD'], wt)).stdout.trim() !== base
      // This computer's own copies of the big files are housekeeping, refreshed with the next real save. They are never a reason
      // to tell anyone that OBS "has changes" (that made the preset ask for attention over a file nobody had edited).
      const shown = local.filter((f) => !f.startsWith('local/media/'))
      if (o.dryRun ? !files.length && !shown.length : !files.length && !local.length && !stopped) return { status: 'unchanged' }
      if (o.dryRun) {
        let details: ChangeDetail[] | undefined
        if (o.withDiff) details = [...(await describeStaged(wt, git)), ...shown.map((f): ChangeDetail => ({ file: f, status: 'modified', added: 0, removed: 0, local: true }))]
        return { status: 'changes', files: [...files, ...shown], ...(details ? { details } : {}), ...(shown.length ? { localChanges: shown } : {}) }
      }

      if (!files.length && !stopped) {
        // nothing git tracks changed: only this computer's own part did
        copyLocalOnly(wt, o.dir, skipped)
        const loc = finishLocal(secrets)
        return { status: 'committed', files: local, commit: (await git(['rev-parse', '--short', 'HEAD'], o.dir)).stdout.trim(), merged: false, ...loc }
      }
      if (files.length) {
        const c = await git([...id, 'commit', '-m', `Live edits from ${o.install.label}`], wt)
        if (c.code !== 0) return { status: 'error', message: `git commit failed: ${c.stderr.trim() || c.stdout.trim()}` }
      }
      const live = (await git(['rev-parse', 'HEAD'], wt)).stdout.trim()

      const merged = head !== base
      const strategy = o.onConflict === 'keep-repo' ? ['-X', 'ours'] : o.onConflict === 'keep-obs' ? ['-X', 'theirs'] : []
      const m = merged
        ? await git([...id, 'merge', '--no-edit', ...strategy, '-m', `Merge live OBS edits from ${o.install.label}`, live], o.dir)
        : await git([...id, 'merge', '--ff-only', live], o.dir)
      if (m.code !== 0) {
        const conflicts = (await git(['diff', '--name-only', '--diff-filter=U'], o.dir)).stdout.split('\n').filter(Boolean)
        await git(['merge', '--abort'], o.dir)
        if (conflicts.length) return { status: 'conflict', conflicts }
        return { status: 'error', message: (m.stderr.trim() || m.stdout.trim()).split('\n').slice(-3).join('\n') }
      }
      await git(['update-ref', syncRef(o.install), live], o.dir)
      copyLocalOnly(wt, o.dir, skipped)
      const loc = finishLocal(secrets)
      return { status: 'committed', files: [...files, ...local], commit: (await git(['rev-parse', '--short', 'HEAD'], o.dir)).stdout.trim(), merged, ...loc }
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

export interface RenamedAsset { id: string; /** The name the preset knows. */ filename: string; /** Where this computer last had it. */ from: string; /** Where the same file is now. */ to: string }

/**
 * Files that were renamed outside the app. A file this computer used to have is gone from where it was; if the same folder holds a
 * file with the same size and the same contents, it is that file under a new name. Only a clear single match counts.
 */
export async function findRenamedAssets(manifest: Manifest, locations: AssetLocations, missingInObs: string[] = []): Promise<RenamedAsset[]> {
  const out: RenamedAsset[] = []
  const base = (p: string) => p.split(/[\\/]/).pop()!.toLowerCase()
  for (const a of manifest.assets) {
    if (!a.sha256 || !a.size) continue
    // where the file used to be: what this computer remembered, and the paths OBS's own scenes use that are not there any more
    const froms = [...new Set([locations[a.id], ...missingInObs.filter((p) => base(p) === a.filename.toLowerCase())].filter((p): p is string => !!p && !fs.existsSync(p)))]
    for (const from of froms) {
      const dir = nodePath.dirname(from)
      let names: string[] = []
      try { names = fs.readdirSync(dir) } catch { continue }
      const hits: string[] = []
      for (const n of names) {
        const full = nodePath.join(dir, n)
        try {
          const st = fs.statSync(full)
          if (!st.isFile() || st.size !== a.size) continue
          if ((await sha256File(full)) === a.sha256) hits.push(full)
        } catch { /* unreadable: not a candidate */ }
      }
      if (hits.length === 1) { out.push({ id: a.id, filename: a.filename, from, to: hits[0] }); break }
    }
  }
  return out
}

/**
 * Files a setup brought with it are put in `<OBS settings folder>/obs-config-loader/<setup id>/media/<asset id>/<name>` when it is
 * loaded, and the scenes point there. A preset made from that file has no copy of them (git never holds media), but they are
 * on this computer: find them, so they are not asked for.
 */
export function locateExtracted(manifest: Manifest, configDirs: string[]): AssetLocations {
  const found: AssetLocations = {}
  for (const a of manifest.assets) {
    for (const dir of configDirs) {
      const p = nodePath.join(dir, 'obs-config-loader', manifest.id, 'media', a.id, a.filename)
      if (fs.existsSync(p)) { found[a.id] = p; break }
    }
  }
  return found
}

/** GitHub refuses files over 100 MB. */
export const MAX_UPLOAD_FILE = 95 * 1024 * 1024

/**
 * Make the preset match the person's upload choices right now (without needing OBS): stop tracking parts that stay on this
 * computer, start tracking parts that are uploaded again, and put the chosen files in (or take them out). One commit; the files
 * on disk are never deleted, apart from the copies of files that are no longer uploaded.
 */
export async function applyCloudSettings(dir: string, git: GitRunner = defaultGit, locations: Record<string, string> = {}): Promise<{ ok: true; changed: boolean } | { ok: false; message: string }> {
  try {
    const settings = readLocalSettings(dir)
    const skipped = cloudSkippedPaths(settings.cloud?.skip)
    const before = settings.kept ?? []
    writeExclude(dir, skipped)
    const head = await revParse(dir, 'HEAD', git)
    if (!head) return { ok: true, changed: false }
    writeSharedSettings(dir)
    const id = await identity(dir, git)

    // parts that stay here: no longer tracked
    const tracked = skipped.length ? (await git(['ls-files', '--', ...skipped.map((x) => x.replace(/\/$/, ''))], dir)).stdout.split('\n').filter(Boolean) : []
    if (tracked.length) await git(['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', ...skipped.map((x) => x.replace(/\/$/, ''))], dir)
    // parts uploaded again
    const released = before.filter((x) => !skipped.includes(x) && fs.existsSync(nodePath.join(dir, x)))
    if (released.length) await git(['add', '-f', '--', ...released], dir)

    // files that are uploaded: copied in from the preset's own copies
    const b = readBundleDir(dir, { keepMissing: true })
    const m = b.manifest
    const own = localMediaLocations(dir, m)
    const wanted = new Set(settings.cloud?.media ?? [])
    let manifestChanged = false
    for (const a of m.assets) {
      if (a.role === 'script' || !safeSegment(a.id) || !safeSegment(a.filename)) continue
      const dest = nodePath.join(dir, 'media', a.id, a.filename)
      if (wanted.has(a.id)) {
        const src = [own[a.id], locations[a.id]].find((x) => x && fs.existsSync(x))
        if (!src) { if (a.mode !== 'bundled') return { ok: false, message: `“${a.filename}” is not on this computer, so it cannot be uploaded. Find it first.` } ; continue }
        if (fs.statSync(src).size > MAX_UPLOAD_FILE) return { ok: false, message: `“${a.filename}” is bigger than 95 MB. GitHub refuses files over 100 MB, so it cannot be uploaded.` }
        if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) { fs.mkdirSync(nodePath.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest) }
        if (a.mode !== 'bundled') { a.mode = 'bundled'; manifestChanged = true }
      } else if (a.mode === 'bundled' || fs.existsSync(dest)) {
        // no longer uploaded: its copy in the preset's own area is kept first, so nothing is lost
        if (fs.existsSync(dest) && !fs.existsSync(localMediaPath(dir, a.id, a.filename))) {
          fs.mkdirSync(nodePath.dirname(localMediaPath(dir, a.id, a.filename)), { recursive: true })
          fs.copyFileSync(dest, localMediaPath(dir, a.id, a.filename))
        }
        fs.rmSync(nodePath.join(dir, 'media', a.id), { recursive: true, force: true })
        if (a.mode === 'bundled') { a.mode = 'external'; manifestChanged = true }
      }
    }
    if (manifestChanged) {
      fs.writeFileSync(nodePath.join(dir, 'manifest.json'), serializeManifest(m))
      const lock = Object.fromEntries(m.assets.map((a) => [a.id, { filename: a.filename, mode: a.mode, sha256: a.sha256, size: a.size, hint: a.hint }]))
      fs.writeFileSync(nodePath.join(dir, 'assets.lock.json'), JSON.stringify(lock, null, 2) + '\n')
    }
    // only paths that exist: git refuses the whole `add` over one that does not
    const toAdd = ['manifest.json', 'assets.lock.json', 'media', SHARED_SETTINGS].filter((x) => fs.existsSync(nodePath.join(dir, x)))
    await git(['add', '-A', '--', ...toAdd], dir)
    let changed = false
    if ((await git(['diff', '--cached', '--quiet'], dir)).code !== 0) {
      const c = await git([...id, 'commit', '-q', '-m', 'Changed what is uploaded'], dir)
      if (c.code !== 0) return { ok: false, message: c.stderr.trim() || c.stdout.trim() }
      changed = true
      // OBS is exactly as far along as before: this only changed how the preset is stored, so what OBS last matched moves with it
      await moveSyncRefs(dir, head, git)
    }
    writeLocalSettings(dir, { ...readLocalSettings(dir), kept: skipped })
    return { ok: true, changed }
  } catch (e) { return { ok: false, message: (e as Error).message } }
}

export { serializeManifest }
