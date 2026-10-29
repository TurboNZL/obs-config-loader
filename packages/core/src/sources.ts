import type { Platform, PlatformMapEntry } from './types.js'

/**
 * Source ids that exist only on some platforms. Checked against OBS Studio's own source
 * (plugins/win-capture, win-wasapi, win-dshow, linux-capture, linux-pipewire, linux-pulseaudio,
 * linux-v4l2, linux-alsa, mac-capture, mac-avcapture) on 2026-10-29. Only ids listed here are ever
 * substituted or disabled; an id that is not listed is assumed to work (or to be a plugin).
 */
export const SOURCE_PLATFORMS: Record<string, Platform[]> = {
  // video capture
  window_capture: ['win32'],
  monitor_capture: ['win32'],
  game_capture: ['win32'],
  dshow_input: ['win32'],
  xcomposite_input: ['linux'],
  xshm_input: ['linux'],
  xshm_input_v2: ['linux'],
  v4l2_input: ['linux'],
  'pipewire-desktop-capture-source': ['linux'],
  'pipewire-window-capture-source': ['linux'],
  'pipewire-screen-capture-source': ['linux'],
  'pipewire-camera-source': ['linux'],
  display_capture: ['darwin'],
  screen_capture: ['darwin'],
  'macos-avcapture': ['darwin'],
  'macos-avcapture-fast': ['darwin'],
  'syphon-input': ['darwin'],
  text_gdiplus: ['win32'],
  // audio capture
  wasapi_input_capture: ['win32'],
  wasapi_output_capture: ['win32'],
  wasapi_process_output_capture: ['win32'],
  pulse_input_capture: ['linux'],
  pulse_output_capture: ['linux'],
  alsa_input_capture: ['linux'],
  coreaudio_input_capture: ['darwin'],
  coreaudio_output_capture: ['darwin'],
  sck_audio_capture: ['darwin'],
}

/** What may stand in for each platform-specific source on another platform (first available wins). */
export const DEFAULT_PLATFORM_MAP: PlatformMapEntry[] = [
  {
    from: 'window_capture',
    to: { darwin: 'screen_capture', linux: 'xcomposite_input', 'linux-pipewire': 'pipewire-window-capture-source' },
    note: 'The window choice cannot be translated; pick the window again.',
  },
  {
    from: 'monitor_capture',
    to: { darwin: 'display_capture', linux: 'xshm_input_v2', 'linux-pipewire': 'pipewire-desktop-capture-source' },
    note: 'Pick the display again.',
  },
  {
    from: 'display_capture',
    to: { win32: 'monitor_capture', linux: 'xshm_input_v2', 'linux-pipewire': 'pipewire-desktop-capture-source' },
    note: 'Pick the display again.',
  },
  {
    from: 'xcomposite_input',
    to: { win32: 'window_capture', darwin: 'screen_capture', 'linux-pipewire': 'pipewire-window-capture-source' },
    note: 'Pick the window again.',
  },
  {
    from: 'xshm_input',
    to: { win32: 'monitor_capture', darwin: 'display_capture', 'linux-pipewire': 'pipewire-desktop-capture-source' },
    note: 'Pick the display again.',
  },
  {
    from: 'xshm_input_v2',
    to: { win32: 'monitor_capture', darwin: 'display_capture', 'linux-pipewire': 'pipewire-desktop-capture-source' },
    note: 'Pick the display again.',
  },
  {
    from: 'pipewire-window-capture-source',
    to: { win32: 'window_capture', darwin: 'screen_capture', linux: 'xcomposite_input' },
    note: 'Pick the window again.',
  },
  {
    from: 'pipewire-desktop-capture-source',
    to: { win32: 'monitor_capture', darwin: 'display_capture', linux: 'xshm_input_v2' },
    note: 'Pick the display again.',
  },
  {
    from: 'pipewire-screen-capture-source',
    to: { win32: 'monitor_capture', darwin: 'display_capture', linux: 'xshm_input_v2' },
    note: 'Pick the display again.',
  },
  {
    from: 'text_gdiplus',
    to: { darwin: 'text_ft2_source', linux: 'text_ft2_source' },
    note: 'Text appearance settings differ between the two text sources; check the font and colour.',
  },
  {
    from: 'wasapi_input_capture',
    to: { darwin: 'coreaudio_input_capture', linux: 'pulse_input_capture' },
    note: 'Pick the audio device again.',
  },
  {
    from: 'wasapi_output_capture',
    to: { darwin: 'coreaudio_output_capture', linux: 'pulse_output_capture' },
    note: 'Pick the audio device again.',
  },
  {
    from: 'pulse_input_capture',
    to: { win32: 'wasapi_input_capture', darwin: 'coreaudio_input_capture' },
    note: 'Pick the audio device again.',
  },
  {
    from: 'pulse_output_capture',
    to: { win32: 'wasapi_output_capture', darwin: 'coreaudio_output_capture' },
    note: 'Pick the audio device again.',
  },
  {
    from: 'coreaudio_input_capture',
    to: { win32: 'wasapi_input_capture', linux: 'pulse_input_capture' },
    note: 'Pick the audio device again.',
  },
  {
    from: 'coreaudio_output_capture',
    to: { win32: 'wasapi_output_capture', linux: 'pulse_output_capture' },
    note: 'Pick the audio device again.',
  },
]

/** Source ids OBS ships on every platform. Anything not here, and not platform-specific above, is "unknown". */
export const CROSS_PLATFORM_BUILTIN_SOURCES = new Set([
  'scene', 'group', 'image_source', 'slideshow', 'color_source', 'ffmpeg_source', 'browser_source',
  'text_ft2_source', 'vlc_source',
])

export function isPlatformSpecific(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOURCE_PLATFORMS, id)
}

/** Does this source id work on the platform (true for ids we do not know to be platform-specific)? */
export function availableOn(id: string, platform: Platform): boolean {
  const p = SOURCE_PLATFORMS[id]
  return !p || p.includes(platform)
}
