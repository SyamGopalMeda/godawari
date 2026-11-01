import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { initFirebase } from './firebase'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Firebase Analytics after first paint; never blocks rendering
window.setTimeout(() => { void initFirebase() }, 1500)
