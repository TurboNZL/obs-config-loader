import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { findPython, planSetup, runPlannedStep, setupSteps } from '../src/index.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-setup-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

const manifest = (steps: unknown[]) => ({ setup: { steps } })
const ctx = (over: Record<string, unknown> = {}) => ({ platform: 'linux' as const, home: tmp, presetDir: nodePath.join(tmp, 'preset'), folders: { TOOL: nodePath.join(tmp, 'tool') }, python: { program: 'python3' }, ...over })
const mk = () => { fs.mkdirSync(nodePath.join(tmp, 'tool'), { recursive: true }); fs.mkdirSync(nodePath.join(tmp, 'preset'), { recursive: true }); fs.writeFileSync(nodePath.join(tmp, 'tool/install.sh'), '#!/bin/sh\necho hi\n') }

describe('setup steps in a preset', () => {
  it('only well formed steps are read', () => {
    const steps = setupSteps(manifest([
      { id: 'ok', title: 'Fine', run: { linux: { program: '{{python}}', args: ['x.py'] } } },
      { id: 'Bad Id!', title: 'x', run: { linux: { program: 'a' } } },
      { id: 'no-title', run: { linux: { program: 'a' } } },
      { id: 'no-run', title: 'x' },
      { id: 'bad-args', title: 'x', run: { linux: { program: 'a', args: [1] } } },
      'nonsense',
    ]) as any)
    expect(steps.map((s) => s.id)).toEqual(['ok'])
    expect(setupSteps({} as any)).toEqual([])
  })

  it('works out exactly what would run here, per system, from the folders chosen on this computer', () => {
    mk()
    const m = manifest([
      { id: 'inst', title: 'Install it', why: 'Sets it up.', run: { win32: { program: '{{var:TOOL}}/install.bat' }, linux: { program: '{{var:TOOL}}/install.sh', args: ['--yes'] } }, cwd: '{{var:TOOL}}' },
      { id: 'py', title: 'Run a script', run: { any: { program: '{{python}}', args: ['{{var:TOOL}}/x.py'] } } },
    ]) as any
    const [inst, py] = planSetup(m, ctx())
    expect(inst.command).toEqual({ program: nodePath.join(tmp, 'tool/install.sh'), args: ['--yes'], cwd: nodePath.join(tmp, 'tool') })
    expect(py.command).toMatchObject({ program: 'python3', args: [nodePath.join(tmp, 'tool/x.py')] })
    const onMac = planSetup(m, ctx({ platform: 'darwin' }))
    expect(onMac[0].problem).toMatch(/not needed on this kind of computer/)
    expect(onMac[1].command).toBeTruthy()
  })

  it('refuses a program that is not part of the setup, and says why in words', () => {
    mk()
    const bad = planSetup(manifest([
      { id: 'a', title: 'A', run: { linux: { program: '/usr/bin/curl', args: ['http://evil'] } } },
      { id: 'b', title: 'B', run: { linux: { program: 'curl' } } },
      { id: 'c', title: 'C', run: { linux: { program: '{{var:TOOL}}/../../etc/passwd' } } },
      { id: 'd', title: 'D', run: { linux: { program: '{{var:TOOL}}/install.sh' } }, cwd: '/' },
    ]) as any, ctx())
    expect(bad.every((s) => !s.command)).toBe(true)
    expect(bad.map((s) => s.problem).join(' ')).toMatch(/not part of this setup/)
    expect(bad[3].problem).toMatch(/outside this setup/)
  })

  it('says what is missing instead of guessing: a folder, the program file, Python', () => {
    const noFolder = planSetup(manifest([{ id: 'a', title: 'A', run: { linux: { program: '{{var:NOPE}}/x.sh' } } }]) as any, ctx())
    expect(noFolder[0].problem).toMatch(/folder “NOPE” is not set/)
    const noFile = planSetup(manifest([{ id: 'a', title: 'A', run: { linux: { program: '{{var:TOOL}}/missing.sh' } } }]) as any, ctx())
    expect(noFile[0].problem).toMatch(/Apply the preset first/)
    const noPython = planSetup(manifest([{ id: 'a', title: 'A', run: { any: { program: '{{python}}' } } }]) as any, ctx({ python: undefined }))
    expect(noPython[0].problem).toMatch(/needs Python 3/)
  })

  it('a step that changed is told apart from one that was run before', () => {
    mk()
    const m = manifest([{ id: 'inst', title: 'Install', run: { linux: { program: '{{var:TOOL}}/install.sh' } } }]) as any
    const a = planSetup(m, ctx())[0].fingerprint
    expect(planSetup(m, ctx())[0].fingerprint).toBe(a)
    fs.appendFileSync(nodePath.join(tmp, 'tool/install.sh'), 'rm -rf somewhere\n') // the program itself changed after "Get updates"
    expect(planSetup(m, ctx())[0].fingerprint).not.toBe(a)
  })

  it('finds Python the way each system has it', () => {
    const seen: string[] = []
    const win = findPython('win32', (c, a) => { seen.push([c, ...a].join(' ')); return c === 'py' ? { status: 0, stdout: 'Python 3.13.1' } : { status: 1, stdout: '' } })
    expect(win).toEqual({ program: 'py', args: ['-3'] })
    expect(findPython('linux', (c) => (c === 'python' ? { status: 0, stdout: 'Python 3.11.2' } : { status: 127, stdout: '' }))).toEqual({ program: 'python' })
    expect(findPython('linux', () => ({ status: 0, stdout: 'Python 2.7.18' }))).toBeUndefined()
  })
})

describe('running a step', () => {
  const step = (program: string, args: string[], mode: 'wait' | 'open' = 'wait') => ({ id: 's', title: 's', mode, optional: false, fingerprint: 'x', command: { program, args, cwd: tmp } })
  const PY = process.platform === 'win32' ? 'python' : 'python3'

  it('shows what it prints and reports how it ended', async () => {
    const lines: string[] = []
    const ok = await runPlannedStep(step(PY, ['-c', 'print("one"); print("two")']), (l) => lines.push(l))
    expect(ok.exitCode).toBe(0)
    expect(lines).toEqual(['one', 'two'])
    const bad = await runPlannedStep(step(PY, ['-c', 'import sys; print("nope", file=sys.stderr); sys.exit(3)']), (l) => lines.push(l))
    expect(bad.exitCode).toBe(3)
    expect(lines).toContain('nope')
  })

  it('a program that cannot be started is a sentence, not a crash', async () => {
    const r = await runPlannedStep(step(nodePath.join(tmp, 'not-a-program'), []), () => {})
    expect(r.failedToStart).toBeTruthy()
    expect(await runPlannedStep({ ...step('x', []), command: undefined, problem: 'It cannot run here.' }, () => {})).toMatchObject({ failedToStart: 'It cannot run here.' })
  })

  it('a step with its own window is started and left running', async () => {
    const out = nodePath.join(tmp, 'opened.txt')
    const r = await runPlannedStep(step(PY, ['-c', `open(${JSON.stringify(out)}, "w").write("up")`], 'open'), () => {})
    expect(r.exitCode).toBe(0)
    for (let i = 0; i < 40 && !fs.existsSync(out); i++) await new Promise((x) => setTimeout(x, 50))
    expect(fs.readFileSync(out, 'utf8')).toBe('up')
  })

  it('stops a step that never ends', async () => {
    const r = await runPlannedStep(step(PY, ['-c', 'import time; time.sleep(30)']), () => {}, { timeoutMs: 300 })
    expect(r.timedOut).toBe(true)
  })
})
