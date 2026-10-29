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
