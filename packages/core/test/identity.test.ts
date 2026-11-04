import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { execFileSync } from 'node:child_process'
import { commitAll, initRepo, listAuthors, rewriteAuthor, discardNameChangeBackup, withIdentity, defaultGit, githubAuthGit, pushRepo, setRemote, fetchRepo, repoStatus } from '../src/index.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-id-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
// a computer whose own git says it is "Windows Person"; no global config is read or written by the app
const sys = { GIT_AUTHOR_NAME: 'Windows Person', GIT_AUTHOR_EMAIL: 'private@example.com', GIT_COMMITTER_NAME: 'Windows Person', GIT_COMMITTER_EMAIL: 'private@example.com' }
const system = (args: string[], cwd: string, env?: Record<string, string>) => defaultGit(args, cwd, { ...sys, ...env })
const who = { name: 'Streamer', email: '1+streamer@users.noreply.github.com' }

describe('who a save is by', () => {
  it('uses the given identity instead of the computer’s, and leaves git’s own settings alone', async () => {
    const dir = nodePath.join(tmp, 'p'); await initRepo(dir, system)
    fs.writeFileSync(nodePath.join(dir, 'a.txt'), '1')
    await commitAll(dir, 'first', withIdentity(system, who))
    expect(g(dir, 'log', '-1', '--format=%an <%ae> | %cn <%ce>')).toBe('Streamer <1+streamer@users.noreply.github.com> | Streamer <1+streamer@users.noreply.github.com>')
    // nothing was written to any git config
    expect(fs.readFileSync(nodePath.join(dir, '.git', 'config'), 'utf8')).not.toMatch(/Streamer|\[user\]/)
    fs.writeFileSync(nodePath.join(dir, 'a.txt'), '2')
    await commitAll(dir, 'second', system) // no identity given: the computer’s own name, as before
    expect(g(dir, 'log', '-1', '--format=%an')).toBe('Windows Person')
  })

  it('also reaches git through the GitHub sign-in runner', async () => {
    const dir = nodePath.join(tmp, 'p'); await initRepo(dir, system)
    fs.writeFileSync(nodePath.join(dir, 'a.txt'), '1')
    await commitAll(dir, 'first', withIdentity(githubAuthGit('tok', system), who))
    expect(g(dir, 'log', '-1', '--format=%an')).toBe('Streamer')
  })
})

describe('changing the name on every save of a preset', () => {
  it('rewrites all saves, keeps files, messages and dates, and can drop the old history', async () => {
    const dir = nodePath.join(tmp, 'p'); await initRepo(dir, system)
    const dates = ['2024-01-01T10:00:00 +0200', '2024-02-02T11:00:00 +0200', '2024-03-03T12:00:00 +0000']
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(nodePath.join(dir, 'a.txt'), String(i))
      await commitAll(dir, `save ${i}\n\nmore text`, (a, c, e) => system(a, c, { GIT_AUTHOR_DATE: dates[i], GIT_COMMITTER_DATE: dates[i], ...e }))
    }
    // a side branch with a merge, and a tag
    g(dir, 'checkout', '-q', '-b', 'side', 'HEAD~1'); fs.writeFileSync(nodePath.join(dir, 'b.txt'), 'b'); await commitAll(dir, 'side', system)
    g(dir, 'checkout', '-q', 'main'); execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], { cwd: dir, env: { ...process.env, ...sys } }); g(dir, 'tag', 'v1')
    expect((await listAuthors(dir, system)).map((a) => [a.name, a.saves])).toEqual([['Windows Person', 5]])
    const before = { tree: g(dir, 'rev-parse', 'HEAD^{tree}'), msgs: g(dir, 'log', '--format=%s', 'main'), dates: g(dir, 'log', '--format=%ad', '--date=raw', 'main') }

    const r = await rewriteAuthor(dir, who, system)
    expect(r).toMatchObject({ ok: true, changed: true, rewritten: 5 })
    expect(await listAuthors(dir, system)).toEqual([{ ...who, saves: 5 }])
    expect(g(dir, 'log', '--format=%cn <%ce>', '--branches', '--tags').split('\n').every((l) => l === `${who.name} <${who.email}>`)).toBe(true)
    expect(g(dir, 'rev-parse', 'HEAD^{tree}')).toBe(before.tree)
    expect(g(dir, 'log', '--format=%s', 'main')).toBe(before.msgs)
    expect(g(dir, 'log', '--format=%ad', '--date=raw', 'main')).toBe(before.dates)
    expect(g(dir, 'log', '-1', '--format=%B', 'main~1')).toContain('save 2') // multi-line message survives
    expect(g(dir, 'rev-list', '--merges', '--count', 'main')).toBe('1')
    expect(g(dir, 'rev-parse', 'v1^{commit}')).toBe(g(dir, 'rev-parse', 'main'))
    expect(g(dir, 'status', '--porcelain')).toBe('')
    // again with the same name: nothing to do
    expect(await rewriteAuthor(dir, who, system)).toMatchObject({ ok: true, changed: false })

    // the old name is still findable until the backup is dropped, and gone afterwards
    expect(g(dir, 'log', '--format=%an', '--all')).toContain('Windows Person')
    await discardNameChangeBackup(dir, system)
    expect(g(dir, 'log', '--format=%an', '--all')).not.toContain('Windows Person')
    expect(g(dir, 'cat-file', '-t', 'HEAD')).toBe('commit')
  })

  it('sends the new history online with a forced (leased) upload, and a fresh clone has the new name only', async () => {
    const bare = nodePath.join(tmp, 'remote.git'); fs.mkdirSync(bare); g(bare, 'init', '-q', '--bare', '-b', 'main')
    const dir = nodePath.join(tmp, 'p'); await initRepo(dir, system)
    fs.writeFileSync(nodePath.join(dir, 'a.txt'), '1'); await commitAll(dir, 'one', system)
    await setRemote(dir, bare, system); expect((await pushRepo(dir, system)).status).toBe('pushed')
    await rewriteAuthor(dir, who, system)
    expect((await pushRepo(dir, system)).status === 'pushed').toBe(false) // a plain upload is refused
    expect((await pushRepo(dir, system, { force: true })).status).toBe('pushed')
    await discardNameChangeBackup(dir, system)
    const clone = nodePath.join(tmp, 'c'); g(tmp, 'clone', '-q', bare, clone)
    expect(g(clone, 'log', '--format=%an', '--all')).toBe(who.name)
    expect((await repoStatus(dir, system)).ahead).toBe(0)
  })

  it('refuses nonsense names', async () => {
    const dir = nodePath.join(tmp, 'p'); await initRepo(dir, system)
    expect(await rewriteAuthor(dir, { name: '', email: 'a@b.c' }, system)).toMatchObject({ ok: false })
    expect(await rewriteAuthor(dir, { name: 'A', email: 'a b' }, system)).toMatchObject({ ok: false })
  })
})
