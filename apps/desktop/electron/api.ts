import type { ImportReport, ObsInstall, Manifest, ConflictMode, PluginFinding } from '@obs-config-loader/core'

/** What the renderer may ask of the main process. One place, so both sides agree. */
export interface InstallInfo extends ObsInstall {
  running: boolean
  collections: string[]
  profiles: string[]
}

export interface BundleSummary {
  handle: string
  manifest: Manifest
  source: string
  mediaFiles: number
}

export interface ImportRequest {
  handle: string
  installId: string
  collections: string[]
  profiles: string[]
  variables: Record<string, string>
  assetFiles: Record<string, string>
  conflict: ConflictMode
  activate: boolean
  preferPipewire: boolean
}

export interface ExportRequest {
  installId: string
  name: string
  collections: string[]
  profiles: string[]
  media: 'small' | 'all' | 'none'
  format: 'file' | 'folder'
}

export interface ExportResult {
  path: string
  collections: number
  profiles: number
  assets: { bundled: number; external: number }
  secrets: string[]
  plugins: string[]
  warnings: string[]
}

export type { ImportReport, ConflictMode, PluginFinding }

export interface Api {
  platform: 'win32' | 'darwin' | 'linux'
  installs: {
    list(): Promise<InstallInfo[]>
    addPortable(): Promise<{ added?: InstallInfo; error?: string; cancelled?: boolean }>
    remove(id: string): Promise<void>
    openFolder(id: string): Promise<void>
  }
  bundle: {
    open(): Promise<BundleSummary | { error: string } | null>
    openFolder(): Promise<BundleSummary | { error: string } | null>
    openPath(path: string): Promise<BundleSummary | { error: string }>
  }
  import: {
    plan(r: ImportRequest): Promise<ImportReport>
    apply(r: ImportRequest): Promise<{ written: number; backedUp: number; backupDir: string }>
  }
  export: {
    run(r: ExportRequest): Promise<ExportResult | { error: string } | null>
  }
  files: {
    pick(title: string, folder?: boolean): Promise<string | null>
  }
  secrets: {
    load(bundleId: string): Promise<Record<string, string>>
    save(bundleId: string, values: Record<string, string>): Promise<boolean>
  }
  app: { version(): Promise<string>; openExternal(url: string): Promise<void> }
  /** Real path of a dropped file (the renderer has no other way to get it). */
  pathForFile(f: File): string
}

declare global {
  interface Window { obsLoader: Api }
}
