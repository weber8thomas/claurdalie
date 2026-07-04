import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Mantine core styles must load before our own sheets so app-level overrides win.
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import App from './App'
import './ui/theme/mantine-overrides.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
