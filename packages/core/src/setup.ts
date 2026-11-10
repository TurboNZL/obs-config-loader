import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import type { Manifest, Platform } from './types.js'
import { resolveString, type TokenResolver } from './tokens.js'

/**
 * Setup steps: what a preset does for a person that is more than OBS settings (install the helper program it needs, run its own
 * installer). A step is a program and its arguments (never a shell line), written per system. The person presses a button; they never
 * open a terminal. A step is NEVER run by itself: a preset can come from anyone, so each one is shown in words first.
 */
export interface SetupCommand { program: string; args?: string[] }
export interface SetupStep {
  id: string
  title: string
  /** One plain sentence: what pressing the button does. */
  why?: string
  /** What to run, per system. A system with no entry has no such step. `any` is used when the system has none of its own. */
  run: Partial<Record<Platform | 'any', SetupCommand>>
  /** Folder to run in (templated). Default: the preset's script folder when it has one, else the preset's own. */
  cwd?: string
  /** `wait` (default): run it and show what it says. `open`: start it and leave it (a program with its own window). */
  mode?: 'wait' | 'open'
  /** Offered but not needed (shown without the "needed" emphasis). */
  optional?: boolean
}

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,40}$/

/** The steps in a manifest that are well formed. Anything else is ignored, never run. */
export function setupSteps(m: Pick<Manifest, 'setup'>): SetupStep[] {
  const raw = (m as { setup?: { steps?: unknown } }).setup?.steps
  if (!Array.isArray(raw)) return []
  const out: SetupStep[] = []
  for (const s of raw as any[]) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !STEP_ID.test(s.id) || typeof s.title !== 'string' || !s.title.trim()) continue
    if (!s.run || typeof s.run !== 'object') continue
    const run: SetupStep['run'] = {}
    for (const k of ['win32', 'darwin', 'linux', 'any'] as const) {
      const c = s.run[k]
      if (c && typeof c.program === 'string' && c.program.trim() && (c.args === undefined || (Array.isArray(c.args) && c.args.every((a: unknown) => typeof a === 'string')))) {
        run[k] = { program: c.program, ...(c.args ? { args: c.args as string[] } : {}) }
      }
    }
    if (!Object.keys(run).length) continue
    out.push({
      id: s.id, title: s.title.trim(), ...(typeof s.why === 'string' ? { why: s.why } : {}), run,
      ...(typeof s.cwd === 'string' ? { cwd: s.cwd } : {}), ...(s.mode === 'open' ? { mode: 'open' as const } : {}), ...(s.optional === true ? { optional: true } : {}),
    })
  }
  return out
}

export interface SetupContext {
  platform: Platform
  home: string
  /** The preset's own folder. */
  presetDir: string
  /** Where each folder variable is on this computer (what was chosen when the preset was applied, else the suggestion). */
  folders: Record<string, string>
  /** The Python 3 on this computer, when there is one. */
  python?: SetupCommand
  /** The OBS this preset is linked to on this computer: `{{obs}}` is its folder when it is a portable copy (else empty), `{{obskind}}` says which. */
  obs?: { kind: string; configDir: string }
}

export interface PlannedStep {
  id: string
  title: string
  why?: string
  mode: 'wait' | 'open'
  optional: boolean
  /** Exactly what would run, for the person to read. Absent when it cannot run here. */
  command?: { program: string; args: string[]; cwd: string }
  /** Why it cannot run here, in plain words. */
  problem?: string
  /** Changes when the step, or the program it runs, changes: a step someone has run before is asked about again if it did. */
  fingerprint: string
}

function resolver(ctx: SetupContext, missing: string[]): TokenResolver {
  const win = ctx.platform === 'win32'
  return {
    asset: () => undefined,
    variable: (n) => ctx.folders[n],
    builtin: (n) => (n === 'home' ? ctx.home : n === 'bundle' ? ctx.presetDir : n === 'documents' ? nodePath.join(ctx.home, 'Documents') : n === 'desktop' ? nodePath.join(ctx.home, 'Desktop')
      : n === 'videos' ? nodePath.join(ctx.home, win ? 'Videos' : 'Videos') : n === 'music' ? nodePath.join(ctx.home, 'Music') : n === 'pictures' ? nodePath.join(ctx.home, 'Pictures') : undefined),
    isPath: (n) => n in ctx.folders,
    missing: (kind, name) => missing.push(kind === 'var' ? `the folder “${name}” is not set on this computer yet` : `“${name}”`),
  }
}

const fileFingerprint = (p: string): string => {
  try { const st = fs.statSync(p); if (st.isFile() && st.size < 5 * 1024 * 1024) return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') } catch { /* not a file here */ }
  return ''
}

const inside = (child: string, parents: string[], p: typeof nodePath.posix): boolean =>
  parents.some((d) => { const r = p.relative(d, child); return r === '' || (!r.startsWith('..') && !p.isAbsolute(r)) })

/**
 * Work out each step for this computer: what exactly would run, or why it cannot. A program must be Python (the one on this computer) or a
 * file inside the preset's own folders; nothing else is ever run, so a preset cannot name some other program on the person's computer.
 */
export function planSetup(manifest: Pick<Manifest, 'setup'>, ctx: SetupContext): PlannedStep[] {
  const p = (ctx.platform === 'win32' ? nodePath.win32 : nodePath.posix) as typeof nodePath.posix
  const roots = [ctx.presetDir, ...Object.values(ctx.folders)].filter(Boolean)
  return setupSteps(manifest).map((s) => {
    const base = { id: s.id, title: s.title, ...(s.why ? { why: s.why } : {}), mode: s.mode ?? 'wait', optional: !!s.optional } as const
    const cmd = s.run[ctx.platform] ?? s.run.any
    if (!cmd) return { ...base, problem: 'This step is not needed on this kind of computer.', fingerprint: '' }
    const missing: string[] = []
    const r = resolver(ctx, missing)
    const portableRoot = ctx.obs?.kind === 'portable' ? p.dirname(p.dirname(ctx.obs.configDir)) : ''
    const obsKind = !ctx.obs ? '' : ctx.obs.kind === 'portable' ? 'portable' : 'installed'
    const fill = (x: string) => resolveString(x.replace(/\{\{obs\}\}/g, () => portableRoot).replace(/\{\{obskind\}\}/g, () => obsKind), r, ctx.platform)
    let program = cmd.program.trim()
    let lead: string[] = []
    if (program === '{{python}}') {
      if (!ctx.python) return { ...base, problem: 'This step needs Python 3, and it is not installed on this computer yet.', fingerprint: '' }
      program = ctx.python.program; lead = ctx.python.args ?? []
    } else {
      program = fill(program)
      if (missing.length) return { ...base, problem: `Not ready yet: ${[...new Set(missing)].join(', ')}.`, fingerprint: '' }
      if (!p.isAbsolute(program) || !inside(p.normalize(program), roots.map((x) => p.normalize(x)), p)) {
        return { ...base, problem: 'This step wants to run a program that is not part of this setup, so it is not allowed.', fingerprint: '' }
      }
    }
    const args = [...lead, ...(cmd.args ?? []).map(fill)]
    let cwd = s.cwd ? fill(s.cwd) : (Object.values(ctx.folders)[0] ?? ctx.presetDir)
    if (missing.length) return { ...base, problem: `Not ready yet: ${[...new Set(missing)].join(', ')}.`, fingerprint: '' }
    if (!p.isAbsolute(cwd)) cwd = p.join(ctx.presetDir, cwd)
    if (!inside(p.normalize(cwd), roots.map((x) => p.normalize(x)), p)) return { ...base, problem: 'This step wants to run outside this setup\'s own folders, so it is not allowed.', fingerprint: '' }
    const isFile = program === (ctx.python?.program ?? '\0') ? '' : fileFingerprint(program)
    if (program !== ctx.python?.program && !fs.existsSync(program)) return { ...base, problem: `The program this step runs is not on this computer yet (${p.basename(program)}). Apply the preset first, so its files are put there.`, fingerprint: '' }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([s.id, program, args, cwd, isFile])).digest('hex').slice(0, 24)
    return { ...base, command: { program, args, cwd }, fingerprint }
  })
}

/** A Python 3 on this computer: what to run (`py -3` on Windows, else `python3`, else `python`). */
export function findPython(platform: Platform, run: (cmd: string, args: string[]) => { status: number | null; stdout: string } = (c, a) => {
  const r = spawnSync(c, a, { encoding: 'utf8', timeout: 8000 })
  return { status: r.status, stdout: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}): SetupCommand | undefined {
  const tries: SetupCommand[] = platform === 'win32'
    ? [{ program: 'py', args: ['-3'] }, { program: 'python' }, { program: 'python3' }]
    : [{ program: 'python3' }, { program: 'python' }]
  for (const t of tries) {
    const r = run(t.program, [...(t.args ?? []), '--version'])
    if (r.status === 0 && /Python 3\.\d+/.test(r.stdout)) return t
  }
  return undefined
}

export interface StepResult { exitCode: number | null; /** The program could not be started at all. */ failedToStart?: string; timedOut?: boolean }

/** Run one planned step. `onLine` hears every line it prints. `open` steps are started and left running. */
export function runPlannedStep(step: PlannedStep, onLine: (line: string) => void, opts: { timeoutMs?: number; platform?: Platform } = {}): Promise<StepResult> {
  return new Promise((resolve) => {
    if (!step.command) { resolve({ exitCode: null, failedToStart: step.problem ?? 'This step cannot run here.' }); return }
    const win = (opts.platform ?? (process.platform === 'win32' ? 'win32' : 'linux')) === 'win32'
    let { program, args } = step.command
    // Windows will not start a .bat/.cmd file directly
    if (win && /\.(bat|cmd)$/i.test(program)) { args = ['/d', '/c', program, ...args]; program = 'cmd.exe' }
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
    let child
    try {
      child = spawn(program, args, { cwd: step.command.cwd, env, stdio: step.mode === 'open' ? 'ignore' : ['ignore', 'pipe', 'pipe'], detached: step.mode === 'open', windowsHide: step.mode !== 'open' })
    } catch (e) { resolve({ exitCode: null, failedToStart: (e as Error).message }); return }
    if (step.mode === 'open') { child.on('error', (e) => resolve({ exitCode: null, failedToStart: e.message })); child.unref(); setTimeout(() => resolve({ exitCode: 0 }), 600); return }
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, opts.timeoutMs ?? 30 * 60_000)
    const feed = (buf: Buffer) => { for (const l of buf.toString('utf8').split(/\r?\n/)) if (l.trim()) onLine(l) }
    child.stdout?.on('data', feed); child.stderr?.on('data', feed)
    child.on('error', (e) => { clearTimeout(timer); resolve({ exitCode: null, failedToStart: e.message }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code, ...(timedOut ? { timedOut } : {}) }) })
  })
}
