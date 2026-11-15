/**
 * The screens an installer or manager script describes (docs/SCRIPT_UI.md). A script prints one JSON object per line, each starting
 * with `@@obscl `, and reads the answers the same way on its standard input. This file is the app's side of that conversation:
 * parsing the lines and building the replies. The drawing is done by the app's own screens, so a script never styles anything.
 */
export const SCRIPT_UI_PREFIX = '@@obscl '

export type ScriptBlock =
  | { k: 'text'; text: string; style?: 'body' | 'sub' | 'hint'; id?: string }
  | { k: 'message'; tone: 'good' | 'warn' | 'bad'; text: string }
  | { k: 'field'; name: string; label: string; value?: string; secret?: boolean; help?: string; browse?: 'folder' | 'file' | null; multiline?: boolean; placeholder?: string }
  | { k: 'choice'; name: string; label?: string; value?: string; options: { value: string; label: string; help?: string }[] }
  | { k: 'check'; name: string; label: string; value?: boolean; help?: string }
  | { k: 'steps'; items: { id: string; title: string; text?: string; state: 'wait' | 'run' | 'ok' | 'warn' | 'fail' }[] }
  | { k: 'log'; id?: string }
  | { k: 'link'; label: string; url: string }
  | { k: 'actions'; items: { id: string; label: string; primary?: boolean }[] }
  | { k: 'group'; title?: string; blocks: ScriptBlock[] }

export interface ScriptButton { id: string; label: string; primary?: boolean; disabled?: boolean }
export interface ScriptScreen { id: string; title: string; sub?: string; blocks: ScriptBlock[]; buttons: ScriptButton[]; wait: boolean }

/** What a script can say. */
export type FromScript =
  | { t: 'hello'; title?: string; version?: number }
  | ({ t: 'screen' } & ScriptScreen)
  | { t: 'update'; id?: string; item?: { id: string; state: string; text?: string | null }; say?: string; log?: string; buttons?: ScriptButton[] }
  | { t: 'open'; url: string }
  | { t: 'copy'; text: string }
  | { t: 'save'; name?: string; text: string }
  | { t: 'exit'; code?: number }

/** What the app says back. */
export type ToScript =
  | { t: 'submit'; id: string; button: string; values: Record<string, string | boolean> }
  | { t: 'closed' }

/** The message on a line of a script's output, or null when the line is ordinary output. A line that is not valid is ordinary output too. */
export function parseScriptLine(line: string): FromScript | null {
  if (!line.startsWith(SCRIPT_UI_PREFIX)) return null
  try {
    const m = JSON.parse(line.slice(SCRIPT_UI_PREFIX.length))
    return m && typeof m === 'object' && typeof m.t === 'string' ? (m as FromScript) : null
  } catch { return null }
}

export function scriptReply(m: ToScript): string { return SCRIPT_UI_PREFIX + JSON.stringify(m) + '\n' }

/** Only web addresses are ever opened for a script. */
export const safeScriptUrl = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null)
