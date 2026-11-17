import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/app.css'

/**
 * Trusted shell renderer entry. `?surface=overlay` is the transparent overlay
 * child (health/toasts only, built in 03-04); the default surface is the shell.
 */
const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
