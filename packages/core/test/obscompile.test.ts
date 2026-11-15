import { describe, it, expect } from 'vitest'
import { compileSteps, parseCustomFlags, findBuildProblems, COMPILE_TOGGLES } from '../src/index.js'

describe('compiling OBS', () => {
  it('only offers switches that were read in OBS\'s own build files, never the deprecated one', () => {
    expect(COMPILE_TOGGLES.every((t) => t.source.length > 0)).toBe(true)
    expect(COMPILE_TOGGLES.some((t) => t.id === 'ENABLE_PLUGINS')).toBe(false)
  })
  it('builds the four steps with the preset for the system and the chosen switches', () => {
    const s = compileSteps({ platform: 'linux', srcDir: '/s', prefix: '/p', toggles: { ENABLE_PORTABLE_CONFIG: true, ENABLE_BROWSER: false, NOT_A_SWITCH: true }, custom: '-DENABLE_VST=ON' })
    expect(s.map((x) => x.id)).toEqual(['clone', 'configure', 'build', 'install'])
    expect(s[1].args).toEqual(['--preset', 'ubuntu', '-DCMAKE_BUILD_TYPE=RelWithDebInfo', '-DENABLE_PORTABLE_CONFIG=ON', '-DENABLE_BROWSER=OFF', '-DENABLE_VST=ON'])
    expect(s[3].args).toEqual(['--install', 'build_ubuntu', '--prefix', '/p'])
    expect(compileSteps({ platform: 'darwin', srcDir: '/s', prefix: '/p' })[1].args[1]).toBe('macos')
  })
  it('a portable-only switch is not offered on a Mac', () => {
    const s = compileSteps({ platform: 'darwin', srcDir: '/s', prefix: '/p', toggles: { ENABLE_PORTABLE_CONFIG: true } })
    expect(s[1].args.join(' ')).not.toContain('ENABLE_PORTABLE_CONFIG')
  })
  it('refuses anything but plain -D flags in the typed line', () => {
    const r = parseCustomFlags('-DFOO=bar "-DBAZ=1" ; rm -rf / -DX=$(id) -Wno-dev')
    expect(r.flags).toEqual(['-DFOO=bar', '-DBAZ=1', '-Wno-dev'])
    expect(r.refused).toEqual(expect.arrayContaining([';', 'rm', '-rf', '/', '-DX=$(id)']))
  })
  it('picks the problem lines out of build output', () => {
    expect(findBuildProblems('ok\nCMake Error at x\n  Could NOT find Qt6\nfoo.c:1:1: fatal error: a.h: No such file')).toHaveLength(3)
  })
})
