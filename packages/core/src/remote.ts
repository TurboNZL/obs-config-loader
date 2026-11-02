import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { execFile } from 'node:child_process'
import { defaultGit, commitAll, initRepo, repoStatus, pushRepo, type GitRunner, type PushResult } from './repo.js'
import { writeBundleDir } from './bundleIO.js'
import type { Bundle } from './types.js'

// ── remotes ──────────────────────────────────────────────────────────────────

/** What a user may paste as "the address of my repository". Anything else is refused before git sees it. */
export function validateRemoteUrl(url: string): { ok: true; url: string } | { ok: false; message: string } {
  const u = url.trim()
  if (!u) return { ok: false, message: 'Enter the address of the repository.' }
  if (/\s/.test(u)) return { ok: false, message: 'The address must not contain spaces.' }
  if (u.startsWith('-')) return { ok: false, message: 'That is not a repository address.' }
  if (/^https?:\/\/[^/]+\/.+/.test(u)) return { ok: true, url: u }
  if (/^ssh:\/\/[^/]+\/.+/.test(u)) return { ok: true, url: u }
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(u)) return { ok: true, url: u } // git@github.com:you/repo.git
  if (/^file:\/\//.test(u) || nodePath.isAbsolute(u)) return { ok: true, url: u } // a folder on this computer or a network share
  return { ok: false, message: 'Use an address like https://github.com/you/my-setup.git' }
}

/** Last path segment of an address, as a folder name suggestion: `https://x/y/my-setup.git` -> `my-setup`. */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '') || 'obs-setup'
}

export async function getRemoteUrl(dir: string, git: GitRunner = defaultGit): Promise<string | undefined> {
  const r = await git(['remote', 'get-url', 'origin'], dir)
  return r.code === 0 ? r.stdout.trim() : undefined
}

/** Adds `origin`, or changes its address. */
export async function setRemote(dir: string, url: string, git: GitRunner = defaultGit): Promise<{ ok: true } | { ok: false; message: string }> {
  const v = validateRemoteUrl(url)
  if (!v.ok) return v
  const has = (await git(['remote'], dir)).stdout.split('\n').includes('origin')
  const r = await git(has ? ['remote', 'set-url', 'origin', v.url] : ['remote', 'add', 'origin', v.url], dir)
  return r.code === 0 ? { ok: true } : { ok: false, message: r.stderr.trim() || 'git could not set the address.' }
}

// ── credentials ──────────────────────────────────────────────────────────────

/**
 * A git runner that signs in to github.com with a personal access token, without writing it anywhere: the
 * header goes in through git's environment (GIT_CONFIG_*), so it is not in the command line, in .git/config,
 * or in a credential helper. Scoped to https://github.com/ only. Other hosts use the user's own git setup.
 */
export function githubAuthGit(token: string | undefined, base: GitRunner = defaultGit): GitRunner {
  if (!token) return base
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return (args, cwd) => new Promise((resolve) => {
    execFile('git', args, {
      cwd, maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GCM_INTERACTIVE: 'never',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      },
    }, (err, stdout, stderr) => {
      const c = (err as { code?: unknown } | null)?.code
      resolve({ code: !err ? 0 : typeof c === 'number' ? c : 127, stdout: String(stdout), stderr: redact(String(stderr), token) })
    })
  })
}

/** Never let a token reach a message shown to the user or a log. */
export function redact(text: string, token: string | undefined): string {
  return token ? text.split(token).join('***') : text
}

// ── GitHub (REST) ────────────────────────────────────────────────────────────

export interface GithubRepo { name: string; fullName: string; cloneUrl: string; htmlUrl: string; private: boolean }
export class GithubError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

type Fetch = typeof fetch

/** `OBSCL_GITHUB_API` lets tests (and GitHub Enterprise users) point at another API server. */
export function githubApiBase(): string {
  return (process.env.OBSCL_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '')
}

async function gh<T>(token: string, path: string, init: RequestInit = {}, f: Fetch = fetch): Promise<T> {
  let res: Response
  try {
    res = await f(`${githubApiBase()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'obs-config-loader',
        Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch (e) {
    throw new GithubError(`Could not reach GitHub: ${redact((e as Error).message, token)}. Check your internet connection.`, 0)
  }
  if (res.status === 401) throw new GithubError('GitHub did not accept that token. It may be wrong, expired, or revoked.', 401)
  if (res.status === 403) throw new GithubError('GitHub refused: the token may lack the "repo" permission, or you hit a rate limit.', 403)
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { message?: string; errors?: { message?: string }[] }
      detail = [j.message, ...(j.errors ?? []).map((e) => e.message)].filter(Boolean).join(': ')
    } catch { /* no body */ }
    throw new GithubError(detail || `GitHub answered ${res.status}.`, res.status)
  }
  return (await res.json()) as T
}

const toRepo = (r: any): GithubRepo => ({ name: r.name, fullName: r.full_name, cloneUrl: r.clone_url, htmlUrl: r.html_url, private: !!r.private })

export async function githubWhoAmI(token: string, f?: Fetch): Promise<{ login: string }> {
  return { login: (await gh<{ login: string }>(token, '/user', {}, f)).login }
}

export async function githubListRepos(token: string, f?: Fetch): Promise<GithubRepo[]> {
  const rows = await gh<any[]>(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', {}, f)
  return rows.map(toRepo)
}

export async function githubCreateRepo(
  token: string, name: string, opts: { private: boolean; description?: string }, f?: Fetch,
): Promise<GithubRepo> {
  const clean = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!clean) throw new GithubError('Give the repository a name (letters, numbers, dashes).', 0)
  try {
    return toRepo(await gh<any>(token, '/user/repos', {
      method: 'POST',
      body: JSON.stringify({ name: clean, private: opts.private, description: opts.description ?? 'OBS setup, managed with OBS Config Loader', auto_init: false }),
    }, f))
  } catch (e) {
    if (e instanceof GithubError && e.status === 422) throw new GithubError(`You already have a repository called "${clean}" on GitHub. Pick another name.`, 422)
    throw e
  }
}

/**
 * GitHub repositories made by this app are all called `OBS-Config-<name>`, so they are easy to find among a person's others.
 * Takes what a person typed (a preset's name, or only the part after the prefix) and gives the repository name.
 */
export const REPO_PREFIX = 'OBS-Config-'
export function githubRepoName(typed: string): string {
  const rest = typed.trim().replace(/^obs-config-/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return REPO_PREFIX + (rest || 'setup')
}

/** `owner` and `repo` from a GitHub address (https or ssh), when it is one. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
    // the stand-in used in tests and GitHub Enterprise: any host, the last two path parts
    ?? /^(?:https?:\/\/[^/]+\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}

/** Rename a repository on GitHub. Returns the new addresses (the old address keeps working on GitHub, but we switch to the new one). */
export async function githubRenameRepo(token: string, owner: string, repo: string, newName: string, f?: Fetch): Promise<GithubRepo> {
  try {
    return toRepo(await gh<any>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: 'PATCH', body: JSON.stringify({ name: githubRepoName(newName) }) }, f))
  } catch (e) {
    if (e instanceof GithubError && e.status === 422) throw new GithubError(`You already have a repository called "${githubRepoName(newName)}" on GitHub. Pick another name.`, 422)
    if (e instanceof GithubError && e.status === 404) throw new GithubError('GitHub could not find that repository, or your token may not be allowed to change it.', 404)
    throw e
  }
}

/** The link that opens GitHub's token page with the right permission ticked, so the user only has to press Generate. */
export const GITHUB_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo&description=' + encodeURIComponent('OBS Config Loader')

// ── publishing, and turning a bundle into a repository ───────────────────────

/** Create the repository on GitHub, point `origin` at it, and push. One step for the user. */
export async function publishToGithub(
  dir: string, token: string, name: string, opts: { private: boolean }, f?: Fetch,
): Promise<{ repo: GithubRepo; push: PushResult }> {
  const git = githubAuthGit(token)
  const st = await repoStatus(dir, git)
  if (!st.isRepo) throw new Error('That folder is not a git repository.')
  if (st.remote) throw new Error('This repository already has a remote. Change its address instead.')
  const repo = await githubCreateRepo(token, githubRepoName(name), opts, f)
  const set = await setRemote(dir, repo.cloneUrl, git)
  if (!set.ok) throw new Error(set.message)
  return { repo, push: await pushRepo(dir, git) }
}

/** A bundle someone sent (zip) becomes a repository of its own: init, write the files, commit. */
/** A git address safe to write into a file others may open: no user name or password in it. */
export function publicRemoteUrl(url: string): string {
  try {
    const u = new URL(url)
    u.username = ''; u.password = ''
    return u.toString().replace(/\/$/, '')
  } catch { return url } // ssh-style (git@host:owner/repo.git) and folders carry no password
}

export async function createRepoFromBundle(dir: string, bundle: Bundle, git: GitRunner = defaultGit): Promise<void> {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('That folder is not empty.')
  await initRepo(dir, git)
  writeBundleDir(bundle, dir, { withMedia: false })
  await commitAll(dir, `Start from "${bundle.manifest.name}"`, git)
}

// ── is git installed, and how to get it ──────────────────────────────────────

export interface GitInstallHelp {
  /** What the app can try itself (a button), if anything. */
  auto?: { label: string; command: string; args: string[] }
  /** What to show when it cannot, or fails. */
  manual: string
  commandLine?: string
}

/** Pure: pick the install route for a platform and (on Linux) the package manager found. */
export function gitInstallHelp(platform: 'win32' | 'darwin' | 'linux', pm?: 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk'): GitInstallHelp {
  if (platform === 'win32') {
    return {
      auto: { label: 'Install Git for me', command: 'winget', args: ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'] },
      manual: 'Download the installer from https://git-scm.com/download/win, run it, and keep the default options. Then press "Check again".',
      commandLine: 'winget install --id Git.Git -e',
    }
  }
  if (platform === 'darwin') {
    return {
      auto: { label: 'Install Git for me', command: 'xcode-select', args: ['--install'] },
      manual: 'macOS will offer to install the command line developer tools, which include git. Accept, wait for it to finish, then press "Check again".',
      commandLine: 'xcode-select --install',
    }
  }
  const cmds: Record<string, string[]> = {
    apt: ['apt-get', 'install', '-y', 'git'], dnf: ['dnf', 'install', '-y', 'git'], pacman: ['pacman', '-S', '--noconfirm', 'git'],
    zypper: ['zypper', '--non-interactive', 'install', 'git'], apk: ['apk', 'add', 'git'],
  }
  const c = pm ? cmds[pm] : undefined
  const line = c ? `sudo ${c.join(' ')}` : 'Install the "git" package with your distribution\'s package manager.'
  return {
    auto: c ? { label: 'Install Git for me (asks for your password)', command: 'pkexec', args: c } : undefined,
    manual: `Open a terminal and run the command below, then press "Check again".`,
    commandLine: line,
  }
}

export function detectLinuxPackageManager(exists: (p: string) => boolean = fs.existsSync): 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk' | undefined {
  const has = (bin: string) => ['/usr/bin/', '/bin/', '/usr/sbin/', '/sbin/'].some((d) => exists(d + bin))
  const order: ['apt-get' | 'dnf' | 'pacman' | 'zypper' | 'apk', 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk'][] = [
    ['apt-get', 'apt'], ['dnf', 'dnf'], ['pacman', 'pacman'], ['zypper', 'zypper'], ['apk', 'apk'],
  ]
  return order.find(([bin]) => has(bin))?.[1]
}
