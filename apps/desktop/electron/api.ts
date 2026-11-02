import type { ImportReport, ObsInstall, Manifest, ConflictMode, PluginFinding, RepoStatus, LogEntry, PullResult, PushResult, AssetNeed, GithubRepo, GitInstallHelp, InstanceSupport } from '@obs-config-loader/core'

/** What the renderer may ask of the main process. One place, so both sides agree. */
export interface InstallInfo extends ObsInstall {
  running: boolean
  /** For a separate OBS: what it is made from. */
  baseLabel?: string
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
  /** Put back OBS's remote-control (WebSocket) settings when the setup has them. Default yes. */
  websocket?: boolean
  /** This load's own choice per source id: a stand-in id, or null to hide the source. */
  sourceChoices?: Record<string, string | null>
}

export interface ExportRequest {
  installId: string
  name: string
  collections: string[]
  profiles: string[]
  media: 'small' | 'all' | 'none'
  /** Put the stream keys inside the file (clearly labelled). Off unless the person asks. */
  includeKeys?: boolean
  format?: 'file' | 'folder'
  /** Big files the person chose to put inside the file (by id, from `obs.scan`). */
  alsoBundle?: string[]
  /** Things left out (names as OBS has them). */
  exclude?: { collections?: string[]; profiles?: string[]; remoteControl?: boolean; scripts?: boolean }
  /** Where the setup is kept online, to write into the file (no password in it). */
  repository?: string
}

export interface FileChoice { id: string; filename: string; size: number; available: boolean; auto: boolean }
export interface ObsScan { files: FileChoice[]; scripts: string[]; remoteControl: boolean; keys: string[] }

export interface ExportResult {
  path: string
  sizeBytes: number
  collections: number
  profiles: number
  assets: { bundled: number; external: number }
  /** True when the file carries stream keys inside. */
  containsSecrets: boolean
  /** What the person will be asked to type again when loading, in words they recognise (empty when keys are inside). */
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

export type UpdateState = {
  status: 'idle' | 'disabled' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  version?: string; percent?: number; message?: string; installing?: boolean
  /** What to run in a terminal when the app could not install the update itself. */
  command?: string
}

export interface GitState { available: boolean; help: GitInstallHelp; platform: string }
export interface GithubState { connected: boolean; login?: string; /** Token is kept for this session only (no system keychain). */ sessionOnly?: boolean }
export type Done<T> = ({ ok: true } & T) | { ok: false; error: string; cancelled?: boolean }

/** Extra facts about a save that went through. */
export interface SaveExtras { keysRemembered?: number; upload?: 'uploaded' | 'failed'; uploadError?: string }
export type SaveResult =
  | ({ status: 'unchanged' } & SaveExtras)
  | ({ status: 'committed'; files: string[]; commit: string; merged: boolean } & SaveExtras)
  | { status: 'conflict'; conflicts: string[] }
  | { status: 'dirty'; files: string[] }
  | { status: 'error'; message: string }

export type SaveConflictChoice = 'abort' | 'keep-repo' | 'keep-obs'
export type PullConflictChoice = 'abort' | 'keep-mine' | 'keep-theirs'

export interface AppSettings { presetsRoot: string; defaultPresetsRoot: string; isDefault: boolean; rememberKeys: boolean; canStoreKeys: boolean }
export interface TranslationRow {
  from: string
  name: string
  targets: { platform: 'win32' | 'darwin' | 'linux'; label: string; default: string | null; defaultName: string | null; chosen: string | null | undefined; options: { id: string; name: string }[] }[]
}
export interface PresetDetails {
  exclude: { collections?: string[]; profiles?: string[]; remoteControl?: boolean; scripts?: boolean }
  translations: TranslationRow[]
  savedWithObs?: string
  plugins: { name: string; version?: string; known: boolean }[]
  scripts: string[]
  remoteControl: boolean
  layouts: { id: string; name: string; scenes: string[]; sources: string[] }[]
  outputs: { id: string; name: string }[]
}
export interface RenameRequest { path: string; installId?: string; kind: 'preset' | 'layout' | 'output' | 'scene'; id?: string; layoutId?: string; from?: string; to: string }

export interface Locations { assets: Record<string, string>; variables: Record<string, string> }

export type { ImportReport, ConflictMode, PluginFinding, RepoStatus, LogEntry, PullResult, PushResult, AssetNeed, GithubRepo, GitInstallHelp }

export interface Api {
  platform: 'win32' | 'darwin' | 'linux'
  installs: {
    list(): Promise<InstallInfo[]>
    /** Start this OBS (any install that has a known way to start it). */
    launch(id: string): Promise<{ ok: boolean; message: string; command?: string }>
    /** After a start (at time `since`, ms): has this OBS written to its own settings folder since? (A separate OBS that has not is using the main settings.) */
    verify(id: string, since: number): Promise<{ usesOwnSettings: boolean }>
    addPortable(): Promise<{ added?: InstallInfo; error?: string; cancelled?: boolean }>
    remove(id: string): Promise<void>
    openFolder(id: string): Promise<void>
  }
  instances: {
    /** Whether a separate OBS can be made from this install, and if not, why. */
    support(baseId: string, name?: string): Promise<InstanceSupport>
    create(r: { baseId: string; name: string; copySettings: boolean }): Promise<Done<{ install: InstallInfo }>>
    remove(id: string, deleteFiles: boolean): Promise<void>
    openPlugins(id: string): Promise<void>
  }
  bundle: {
    open(): Promise<BundleSummary | { error: string } | null>
    openFolder(): Promise<BundleSummary | { error: string } | null>
    openPath(path: string): Promise<BundleSummary | { error: string }>
    /** The preset this computer already has for an opened file (same setup), if any. */
    existing(handle: string): Promise<RepoInfo | null>
    /** Fetch the latest version from the address the file carries (or get updates for the preset we have). */
    latest(handle: string): Promise<Done<{ path: string; how: 'updated' | 'up-to-date' | 'downloaded' }>>
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
    create(r: { installId: string; name: string; folder: string; github?: { private: boolean }; exclude?: ExportRequest['exclude'] }): Promise<Done<{ repo: RepoInfo; published?: string; remoteUrl?: string }>>
    /** Ask the online copy what is new (so counts are true), then the preset's current state. */
    check(path: string): Promise<{ ok: boolean; message?: string; repo: RepoInfo }>
    fromBundle(handle: string, folder: string, installId?: string): Promise<Done<{ repo: RepoInfo }>>
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
  obs: { scan(installId: string): Promise<ObsScan> }
  settings: {
    get(): Promise<AppSettings>
    setPresetsRoot(path: string | null): Promise<void>
    setRememberKeys(on: boolean): Promise<void>
  }
  presets: {
    details(path: string): Promise<PresetDetails>
    keys(path: string): Promise<{ count: number; canStore: boolean }>
    exportFile(path: string, includeKeys: boolean, alsoBundle?: string[]): Promise<Done<{ path: string; keys: number; missingMedia: string[] }>>
    scanFile(path: string): Promise<FileChoice[]>
    setExclude(path: string, exclude: NonNullable<ExportRequest['exclude']>): Promise<Done<object>>
    setOverrides(path: string, overrides: Record<string, Record<string, string | null>>): Promise<Done<object>>
    move(path: string, parentFolder: string): Promise<Done<{ repo: RepoInfo }>>
    rename(r: RenameRequest): Promise<Done<{ alsoInObs: boolean }>>
    setOnline(path: string, on: boolean, name: string, priv: boolean): Promise<Done<{ url?: string; needsAccount?: boolean }>>
  }
  locations: {
    load(bundleId: string): Promise<Locations>
    save(bundleId: string, l: Locations): Promise<void>
  }
  files: {
    pick(title: string, folder?: boolean): Promise<string | null>
    /** Show a file in the system's file manager. */
    reveal(path: string): Promise<void>
  }
  secrets: {
    load(bundleId: string): Promise<Record<string, string>>
    save(bundleId: string, values: Record<string, string>): Promise<boolean>
  }
  updates: {
    state(): Promise<UpdateState>
    check(): Promise<UpdateState>
    install(): Promise<void>
    onState(cb: (s: UpdateState) => void): () => void
  }
  window: {
    /** Draw the title bar with the theme instead of the system's (takes effect after a restart). */
    frame(): Promise<{ custom: boolean; platform: string }>
    setCustomFrame(on: boolean): Promise<void>
    control(action: 'minimize' | 'maximize' | 'close'): Promise<void>
    onState(cb: (maximized: boolean) => void): () => void
    restart(): Promise<void>
  }
  app: { version(): Promise<string>; openExternal(url: string): Promise<void> }
  /** Real path of a dropped file (the renderer has no other way to get it). */
  pathForFile(f: File): string
}

declare global {
  interface Window { obsLoader: Api }
}
