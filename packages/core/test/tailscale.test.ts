import { describe, it, expect } from 'vitest'
import { parseStatus, tailscaleState, installCommand, findTailscale } from '../src/index.js'

describe('tailscale', () => {
  it('reads a running status', () => {
    const s = parseStatus(JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.1.2.3', 'fd7a::1'], DNSName: 'pc.tail1234.ts.net.' } }))
    expect(s).toMatchObject({ running: true, ip: '100.1.2.3', dns: 'pc.tail1234.ts.net', needsLogin: false })
  })
  it('says what is wrong in words', () => {
    expect(tailscaleState(() => ({ code: 0, out: '' }), null).detail).toBe('Tailscale is not installed.')
    expect(tailscaleState(() => ({ code: 1, out: 'nope' }), '/usr/bin/tailscale').needsLogin).toBe(true)
    expect(parseStatus(JSON.stringify({ BackendState: 'NeedsLogin' })).needsLogin).toBe(true)
    expect(parseStatus('garbage').detail).toMatch(/could not read/)
  })
  it('installs without a terminal where it can', () => {
    expect(installCommand('win32', (n) => n === 'winget').cmd?.program).toBe('winget')
    expect(installCommand('win32', () => false).manual).toMatch(/tailscale.com/)
    expect(installCommand('linux', (n) => n === 'pkexec').cmd?.program).toBe('pkexec')
    expect(installCommand('darwin', () => true).manual).toMatch(/App Store/)
  })
  it('finds the Windows program when it is not on PATH', () => {
    const p = findTailscale('win32', (x) => x.endsWith('tailscale.exe'), () => null)
    expect(p).toMatch(/Tailscale/)
  })
})
