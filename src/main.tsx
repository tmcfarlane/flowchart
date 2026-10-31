import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App.tsx'
import { redactAnalyticsEvent } from './utils/analytics'
import { preloadDraft } from './utils/draftStore'

import './index.css'

inject({ beforeSend: redactAnalyticsEvent })

// The editor reads its autosaved board synchronously while initialising, so
// load it from IndexedDB first. This settles in milliseconds and never rejects.
void preloadDraft().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
