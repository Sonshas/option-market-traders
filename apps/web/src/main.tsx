import '@/lib/auth-link'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

/** DEMO settlement is only needed inside /app — skip it on /login and marketing pages. */
function ensureDemoSettlement() {
  if (!window.location.pathname.startsWith('/app')) return
  void import('@/providers/trading/demo-trading-provider').then((m) => m.startDemoSettlementLoop())
}
ensureDemoSettlement()
window.addEventListener('popstate', ensureDemoSettlement)
const pushState = history.pushState.bind(history)
history.pushState = (...args) => {
  pushState(...args)
  ensureDemoSettlement()
}
const replaceState = history.replaceState.bind(history)
history.replaceState = (...args) => {
  replaceState(...args)
  ensureDemoSettlement()
}
