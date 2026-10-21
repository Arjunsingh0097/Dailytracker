import { useState } from 'react'
import type { FormEvent } from 'react'
import { CheckEmailScreen } from './AuthScreens'

type Mode = 'signin' | 'signup' | 'forgot' | 'check-email'
type CheckEmailKind = 'signup' | 'magic_link' | 'recovery'

interface AuthScreenProps {
  notice: string | null
  onSignIn: (email: string, password: string) => Promise<string | null>
  onSignUp: (email: string, password: string) => Promise<{ error: string | null; needsVerification: boolean }>
  onMagicLink: (email: string) => Promise<string | null>
  onForgot: (email: string) => Promise<string | null>
  onResend: (email: string, variant: 'signup' | 'recovery' | 'magic_link') => Promise<string | null>
}

export function AuthScreen({ notice, onSignIn, onSignUp, onMagicLink, onForgot, onResend }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(notice)
  const [unverified, setUnverified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checkEmail, setCheckEmail] = useState<{ email: string; kind: CheckEmailKind } | null>(null)

  const passwordTooShort = password.length > 0 && password.length < 8
  const emailInvalid = email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  const submitSignIn = async (event: FormEvent) => {
    event.preventDefault()
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError(null)
    setUnverified(false)
    const errMsg = await onSignIn(email, password)
    setBusy(false)
    if (errMsg) {
      setError(errMsg)
      if (errMsg.toLowerCase().includes('not verified')) setUnverified(true)
    }
  }

  const submitSignUp = async (event: FormEvent) => {
    event.preventDefault()
    if (!email || !password) {
      setError('Enter an email and a password.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: errMsg, needsVerification } = await onSignUp(email, password)
    setBusy(false)
    if (errMsg) setError(errMsg)
    else if (needsVerification) setCheckEmail({ email, kind: 'signup' })
  }

  const submitForgot = async (event: FormEvent) => {
    event.preventDefault()
    if (!email) {
      setError('Enter the email on your account.')
      return
    }
    setBusy(true)
    setError(null)
    const errMsg = await onForgot(email)
    setBusy(false)
    if (errMsg) setError(errMsg)
    else setCheckEmail({ email, kind: 'recovery' })
  }

  const submitMagic = async () => {
    if (!email) {
      setError('Enter your email first.')
      return
    }
    setBusy(true)
    setError(null)
    const errMsg = await onMagicLink(email)
    setBusy(false)
    if (errMsg) setError(errMsg)
    else setCheckEmail({ email, kind: 'magic_link' })
  }

  const resend = async (targetEmail: string, variant: 'signup' | 'recovery' | 'magic_link') => {
    return onResend(targetEmail, variant)
  }

  if (checkEmail || unverified) {
    const targetEmail = checkEmail?.email ?? email
    const kind: CheckEmailKind = checkEmail?.kind ?? 'signup'
    return (
      <CheckEmailScreen
        email={targetEmail}
        kind={kind}
        onResend={resend}
        onBack={() => {
          setCheckEmail(null)
          setUnverified(false)
          setMode(checkEmail?.kind === 'recovery' ? 'forgot' : 'signin')
        }}
      />
    )
  }

  if (mode === 'forgot') {
    return (
      <form className="auth-card clay-card" onSubmit={(e) => void submitForgot(e)} aria-label="Reset your password">
        <h2 className="auth-title">Reset your password</h2>
        <p className="auth-copy">We’ll email you a link to set a new password.</p>
        {error && (
          <p className="auth-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        <label className="field-label" htmlFor="reset-email">
          Email
        </label>
        <input
          id="reset-email"
          className="clay-input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
          }}
        />
        <button type="submit" className="primary-button full" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
        <button type="button" className="text-button" onClick={() => setMode('signin')}>
          Back to sign in
        </button>
      </form>
    )
  }

  return (
    <form
      className="auth-card clay-card"
      onSubmit={(e) => void (mode === 'signup' ? submitSignUp(e) : submitSignIn(e))}
      aria-label={mode === 'signup' ? 'Create your account' : 'Sign in'}
    >
      <div className="auth-brand">
        <span className="app-logo" aria-hidden="true" />
        <h2 className="auth-title">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
      </div>

      {error && (
        <p className="auth-error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}

      <label className="field-label" htmlFor="auth-email">
        Email
      </label>
      <input
        id="auth-email"
        className="clay-input"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          setError(null)
        }}
        aria-invalid={emailInvalid}
      />
      {emailInvalid && <p className="field-error">That email address looks invalid.</p>}

      <label className="field-label" htmlFor="auth-password">
        Password
      </label>
      <input
        id="auth-password"
        className="clay-input"
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={8}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          setError(null)
        }}
        aria-invalid={passwordTooShort}
      />
      {mode === 'signup' && (
        <>
          <p className="field-hint">At least 8 characters.</p>
          {passwordTooShort && <p className="field-error">Password must be at least 8 characters.</p>}
          <label className="field-label" htmlFor="auth-confirm">
            Confirm password
          </label>
          <input
            id="auth-confirm"
            className="clay-input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              setError(null)
            }}
          />
          {confirm.length > 0 && confirm !== password && <p className="field-error">Passwords do not match.</p>}
        </>
      )}

      <button type="submit" className="primary-button full" disabled={busy}>
        {busy ? 'Working…' : mode === 'signup' ? 'Sign up' : 'Sign in'}
      </button>

      <div className="auth-links">
        {mode === 'signin' ? (
          <>
            <button type="button" className="text-button" onClick={() => void submitMagic()}>
              Email me a magic link
            </button>
            <button type="button" className="text-button" onClick={() => setMode('forgot')}>
              Forgot password?
            </button>
            <button type="button" className="text-button" onClick={() => setMode('signup')}>
              Create an account
            </button>
          </>
        ) : (
          <button type="button" className="text-button" onClick={() => setMode('signin')}>
            I already have an account
          </button>
        )}
      </div>
    </form>
  )
}
