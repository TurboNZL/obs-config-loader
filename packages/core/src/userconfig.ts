import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import { getIni, setIni } from './ini.js'

/**
 * Which scene layout and output settings OBS opens with. Since OBS 31 that is in `user.ini` (the old `global.ini` is only
 * copied from once, when OBS first upgrades); older OBS reads `global.ini`. Reading prefers `user.ini`; writing updates
 * every one of the two that exists (and `user.ini` alone for an OBS that has never run, because creating a `global.ini`
 * with no version in it makes a new OBS try to migrate it).
 */
export const ACTIVE_FILES = ['user.ini', 'global.ini'] as const

export interface Active { collection?: string; collectionFile?: string; profile?: string; profileDir?: string }

export function readActive(configDir: string): Active {
  for (const f of ACTIVE_FILES) {
    try {
      const t = fs.readFileSync(nodePath.join(configDir, f), 'utf8')
      const a: Active = {
        collection: getIni(t, 'Basic', 'SceneCollection'), collectionFile: getIni(t, 'Basic', 'SceneCollectionFile'),
        profile: getIni(t, 'Basic', 'Profile'), profileDir: getIni(t, 'Basic', 'ProfileDir'),
      }
      if (a.collectionFile || a.profileDir || a.collection || a.profile) return a
    } catch { /* not there */ }
  }
  return {}
}

/** Which of the two files to write for a settings folder (`join` is the path module of the machine the folder is on). */
export function activeTargets(configDir: string, join: (...p: string[]) => string = nodePath.join): string[] {
  const have = ACTIVE_FILES.map((f) => join(configDir, f)).filter((f) => fs.existsSync(f))
  return have.length ? have : [join(configDir, 'user.ini')]
}

/** The new text of one of those files with the given choices put in. */
export function withActive(text: string, a: Active): string {
  let t = text
  if (a.collection !== undefined) t = setIni(t, 'Basic', 'SceneCollection', a.collection)
  if (a.collectionFile !== undefined) t = setIni(t, 'Basic', 'SceneCollectionFile', a.collectionFile)
  if (a.profile !== undefined) t = setIni(t, 'Basic', 'Profile', a.profile)
  if (a.profileDir !== undefined) t = setIni(t, 'Basic', 'ProfileDir', a.profileDir)
  return t
}

/** After a rename inside an OBS settings folder: whatever points at the old name now points at the new one. */
export function renameActive(configDir: string, kind: 'collection' | 'profile', from: string, fromFile: string, to: string, toFile: string): void {
  for (const f of ACTIVE_FILES) {
    const g = nodePath.join(configDir, f)
    if (!fs.existsSync(g)) continue
    let t = fs.readFileSync(g, 'utf8')
    if (kind === 'collection') {
      if (getIni(t, 'Basic', 'SceneCollection') === from) t = setIni(t, 'Basic', 'SceneCollection', to)
      if (getIni(t, 'Basic', 'SceneCollectionFile') === fromFile) t = setIni(t, 'Basic', 'SceneCollectionFile', toFile)
    } else {
      if (getIni(t, 'Basic', 'Profile') === from) t = setIni(t, 'Basic', 'Profile', to)
      if (getIni(t, 'Basic', 'ProfileDir') === fromFile) t = setIni(t, 'Basic', 'ProfileDir', toFile)
    }
    fs.writeFileSync(g, t)
  }
}
