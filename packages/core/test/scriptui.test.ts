import { describe, it, expect } from 'vitest'
import { parseScriptLine, scriptReply, safeScriptUrl, SCRIPT_UI_PREFIX, setupSteps } from '../src/index.js'

describe('script screens protocol', () => {
  it('reads messages and ignores ordinary output', () => {
    expect(parseScriptLine('@@obscl {"t":"hello","title":"x"}')).toEqual({ t: 'hello', title: 'x' })
    expect(parseScriptLine('Downloading OBS 12%')).toBeNull()
    expect(parseScriptLine('@@obscl not json')).toBeNull()
    expect(parseScriptLine('@@obscl {"nope":1}')).toBeNull()
  })
  it('builds one line per reply', () => {
    const r = scriptReply({ t: 'submit', id: 's1', button: 'next', values: { a: '1' } })
    expect(r.startsWith(SCRIPT_UI_PREFIX) && r.endsWith('\n') && r.split('\n').length === 2).toBe(true)
    expect(JSON.parse(r.slice(SCRIPT_UI_PREFIX.length))).toMatchObject({ button: 'next' })
  })
  it('only opens web addresses', () => {
    expect(safeScriptUrl('https://tailscale.com')).toBe('https://tailscale.com')
    expect(safeScriptUrl('file:///etc/passwd')).toBeNull()
    expect(safeScriptUrl('javascript:alert(1)')).toBeNull()
  })
  it('a setup step can run in a tab', () => {
    const s = setupSteps({ setup: { steps: [{ id: 'a', title: 'A', mode: 'tab', tab: 'Installer', run: { any: { program: 'x' } } }] } } as never)
    expect(s[0]).toMatchObject({ mode: 'tab', tab: 'Installer' })
  })
})
