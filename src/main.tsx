import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './components/ThemeProvider'
import { ScoringConfigProvider } from './components/ScoringConfigProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <ScoringConfigProvider>
        <App />
      </ScoringConfigProvider>
    </ThemeProvider>
  </StrictMode>,
)
