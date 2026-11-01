import { describe, it, expect } from 'vitest'
import { shQuote, debInstallScript, manualInstallCommand, describePkexec, hasNoNewPrivs, installedMatches, outsideTree, terminalInstallScript, TERMINALS } from './debInstall'
import { describeError, isStillBuilding } from './updateErrors'

describe('deb install helpers', () => {
  it('quotes a path with a quote or spaces for sh', () => {
    expect(shQuote("/tmp/it's here/x.deb")).toBe(`'/tmp/it'\\''s here/x.deb'`)
    expect(debInstallScript('/tmp/a b.deb')).toBe("dpkg -i '/tmp/a b.deb' || apt-get install -f -y")
    expect(manualInstallCommand('/tmp/a.deb')).toBe("sudo apt install '/tmp/a.deb'")
  })
  it('explains each pkexec outcome', () => {
    expect(describePkexec(0)).toEqual({ ok: true })
    expect(describePkexec(126)).toMatchObject({ ok: false, cancelled: true })
    expect(describePkexec(127)).toMatchObject({ ok: false, cancelled: false })
    expect(describePkexec(1, 'Error: not authorized')).toMatchObject({ cancelled: false })
    expect((describePkexec(100, 'dpkg: dependency problems\nbad') as { message: string }).message).toContain('exit code 100')
  })
  it('detects no_new_privs from /proc/self/status', () => {
    expect(hasNoNewPrivs('Name:\tapp\nNoNewPrivs:\t1\nSeccomp:\t0\n')).toBe(true)
    expect(hasNoNewPrivs('Name:\tapp\nNoNewPrivs:\t0\n')).toBe(false)
    expect(hasNoNewPrivs('')).toBe(false)
  })
  it('only trusts dpkg to say the update installed', () => {
    expect(installedMatches('2026.11.1\n', '2026.11.1')).toBe(true)
    expect(installedMatches('2026.11.0', '2026.11.1')).toBe(false)
    expect(installedMatches('', '2026.11.1')).toBe(false)
  })
  it('starts the terminal outside the app\'s process tree, copying the display variables', () => {
    const r = outsideTree('konsole', ['-e', 'x'], { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', HOME: '/h' })
    expect(r.bin).toBe('systemd-run')
    expect(r.args).toEqual(expect.arrayContaining(['--user', '--setenv=DISPLAY', '--setenv=WAYLAND_DISPLAY', '--', 'konsole', '-e', 'x']))
    expect(r.args).not.toContain('--setenv=HOME')
  })
  it('names the app in the terminal text and has a terminal for each common desktop', () => {
    expect(terminalInstallScript('/tmp/a.deb')).toContain('OBS Config Loader')
    expect(TERMINALS.map((t) => t.bin)).toEqual(expect.arrayContaining(['konsole', 'gnome-terminal', 'xterm'])) // Kubuntu and GNOME
  })
})

describe('update errors', () => {
  it('a release whose installers are still being built is not an error', () => {
    expect(isStillBuilding('Cannot find latest-linux.yml in the latest release artifacts')).toBe(true)
    expect(describeError('Cannot find channel "latest.yml" update info')).toMatchObject({ status: 'none' })
    expect(describeError('net::ERR_INTERNET_DISCONNECTED')).toMatchObject({ status: 'error' })
  })
})
