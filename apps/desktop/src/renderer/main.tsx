import './index.css'
import { start, enhanceSelects } from 'turbothemes'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Start the theme engine before the first paint so a saved look never flashes the default one.
// Fonts stay on the system stack: the app must work offline.
start({ persist: true, picker: true, fonts: 'none', appearance: { theme: 'auto', ui: 'auto' } })
enhanceSelects(document.body) // drop-downs are drawn by the look, never the OS list

createRoot(document.getElementById('root')!).render(<App />)
