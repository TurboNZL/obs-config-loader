import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { exportBundle, looksSecret, makeIgnore, stripBom } from '../src/index.js'
import { host, install, makeSource } from './helpers.js'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'obscl-safe-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('what looks like a secret', () => {
  it('finds assignments with a real value, not placeholders or flags', () => {
    for (const yes of ['DISCORD_BOT_TOKEN=MTIzNDU2Nzg5MDEyMzQ1Njc4OQ', 'OBS_WS_PASSWORD=hunter2hunter2', '"server_password": "abcdef123456"', 'stream_key: live_abcd1234', 'api-key = sk-123456789'])
      expect(looksSecret(yes), yes).toBe(true)
    for (const no of ['voice_channel_id=1234567890', 'POV_VOLUME_WARN_DB=-15', 'TOKEN=', 'password={{var:PW}}', '"auth_required": true', 'discord.py @ https://github.com/x/y.zip', 'PyNaCl==1.6.2', 'hotkey=Ctrl+K', 'password: none'])
      expect(looksSecret(no), no).toBe(false)
  })
  it('a byte-order mark does not hide anything', () => {
    expect(looksSecret('﻿DISCORD_BOT_TOKEN=MTIzNDU2Nzg5MDEyMzQ1Njc4OQ')).toBe(true)
    expect(stripBom('﻿{}')).toBe('{}')
  })
})

describe('a project\'s own .gitignore', () => {
  const ig = makeIgnore(['# secrets', '.env', 'members.json', 'venv/', '/lib/', '/config/', '*.log', 'prismalite-preset.txt', 'docs/*.tmp', '!keep.log'].join('\n'))
  it('says what is ignored', () => {
    expect(ig('.env', false)).toBe(true)
    expect(ig('venv', true)).toBe(true)
    expect(ig('venv/bin/python', false)).toBe(true)
    expect(ig('lib', true)).toBe(true)
    expect(ig('lib/obs-scripting/obspython.py', false)).toBe(true)
    expect(ig('tools/lib/x.py', false)).toBe(false) // "/lib/" is only the top one
    expect(ig('switcher.log', false)).toBe(true)
    expect(ig('keep.log', false)).toBe(false)
    expect(ig('prismalite-preset.txt', false)).toBe(true)
    expect(ig('docs/a.tmp', false)).toBe(true)
    expect(ig('switcher.py', false)).toBe(false)
    expect(ig('tools/manager.py', false)).toBe(false)
  })
})

describe('nothing secret reaches a preset', () => {
  function withProject() {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const proj = nodePath.join(home, 'tool')
    fs.mkdirSync(nodePath.join(proj, 'lib'), { recursive: true }); fs.mkdirSync(nodePath.join(proj, 'tools'))
    fs.writeFileSync(nodePath.join(proj, 'main.py'), 'import os\nHERE = os.path.dirname(os.path.abspath(__file__))\n')
    fs.writeFileSync(nodePath.join(proj, 'tools/helper.py'), 'x = 1\n')
    fs.writeFileSync(nodePath.join(proj, 'requirements.txt'), 'PyNaCl==1.6.2\n')
    fs.mkdirSync(nodePath.join(proj, 'docs'))
    fs.writeFileSync(nodePath.join(proj, 'README.md'), '# My tool\nSet DISCORD_BOT_TOKEN= in your .env file.\n')
    fs.writeFileSync(nodePath.join(proj, 'docs/guide.md'), 'How to use it.\n')
    fs.writeFileSync(nodePath.join(proj, 'docs/oops.md'), 'my login: OBS_WS_PASSWORD=hunter2hunter2\n')  // someone pasted a real one
    fs.writeFileSync(nodePath.join(proj, 'dashboard.html'), '<html><body>live</body></html>')  // a web page the script serves
    fs.writeFileSync(nodePath.join(proj, 'lib/their_copy.py'), 'y = 2\n')
    fs.writeFileSync(nodePath.join(proj, '.gitignore'), '.env\n/lib/\nsetup-code.txt\n')
    fs.writeFileSync(nodePath.join(proj, 'setup-code.txt'), 'DISCORD_BOT_TOKEN=MTIzNDU2Nzg5MDEyMzQ1Njc4OQ\n')      // the project ignores it
    fs.writeFileSync(nodePath.join(proj, 'notes.txt'), 'OBS_WS_PASSWORD=hunter2hunter2\n')                         // it does not, but it is a password
    const f = nodePath.join(cfg, 'basic/scenes/Main.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    j.modules = { 'scripts-tool': [{ path: nodePath.join(proj, 'main.py'), settings: {} }] }
    fs.writeFileSync(f, JSON.stringify(j))
    return { home, cfg }
  }

  it('a script folder keeps its code and leaves out what it ignores itself and anything that holds a password', () => {
    const { home, cfg } = withProject()
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const kept = b.manifest.projects![0].files
    expect(kept.sort()).toEqual(['README.md', 'dashboard.html', 'docs/guide.md', 'main.py', 'requirements.txt', 'tools/helper.py'])
    for (const [name, data] of b.files) expect(data.toString('utf8'), name).not.toMatch(/MTIzNDU2Nzg5|hunter2/)
  })

  it('a profile file with a byte-order mark is still scrubbed (a stream key was published because it was not)', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const dir = nodePath.join(cfg, 'basic/profiles/Main')
    const multi = { targets: [{ name: 'YouTube', 'service-param': { key: 'live_REALSTREAMKEY_123456' } }] }
    fs.writeFileSync(nodePath.join(dir, 'obs-multi-rtmp.json'), '﻿' + JSON.stringify(multi))
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const f = [...b.files].find(([k]) => k.endsWith('obs-multi-rtmp.json'))!
    expect(f[1].toString('utf8')).not.toContain('REALSTREAMKEY')
    expect(f[1].toString('utf8')).toContain('{{var:')
    expect(b.manifest.variables.some((v) => /Multiple RTMP/.test(v.label ?? ''))).toBe(true)
  })

  it('spare copies, unreadable JSON and files that look like secrets are left out of a profile, with a word about it', () => {
    const home = nodePath.join(tmp, 'home'); const { cfg } = makeSource(home)
    const dir = nodePath.join(cfg, 'basic/profiles/Main')
    fs.writeFileSync(nodePath.join(dir, 'service.json.bak'), '{"settings":{"key":"live_REALSTREAMKEY_123456"}}')
    fs.writeFileSync(nodePath.join(dir, 'broken.json'), '{"key": "live_REALSTREAMKEY_123456", ')
    fs.writeFileSync(nodePath.join(dir, 'extra.ini'), '[Net]\nstream_key=live_REALSTREAMKEY_123456\n')
    fs.writeFileSync(nodePath.join(dir, 'harmless.ini'), '[View]\nzoom=2\n')
    const b = exportBundle({ host: host('linux', home), install: install(cfg), name: 'x' })
    const names = [...b.files.keys()]
    expect(names.some((n) => /service\.json\.bak|broken\.json|extra\.ini/.test(n))).toBe(false)
    expect(names.some((n) => n.endsWith('harmless.ini'))).toBe(true)
    for (const [name, data] of b.files) expect(data.toString('utf8'), name).not.toContain('REALSTREAMKEY')
  })
})
