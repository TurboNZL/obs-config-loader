import { useEffect, useState } from 'react'

/**
 * The window's title bar when "draw the title bar with the theme" is on: the page draws it (drag area, minimise, maximise, close) from
 * the current UI style's variables, so it matches the dialogs. Off by default; the system's own frame is used then and nothing renders.
 * (From the engine's window-frame module; icons are inline so the app needs no icon library.)
 */
const icon = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true } as const

export function WindowFrame() {
  const [custom, setCustom] = useState(false)
  const [max, setMax] = useState(false)
  useEffect(() => {
    void window.obsLoader.window.frame().then((f) => setCustom(f.custom))
    return window.obsLoader.window.onState(setMax)
  }, [])
  if (!custom) return null
  const ctl = (a: 'minimize' | 'maximize' | 'close') => void window.obsLoader.window.control(a)
  return (
    <div className="bt-wf" onDoubleClick={() => ctl('maximize')}>
      <span className="bt-wf-title">OBS Config Loader</span>
      <div className="bt-wf-btns">
        <button type="button" className="bt-wf-btn" aria-label="Minimise" onClick={() => ctl('minimize')} onDoubleClick={(e) => e.stopPropagation()}>
          <svg {...icon}><path d="M2 7h10" /></svg>
        </button>
        <button type="button" className="bt-wf-btn" aria-label={max ? 'Restore' : 'Maximise'} onClick={() => ctl('maximize')} onDoubleClick={(e) => e.stopPropagation()}>
          {max ? <svg {...icon}><path d="M4 4V2h8v8h-2M2 4h8v8H2z" /></svg> : <svg {...icon}><rect x="2" y="2" width="10" height="10" /></svg>}
        </button>
        <button type="button" className="bt-wf-btn bt-wf-close" aria-label="Close" onClick={() => ctl('close')} onDoubleClick={(e) => e.stopPropagation()}>
          <svg {...icon}><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
      </div>
    </div>
  )
}
