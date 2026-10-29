import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from './api'

const call = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: Api = {
  platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
  installs: {
    list: () => call('installs:list'),
    addPortable: () => call('installs:addPortable'),
    remove: (id) => call('installs:remove', id),
    openFolder: (id) => call('installs:openFolder', id),
  },
  bundle: {
    open: () => call('bundle:open'),
    openFolder: () => call('bundle:openFolder'),
    openPath: (p) => call('bundle:openPath', p),
  },
  import: {
    plan: (r) => call('import:plan', r),
    apply: (r) => call('import:apply', r),
  },
  export: { run: (r) => call('export:run', r) },
  repos: {
    list: () => call('repos:list'),
    addExisting: () => call('repos:addExisting'),
    clone: (url) => call('repos:clone', url),
    create: (installId, name) => call('repos:create', installId, name),
    remove: (p) => call('repos:remove', p),
    setInstall: (p, i) => call('repos:setInstall', p, i),
    live: (p, i) => call('repos:live', p, i),
    save: (p, i, c) => call('repos:save', p, i, c),
    pull: (p) => call('repos:pull', p),
    push: (p) => call('repos:push', p),
    log: (p) => call('repos:log', p),
    needs: (p) => call('repos:needs', p),
    setAsset: (p, a, f) => call('repos:setAsset', p, a, f),
  },
  locations: {
    load: (id) => call('locations:load', id),
    save: (id, l) => call('locations:save', id, l),
  },
  files: { pick: (title, folder) => call('files:pick', title, folder) },
  secrets: {
    load: (id) => call('secrets:load', id),
    save: (id, v) => call('secrets:save', id, v),
  },
  app: {
    version: () => call('app:version'),
    openExternal: (u) => call('app:openExternal', u),
  },
  pathForFile: (f) => webUtils.getPathForFile(f),
}

contextBridge.exposeInMainWorld('obsLoader', api)
