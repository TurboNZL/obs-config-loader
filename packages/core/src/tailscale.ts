import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * Tailscale, driven from the app: a free private network between a streamer and the people who send video to them, with nothing opened
 * on the router. Every function reports in plain words and never throws for an ordinary problem (not installed, not signed in).
 * `Run` is injected so all of it is tested without Tailscale.
 */
export type Run = (cmd: string, args: string[], timeoutMs?: number) => { code: number; out: string }

export const defaultRun: Run = (cmd, args, timeoutMs = 60_000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  if (r.error) return { code: (r.error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 126, out: String(r.error.message) }
  return { code: r.status ?? 124, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

export interface TailscaleState { installed: boolean; running: boolean; needsLogin: boolean; ip: string; dns: string; detail: string }

/** The program: on Windows it is installed but not on PATH until a new window is opened. */
export function findTailscale(platform: NodeJS.Platform, exists: (p: string) => boolean = fs.existsSync, which: (n: string) => string | null = (n) => { const r = spawnSync(platform === 'win32' ? 'where' : 'which', [n], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0] : null }): string | null {
  const found = which('tailscale')
  if (found) return found
  if (platform === 'win32') { const p = nodePath.win32.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe'); if (exists(p)) return p }
  if (platform === 'darwin' && exists('/Applications/Tailscale.app/Contents/MacOS/Tailscale')) return '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  return null
}

export function parseStatus(text: string): TailscaleState {
  let j: any
  try { j = JSON.parse(text) } catch { return { installed: true, running: false, needsLogin: false, ip: '', dns: '', detail: 'Tailscale gave an answer this app could not read.' } }
  const backend: string = j.BackendState ?? ''
  const me = j.Self ?? {}
  const ips: string[] = (me.TailscaleIPs ?? j.TailscaleIPs ?? []).filter((a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
  return {
    installed: true, running: backend === 'Running', ip: ips[0] ?? '', dns: String(me.DNSName ?? '').replace(/\.$/, ''),
    needsLogin: ['NeedsLogin', 'NoState', 'NeedsMachineAuth', 'Stopped'].includes(backend),
    detail: ({ Running: 'Tailscale is on and signed in.', NeedsLogin: 'Tailscale is installed but not signed in yet.', Stopped: 'Tailscale is installed but switched off.' } as Record<string, string>)[backend] ?? `Tailscale says: ${backend || 'unknown'}.`,
  }
}

export function tailscaleState(run: Run, cli: string | null): TailscaleState {
  if (!cli) return { installed: false, running: false, needsLogin: false, ip: '', dns: '', detail: 'Tailscale is not installed.' }
  const r = run(cli, ['status', '--json'])
  if (r.code !== 0 && !r.out.trim().startsWith('{')) return { installed: true, running: false, needsLogin: true, ip: '', dns: '', detail: 'Tailscale is installed but not running or not signed in.' }
  return parseStatus(r.out)
}

/** What installs it without a terminal: winget on Windows, the system's password prompt on Linux. A Mac installs it from the App Store. */
export function installCommand(platform: NodeJS.Platform, has: (n: string) => boolean): { cmd?: { program: string; args: string[] }; explain: string; manual?: string } {
  if (platform === 'win32') {
    return has('winget')
      ? { cmd: { program: 'winget', args: ['install', '-e', '--id', 'Tailscale.Tailscale', '--accept-package-agreements', '--accept-source-agreements'] }, explain: 'Windows asks for permission to install Tailscale.' }
      : { explain: '', manual: 'Download Tailscale from https://tailscale.com/download/windows, install it, then come back.' }
  }
  if (platform === 'darwin') return { explain: '', manual: 'Install Tailscale from the App Store (search for Tailscale), then come back.' }
  return has('pkexec')
    ? { cmd: { program: 'pkexec', args: ['sh', '-c', 'curl -fsSL https://tailscale.com/install.sh | sh'] }, explain: 'Your computer asks for your password to install Tailscale.' }
    : { explain: '', manual: 'Tailscale\'s Linux install instructions are at https://tailscale.com/download/linux.' }
}

/** Share a local web page (for example a dashboard) on this computer's private address, over https. */
export function serveCommands(cli: string, httpPort: number): string[][] { return [[cli, 'serve', '--bg', `http://localhost:${httpPort}`]] }
