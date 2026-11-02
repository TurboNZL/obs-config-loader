import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from './api'

const call = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: Api = {
  platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
  installs: {
    list: () => call('installs:list'),
    addPortable: () => call('installs:addPortable'),
    remove: (id) => call('installs:remove', id),
    launch: (id) => call('installs:launch', id),
    verify: (id, since) => call('installs:verify', id, since),
    openFolder: (id) => call('installs:openFolder', id),
  },
  instances: {
    support: (b, n) => call('instances:support', b, n),
    create: (r) => call('instances:create', r),
    remove: (id, del) => call('instances:remove', id, del),
    openPlugins: (id) => call('instances:openPlugins', id),
  },
  bundle: {
    open: () => call('bundle:open'),
    openFolder: () => call('bundle:openFolder'),
    openPath: (p) => call('bundle:openPath', p),
    existing: (h) => call('bundle:existing', h),
    latest: (h) => call('bundle:latest', h),
  },
  import: {
    plan: (r) => call('import:plan', r),
    apply: (r) => call('import:apply', r),
  },
  export: { run: (r) => call('export:run', r) },
  git: {
    state: () => call('git:state'),
    install: () => call('git:install'),
  },
  github: {
    state: () => call('github:state'),
    tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo&description=OBS%20Config%20Loader',
    connect: (t) => call('github:connect', t),
    disconnect: () => call('github:disconnect'),
    repos: () => call('github:repos'),
  },
  repos: {
    list: () => call('repos:list'),
    suggestFolder: (n) => call('repos:suggestFolder', n),
    addExisting: () => call('repos:addExisting'),
    clone: (url, folder) => call('repos:clone', url, folder),
    create: (r) => call('repos:create', r),
    fromBundle: (h, f, i) => call('repos:fromBundle', h, f, i),
    check: (p) => call('repos:check', p),
    remove: (p) => call('repos:remove', p),
    setInstall: (p, i) => call('repos:setInstall', p, i),
    setRemote: (p, u) => call('repos:setRemote', p, u),
    publish: (p, n, priv) => call('repos:publish', p, n, priv),
    live: (p, i) => call('repos:live', p, i),
    save: (p, i, c, o) => call('repos:save', p, i, c, o),
    pull: (p, o) => call('repos:pull', p, o),
    push: (p) => call('repos:push', p),
    log: (p) => call('repos:log', p),
    needs: (p) => call('repos:needs', p),
    setAsset: (p, a, f) => call('repos:setAsset', p, a, f),
    openFolder: (p) => call('repos:openFolder', p),
  },
  obs: { scan: (id) => call('obs:scan', id) },
  settings: {
    get: () => call('settings:get'),
    setPresetsRoot: (p) => call('settings:setPresetsRoot', p),
    setRememberKeys: (on) => call('settings:setRememberKeys', on),
  },
  presets: {
    details: (p) => call('presets:details', p),
    keys: (p) => call('presets:keys', p),
    exportFile: (p, k, a) => call('presets:exportFile', p, k, a),
    scanFile: (p) => call('presets:scanFile', p),
    setExclude: (p, e) => call('presets:setExclude', p, e),
    setOverrides: (p, o) => call('presets:setOverrides', p, o),
    move: (p, parent) => call('presets:move', p, parent),
    rename: (r) => call('presets:rename', r),
    setOnline: (p, on, n, priv) => call('presets:setOnline', p, on, n, priv),
  },
  locations: {
    load: (id) => call('locations:load', id),
    save: (id, l) => call('locations:save', id, l),
  },
  files: { pick: (title, folder) => call('files:pick', title, folder), reveal: (p) => call('files:reveal', p) },
  secrets: {
    load: (id) => call('secrets:load', id),
    save: (id, v) => call('secrets:save', id, v),
  },
  updates: {
    state: () => call('updates:state'),
    check: () => call('updates:check'),
    install: () => call('updates:install'),
    onState: (cb) => {
      const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
      ipcRenderer.on('updates:state', h)
      return () => { ipcRenderer.removeListener('updates:state', h) }
    },
  },
  window: {
    frame: () => call('window:frame'),
    setCustomFrame: (on) => call('window:setCustomFrame', on),
    control: (a) => call('window:control', a),
    onState: (cb) => {
      const h = (_e: unknown, m: boolean) => cb(m)
      ipcRenderer.on('window:state', h)
      return () => { ipcRenderer.removeListener('window:state', h) }
    },
    restart: () => call('window:restart'),
  },
  app: {
    version: () => call('app:version'),
    openExternal: (u) => call('app:openExternal', u),
  },
  pathForFile: (f) => webUtils.getPathForFile(f),
}

contextBridge.exposeInMainWorld('obsLoader', api)
