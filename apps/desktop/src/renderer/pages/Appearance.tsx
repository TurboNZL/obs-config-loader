import { Card, Page } from '../ui'

export function AppearancePage() {
  return (
    <Page title="Appearance" intro="Pick a colour theme and window style. New looks arrive on their own; they never need an app update.">
      <Card>
        {/* the stock picker from the theme engine; registered by start({ picker: true }) */}
        <turbo-themes-picker></turbo-themes-picker>
      </Card>
    </Page>
  )
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements { 'turbo-themes-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> }
  }
}
