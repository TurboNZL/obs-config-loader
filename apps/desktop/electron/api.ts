import type { ImportReport, ObsInstall, Manifest, ConflictMode, PluginFinding, RepoStatus, LogEntry, PullResult, PushResult, AssetNeed, GithubRepo, GitInstallHelp } from '@obs-config-loader/core'

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
  /** Address of `origin`, if any. */
  remoteUrl?: string
  /** OBS install this repo is saved from / applied to on this computer. */
  installId?: string
  status: RepoStatus
}

export interface GitState { available: boolean; help: GitInstallHelp; platform: string }
export interface GithubState { connected: boolean; login?: string; /** Token is kept for this session only (no system keychain). */ sessionOnly?: boolean }
export type Done<T> = ({ ok: true } & T) | { ok: false; error: string; cancelled?: boolean }

export type SaveResult =
  | { status: 'unchanged' }
  | { status: 'committed'; files: string[]; commit: string; merged: boolean }
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'dirty'; files: string[] }
  | { status: 'error'; message: string }

export type SaveConflictChoice = 'abort' | 'keep-repo' | 'keep-obs'
export type PullConflictChoice = 'abort' | 'keep-mine' | 'keep-theirs'

export interface Locations { assets: Record<string, string>; variables: Record<string, string> }

export type { ImportReport, ConflictMode, PluginFinding, RepoStatus, LogEntry, PullResult, PushResult, AssetNeed, GithubRepo, GitInstallHelp }

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
  git: {
    state(): Promise<GitState>
    /** Runs the platform's installer route. Always followed by state() to see whether it worked. */
    install(): Promise<{ ok: boolean; message: string }>
  }
  github: {
    state(): Promise<GithubState>
    tokenUrl: string
    connect(token: string): Promise<Done<{ login: string; sessionOnly: boolean }>>
    disconnect(): Promise<void>
    repos(): Promise<Done<{ repos: GithubRepo[] }>>
  }
  repos: {
    list(): Promise<RepoInfo[]>
    /** A suggested empty folder for a new or cloned repository (under Documents), never one that is in use. */
    suggestFolder(name: string): Promise<string>
    addExisting(): Promise<Done<{ repo: RepoInfo }>>
    clone(url: string, folder: string): Promise<Done<{ repo: RepoInfo }>>
    create(r: { installId: string; name: string; folder: string; github?: { private: boolean } }): Promise<Done<{ repo: RepoInfo; published?: string }>>
    fromBundle(handle: string, folder: string): Promise<Done<{ repo: RepoInfo }>>
    remove(path: string): Promise<void>
    setInstall(path: string, installId: string): Promise<void>
    setRemote(path: string, url: string): Promise<Done<object>>
    publish(path: string, name: string, priv: boolean): Promise<Done<{ url: string; pushed: boolean }>>
    /** What OBS has changed since the last save (dry run). */
    live(path: string, installId: string): Promise<{ changed: string[] } | { error: string }>
    save(path: string, installId: string, commitDirtyFirst: boolean, onConflict?: SaveConflictChoice): Promise<SaveResult>
    pull(path: string, onConflict?: PullConflictChoice): Promise<PullResult>
    push(path: string): Promise<PushResult>
    log(path: string): Promise<LogEntry[]>
    needs(path: string): Promise<AssetNeed[]>
    setAsset(path: string, assetId: string, file: string): Promise<void>
    openFolder(path: string): Promise<void>
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
