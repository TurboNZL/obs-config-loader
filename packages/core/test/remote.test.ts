import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  validateRemoteUrl, repoNameFromUrl, setRemote, getRemoteUrl, githubAuthGit, redact, githubCreateRepo, githubListRepos, githubWhoAmI,
  GithubError, publishToGithub, createRepoFromBundle, initRepo, captureLive, repoStatus, exportBundle, pullRepo, commitAll, pushRepo,
  gitInstallHelp, detectLinuxPackageManager, GITHUB_TOKEN_URL,
} from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-rem-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

/** A fake GitHub: records requests, answers like the real API for the three calls the app makes. */
function fakeGithub(over: { cloneUrl?: string; status?: number; body?: unknown } = {}) {
  const calls: { url: string; method: string; auth: string | null; body?: any }[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    calls.push({ url, method: init.method ?? 'GET', auth: headers.Authorization ?? null, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    if (over.status && over.status !== 200) return json(over.status, over.body ?? { message: 'nope' })
    if (url.endsWith('/user')) return json(200, { login: 'streamer' })
    if (url.includes('/user/repos') && init.method === 'POST') {
      const name = JSON.parse(String(init.body)).name
      return json(201, { name, full_name: `streamer/${name}`, clone_url: over.cloneUrl ?? `https://github.com/streamer/${name}.git`, html_url: `https://github.com/streamer/${name}`, private: JSON.parse(String(init.body)).private })
    }
    if (url.includes('/user/repos')) return json(200, [{ name: 'a', full_name: 'streamer/a', clone_url: 'https://github.com/streamer/a.git', html_url: 'https://github.com/streamer/a', private: true }])
    return json(404, { message: 'Not Found' })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('remote addresses', () => {
  it('accepts the usual forms and refuses anything git could mistake for an option', () => {
    for (const ok of ['https://github.com/you/setup.git', 'git@github.com:you/setup.git', 'ssh://git@host/you/x.git', 'file:///srv/x.git', '/srv/x.git', 'http://nas.local/x.git'])
      expect(validateRemoteUrl(ok)).toMatchObject({ ok: true })
    for (const bad of ['', '   ', '--upload-pack=evil', 'my setup', 'github.com/you', 'ftp://x'])
      expect(validateRemoteUrl(bad)).toMatchObject({ ok: false })
  })
  it('suggests a folder name from an address', () => {
    expect(repoNameFromUrl('https://github.com/you/my-setup.git')).toBe('my-setup')
    expect(repoNameFromUrl('git@github.com:you/obs.git/')).toBe('obs')
    expect(repoNameFromUrl('')).toBe('obs-setup')
  })
  it('adds, then changes, the origin', async () => {
    const dir = nodePath.join(tmp, 'r'); await initRepo(dir)
    expect(await getRemoteUrl(dir)).toBeUndefined()
    expect(await setRemote(dir, 'https://example.com/a.git')).toEqual({ ok: true })
    expect(await getRemoteUrl(dir)).toBe('https://example.com/a.git')
    expect(await setRemote(dir, 'https://example.com/b.git')).toEqual({ ok: true })
    expect(await getRemoteUrl(dir)).toBe('https://example.com/b.git')
    expect(await setRemote(dir, '--evil')).toMatchObject({ ok: false })
  })
})

describe('token handling', () => {
  it('reaches git through its environment only: not in arguments, not in .git/config', async () => {
    const dir = nodePath.join(tmp, 'r'); await initRepo(dir)
    const run = githubAuthGit('ghp_SECRETTOKEN')
    const r = await run(['config', '--get', 'http.https://github.com/.extraheader'], dir)
    expect(r.stdout).toContain('AUTHORIZATION: basic ')
    expect(Buffer.from(r.stdout.trim().split(' ').pop()!, 'base64').toString()).toBe('x-access-token:ghp_SECRETTOKEN')
    expect(fs.readFileSync(nodePath.join(dir, '.git/config'), 'utf8')).not.toContain('SECRETTOKEN')
    // a plain runner (no token) does not carry it
    expect((await githubAuthGit(undefined)(['config', '--get', 'http.https://github.com/.extraheader'], dir)).stdout).toBe('')
  })
  it('redacts a token from anything shown', () => {
    expect(redact('fatal: could not read from https://x:ghp_ABC@github.com', 'ghp_ABC')).toBe('fatal: could not read from https://x:***@github.com')
    expect(redact('nothing', undefined)).toBe('nothing')
  })
  it('links to the token page with the permission pre-ticked', () => {
    expect(GITHUB_TOKEN_URL).toMatch(/^https:\/\/github\.com\/settings\/tokens\/new\?scopes=repo&description=/)
  })
})

describe('GitHub calls', () => {
  it('who am I, list, create', async () => {
    const g = fakeGithub()
    expect(await githubWhoAmI('t', g.f)).toEqual({ login: 'streamer' })
    expect((await githubListRepos('t', g.f))[0]).toMatchObject({ fullName: 'streamer/a', private: true })
    const made = await githubCreateRepo('t', ' My OBS Setup! ', { private: true }, g.f)
    expect(made).toMatchObject({ name: 'My-OBS-Setup', cloneUrl: 'https://github.com/streamer/My-OBS-Setup.git' })
    expect(g.calls.every((c) => c.auth === 'Bearer t')).toBe(true)
    expect(g.calls.at(-1)!.body).toMatchObject({ private: true, auto_init: false })
  })
  it('turns failures into plain sentences', async () => {
    await expect(githubWhoAmI('bad', fakeGithub({ status: 401 }).f)).rejects.toThrow(/did not accept that token/)
    await expect(githubCreateRepo('t', 'x', { private: true }, fakeGithub({ status: 403 }).f)).rejects.toThrow(/"repo" permission/)
    await expect(githubCreateRepo('t', 'x', { private: true }, fakeGithub({ status: 422 }).f)).rejects.toThrow(/already have a repository called "x"/)
    await expect(githubCreateRepo('t', '!!!', { private: true }, fakeGithub().f)).rejects.toThrow(GithubError)
    const offline = (async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com') }) as unknown as typeof fetch
    await expect(githubWhoAmI('t', offline)).rejects.toThrow(/Could not reach GitHub/)
  })
})

describe('publish and bundle-to-repo', () => {
  it('creates the remote repository, points origin at it and pushes, in one call', async () => {
    const bare = nodePath.join(tmp, 'remote.git')
    git(tmp, 'init', '--bare', '--initial-branch=main', bare)
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const dir = nodePath.join(tmp, 'repo'); await initRepo(dir)
    await captureLive({ host: host('linux', home), install: install(cfg), dir, name: 'Mine' })
    const g = fakeGithub({ cloneUrl: bare })
    const out = await publishToGithub(dir, 'ghp_x', 'my setup', { private: true }, g.f)
    expect(out.push).toEqual({ status: 'pushed' })
    expect(await getRemoteUrl(dir)).toBe(bare)
    expect(git(bare, 'rev-list', '--count', 'main')).toBe('1')
    // publishing twice is refused rather than creating a second repository
    await expect(publishToGithub(dir, 'ghp_x', 'again', { private: true }, g.f)).rejects.toThrow(/already has a remote/)
    expect(g.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('turns a received bundle into a repository of its own', async () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const bundle = exportBundle({ host: host('linux', home), install: install(cfg), name: 'From a friend' })
    const dir = nodePath.join(tmp, 'new')
    await createRepoFromBundle(dir, bundle)
    const st = await repoStatus(dir)
    expect(st).toMatchObject({ isRepo: true, hasManifest: true, commits: 1, dirtyFiles: [] })
    expect(st.manifest?.name).toBe('From a friend')
    await expect(createRepoFromBundle(dir, bundle)).rejects.toThrow(/not empty/)
  })
})

describe('resolving a conflict from the app', () => {
  const edit = (dir: string, v: string) => {
    const p = nodePath.join(dir, 'collections/main.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.current_scene = v
    fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n')
  }
  const cur = (dir: string) => JSON.parse(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).current_scene

  it('save: keep the repository\'s version, or keep OBS\'s, of just the clashing lines', async () => {
    for (const [choice, expected] of [['keep-repo', 'From the repo'], ['keep-obs', 'From OBS']] as const) {
      const sub = fs.mkdtempSync(nodePath.join(tmp, 'c-'))
      const home = nodePath.join(sub, 'home'); const { cfg, } = makeSource(home)
      const dir = nodePath.join(sub, 'repo'); await initRepo(dir)
      const h = host('linux', home), inst = install(cfg)
      await captureLive({ host: h, install: inst, dir, name: 'M' })
      edit(dir, 'From the repo'); await commitAll(dir, 'repo edit')
      const scene = nodePath.join(cfg, 'basic/scenes/Main.json')
      const live = JSON.parse(fs.readFileSync(scene, 'utf8')); live.current_scene = 'From OBS'
      live.sources.push({ id: 'color_source', name: 'Extra', uuid: 'u', settings: {} }); fs.writeFileSync(scene, JSON.stringify(live))
      expect((await captureLive({ host: h, install: inst, dir })).status).toBe('conflict')
      const r = await captureLive({ host: h, install: inst, dir, onConflict: choice })
      expect(r).toMatchObject({ status: 'committed', merged: true })
      expect(cur(dir)).toBe(expected)
      // everything that did not clash is kept either way
      expect(fs.readFileSync(nodePath.join(dir, 'collections/main.json'), 'utf8')).toContain('Extra')
      expect((await repoStatus(dir)).dirtyFiles).toEqual([])
    }
  })

  it('pull: keep mine or keep theirs', async () => {
    for (const [choice, expected] of [['keep-mine', 'A'], ['keep-theirs', 'B']] as const) {
      const sub = fs.mkdtempSync(nodePath.join(tmp, 'p-'))
      const bare = nodePath.join(sub, 'r.git'); git(sub, 'init', '--bare', '--initial-branch=main', bare)
      const home = nodePath.join(sub, 'home'); const { cfg } = makeSource(home)
      const a = nodePath.join(sub, 'a'); await initRepo(a); await setRemote(a, bare)
      await captureLive({ host: host('linux', home), install: install(cfg), dir: a, name: 'M' })
      await pushRepo(a)
      const b = nodePath.join(sub, 'b'); fs.mkdirSync(b); git(b, 'clone', '-q', bare, '.')
      edit(b, 'B'); await commitAll(b, 'B'); await pushRepo(b)
      edit(a, 'A'); await commitAll(a, 'A')
      expect((await pullRepo(a)).status).toBe('conflict')
      expect((await pullRepo(a, undefined, choice)).status).toBe('updated')
      expect(cur(a)).toBe(expected)
      expect((await repoStatus(a)).dirtyFiles).toEqual([])
    }
  })
})

describe('installing git', () => {
  it('picks the route for each platform', () => {
    expect(gitInstallHelp('win32').auto).toMatchObject({ command: 'winget' })
    expect(gitInstallHelp('darwin').auto).toMatchObject({ command: 'xcode-select' })
    expect(gitInstallHelp('linux', 'apt')).toMatchObject({ auto: { command: 'pkexec', args: ['apt-get', 'install', '-y', 'git'] }, commandLine: 'sudo apt-get install -y git' })
    expect(gitInstallHelp('linux', 'dnf').commandLine).toBe('sudo dnf install -y git')
    const unknown = gitInstallHelp('linux')
    expect(unknown.auto).toBeUndefined() // never guess a command to run as root
    expect(unknown.manual.length).toBeGreaterThan(10)
  })
  it('finds the package manager from the files that exist', () => {
    expect(detectLinuxPackageManager((p) => p === '/usr/bin/apt-get')).toBe('apt')
    expect(detectLinuxPackageManager((p) => p === '/usr/bin/dnf')).toBe('dnf')
    expect(detectLinuxPackageManager((p) => p === '/usr/bin/pacman')).toBe('pacman')
    expect(detectLinuxPackageManager(() => false)).toBeUndefined()
  })
})
