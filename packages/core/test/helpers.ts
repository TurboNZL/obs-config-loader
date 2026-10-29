import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type { Host, ObsInstall, Platform } from '../src/index.js'

export function host(platform: Platform, home: string): Host {
  return {
    platform, home, env: {},
    exists: (p) => fs.existsSync(p),
    isDir: (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } },
    listDir: (p) => { try { return fs.readdirSync(p) } catch { return [] } },
  }
}

export function install(configDir: string): ObsInstall {
  return { id: 'x', kind: 'linux-native', label: 't', platform: 'linux', configDir, pluginDirs: [nodePath.join(configDir, 'plugins')], configExists: true }
}

/** A small but realistic OBS config dir. */
export function makeSource(home: string) {
  const cfg = nodePath.join(home, '.config', 'obs-studio')
  const media = nodePath.join(home, 'Pictures', 'overlay.png')
  const big = nodePath.join(home, 'Music', 'mix.mp3')
  fs.mkdirSync(nodePath.dirname(media), { recursive: true })
  fs.mkdirSync(nodePath.dirname(big), { recursive: true })
  fs.writeFileSync(media, Buffer.from('PNGDATA'))
  fs.writeFileSync(big, Buffer.alloc(6 * 1024 * 1024, 1))
  const scenes = nodePath.join(cfg, 'basic', 'scenes')
  const prof = nodePath.join(cfg, 'basic', 'profiles', 'Main')
  fs.mkdirSync(scenes, { recursive: true })
  fs.mkdirSync(prof, { recursive: true })
  fs.writeFileSync(nodePath.join(scenes, 'Main.json'), JSON.stringify({
    name: 'Main',
    current_scene: 'Scene',
    sources: [
      { id: 'scene', name: 'Scene', uuid: 'u-scene', settings: { items: [
        { name: 'Window', source_uuid: 'u-win', visible: true },
        { name: 'Overlay', source_uuid: 'u-img', visible: true },
        { name: 'Chat', visible: true },
      ] } },
      { id: 'xcomposite_input', name: 'Window', uuid: 'u-win', settings: { capture_window: '0x123' } },
      { id: 'image_source', name: 'Overlay', uuid: 'u-img', settings: { file: media } },
      { id: 'ffmpeg_source', name: 'Music', uuid: 'u-mus', settings: { local_file: big } },
      { id: 'browser_source', name: 'Chat', uuid: 'u-chat', settings: { url: 'https://example.com/chat?x={{y}}', css: 'a{}' } },
      { id: 'text_ft2_source_v2', name: 'T', uuid: 'u-t', settings: { text: '/me waves' } },
      { id: 'pipewire_audio_application_capture', name: 'Game audio', uuid: 'u-pw', settings: {} },
    ],
  }, null, 4))
  fs.writeFileSync(nodePath.join(prof, 'basic.ini'), `[General]\nName=Main\n\n[SimpleOutput]\nFilePath=${nodePath.join(home, 'Videos')}\nStreamEncoder=x264\n`)
  fs.writeFileSync(nodePath.join(prof, 'service.json'), JSON.stringify({ type: 'rtmp_common', settings: { service: 'Twitch', server: 'auto', key: 'live_SECRET123' } }))
  fs.writeFileSync(nodePath.join(prof, 'obs-multi-rtmp.json'), JSON.stringify({ targets: [{ name: 'YT', 'service-param': { server: 'rtmp://a', key: 'yt-SECRET456' } }] }))
  fs.writeFileSync(nodePath.join(cfg, 'global.ini'), '[General]\nFirstRun=true\n\n[Basic]\nProfile=Main\nProfileDir=Main\nSceneCollection=Main\nSceneCollectionFile=Main\n')
  return { cfg, media, big }
}

