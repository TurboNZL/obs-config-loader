import type { ImportReport, ObsInstall, Manifest, ConflictMode, PluginFinding, RepoStatus, LogEntry, PullResult, PushResult, AssetNeed } from '@obs-config-loader/core'

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
  /** Set when the bundle is a git repository folder (so the import page can check for unsaved live changes). */
  repoDir?: string
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

export interface RepoInfo {
  path: string
  name: string
  /** OBS install this repo is saved from / applied to on this computer. */
  installId?: string
  status: RepoStatus
}

export type SaveResult =
  | { status: 'unchanged' }
  | { status: 'committed'; files: string[]; commit: string; merged: boolean }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'dirty'; files: string[] }
  | { status: 'error'; message: string }

export interface Locations { assets: Record<string, string>; variables: Record<string, string> }

export type { ImportReport, ConflictMode, PluginFinding, RepoStatus, LogEntry, PullResult, PushResult, AssetNeed }

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
  repos: {
    list(): Promise<RepoInfo[]>
    addExisting(): Promise<{ added?: RepoInfo; error?: string; cancelled?: boolean }>
    clone(url: string): Promise<{ added?: RepoInfo; error?: string; cancelled?: boolean }>
    create(installId: string, name: string): Promise<{ added?: RepoInfo; error?: string; cancelled?: boolean }>
    remove(path: string): Promise<void>
    setInstall(path: string, installId: string): Promise<void>
    /** What OBS has changed since the last save (dry run). */
    live(path: string, installId: string): Promise<{ changed: string[] } | { error: string }>
    save(path: string, installId: string, commitDirtyFirst: boolean): Promise<SaveResult>
    pull(path: string): Promise<PullResult>
    push(path: string): Promise<PushResult>
    log(path: string): Promise<LogEntry[]>
    needs(path: string): Promise<AssetNeed[]>
    setAsset(path: string, assetId: string, file: string): Promise<void>
  }
  locations: {
    load(bundleId: string): Promise<Locations>
    save(bundleId: string, l: Locations): Promise<void>
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
