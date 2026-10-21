import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export function CrashFallback({ error }: { error: Error }) {
  return (
    <div className="auth-shell">
      <div className="auth-card clay-card">
        <h2 className="auth-title">Something went wrong</h2>
        <p className="auth-error" role="alert">
          {error.message}
        </p>
        <p className="auth-copy">
          If this mentions SUPABASE env vars, set them in Vercel under Project → Settings →
          Environment Variables, then redeploy.
        </p>
        <button type="button" className="primary-button full" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <CrashFallback error={error} />
  }
}
