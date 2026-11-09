import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary variant="app" label="app">
      <App />
    </ErrorBoundary>
    {/* Top of the screen, so toasts never cover the phone's bottom nav */}
    <Toaster position="top-center" theme="dark" richColors closeButton />
  </StrictMode>,
)

// The installed app's service worker (public/sw.js): only shows an offline page when the hub is unreachable.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
