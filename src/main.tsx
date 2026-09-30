import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App.tsx'
import { redactAnalyticsEvent } from './utils/analytics'

import './index.css'

inject({ beforeSend: redactAnalyticsEvent })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
