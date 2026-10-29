export const FORMAT = 'obs-config-bundle'
export const FORMAT_VERSION = 1

export type Platform = 'win32' | 'darwin' | 'linux'

export type VariableKind = 'secret' | 'path' | 'url' | 'text' | 'number' | 'bool'

export interface Variable {
  name: string
  kind: VariableKind
  label?: string
  default?: string
  required?: boolean
  /** Where the value goes, e.g. "profiles/main/service.json#settings.key" (informational). */
  target?: string
}

export type AssetMode = 'bundled' | 'external'
export type AssetRole = 'image' | 'video' | 'audio' | 'font' | 'other'

export interface Asset {
  id: string
  filename: string
  role?: AssetRole
  mode: AssetMode
  sha256?: string
  size?: number
  hint?: string
}

export interface PluginProvides {
  kind: 'source' | 'filter' | 'output' | 'service' | 'encoder' | 'module'
  id: string
}

export interface PluginRef {
  id: string
  name: string
  provides: PluginProvides[]
  required?: boolean
  homepage?: string
  install?: Partial<Record<'linux-flatpak' | 'linux-native' | 'windows' | 'macos', string>>
}

export interface PlatformMapEntry {
  from: string
  to: Partial<Record<Platform | 'linux-pipewire', string>>
  note?: string
}

export interface CollectionRef { id: string; name: string; file: string }
export interface ProfileRef { id: string; name: string; dir: string }

export interface Manifest {
  format: typeof FORMAT
  version: number
  id: string
  name: string
  description?: string
  revision?: number
  exportedAt?: string
  generator?: { name: string; version: string }
  source?: { platform?: Platform; obsVersion?: string }
  obsMinVersion?: string
  collections: CollectionRef[]
  profiles: ProfileRef[]
  activeCollection?: string
  activeProfile?: string
  variables: Variable[]
  assets: Asset[]
  plugins: PluginRef[]
  platformMap: PlatformMapEntry[]
  /** Unknown fields are kept so a re-write does not lose them. */
  [extra: string]: unknown
}

/** A bundle in memory: manifest + every other file by its path inside the bundle. */
export interface Bundle {
  manifest: Manifest
  files: Map<string, Buffer>
}
