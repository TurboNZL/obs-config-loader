import { useEffect, useState } from 'react'
import { Card, Message, Page } from '../ui'

function FrameCard() {
  const [custom, setCustom] = useState(false)
  const [changed, setChanged] = useState(false)
  useEffect(() => { void window.obsLoader.window.frame().then((f) => setCustom(f.custom)) }, [])
  return (
    <Card title="Window">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={custom} onChange={async (e) => { setCustom(e.target.checked); setChanged(true); await window.obsLoader.window.setCustomFrame(e.target.checked) }} />
        Draw the window's title bar with the theme (instead of the system's)
      </label>
      {changed && (
        <Message tone="warn">
          This applies the next time the app starts.
          <div className="mt-2"><button className="btn btn-accent px-3 py-1" onClick={() => void window.obsLoader.window.restart()}>Restart now</button></div>
        </Message>
      )}
    </Card>
  )
}

export function AppearancePage() {
  return (
    <Page title="Appearance" intro="Pick a colour theme and window style. New looks arrive on their own; they never need an app update.">
      <Card>
        {/* the stock picker from the theme engine; registered by start({ picker: true }) */}
        <turbo-themes-picker></turbo-themes-picker>
      </Card>
      <FrameCard />
    </Page>
  )
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements { 'turbo-themes-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> }
  }
}
