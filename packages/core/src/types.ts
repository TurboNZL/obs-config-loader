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
  /** The secret itself. Present ONLY when the manifest says `containsSecrets` (the person exporting chose to include keys). */
  value?: string
}

export type AssetMode = 'bundled' | 'external'
export type AssetRole = 'image' | 'video' | 'audio' | 'font' | 'script' | 'other'

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
  /** Newest version any computer saved this setup with (when it could be told). */
  version?: string
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
  /** Newest OBS version any computer saved this setup with. Only ever goes up. */
  savedWithObs?: string
  /** True when this file carries stream keys / secrets inside (`variables[].value`). Such a file must be treated like a password. */
  containsSecrets?: boolean
  /** Plain-words warning shown wherever the file is opened; set together with `containsSecrets`. */
  warning?: string
  collections: CollectionRef[]
  profiles: ProfileRef[]
  activeCollection?: string
  activeProfile?: string
  variables: Variable[]
  assets: Asset[]
  plugins: PluginRef[]
  platformMap: PlatformMapEntry[]
  /**
   * The person's own choices for how a source is translated on another system (kept as they are, never rewritten by a
   * save): `{ "<source id>": { "<win32|darwin|linux|linux-pipewire>": "<id to use>" | null (hide it) } }`.
   * They win over the built-in table.
   */
  platformOverrides?: Record<string, Partial<Record<Platform | 'linux-pipewire', string | null>>>
  /** What this preset leaves out when saving from OBS (names as OBS has them). Everything else in OBS is kept. */
  exclude?: { collections?: string[]; profiles?: string[]; remoteControl?: boolean; scripts?: boolean }
  /** Unknown fields are kept so a re-write does not lose them. */
  [extra: string]: unknown
}

/** A bundle in memory: manifest + every other file by its path inside the bundle. */
export interface Bundle {
  manifest: Manifest
  files: Map<string, Buffer>
}
