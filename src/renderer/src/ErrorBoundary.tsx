import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children?: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught render error:', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg text-gray-200">
          <h1 className="text-lg font-semibold text-red-400">Something went wrong</h1>
          <pre className="max-h-40 max-w-2xl overflow-auto rounded border border-border bg-panel p-3 text-xs text-gray-400">
            {this.state.error.message}
          </pre>
          <button
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-black"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
