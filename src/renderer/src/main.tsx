import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

// No StrictMode: its dev double-mount double-spawns ptys/dock panels in this
// imperative app (xterm + dockview). ErrorBoundary still guards render throws.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
