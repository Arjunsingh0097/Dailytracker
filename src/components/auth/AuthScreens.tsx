import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

interface CooldownState {
  secondsLeft: number
}

/** Resend button with a visible 30-second cooldown. */
export function ResendButton({
  email,
  onResend,
  variant = 'signup',
}: {
  email: string
  onResend: (email: string, variant: 'signup' | 'recovery' | 'magic_link') => Promise<string | null>
  variant?: 'signup' | 'recovery' | 'magic_link'
}) {
  const [cooldown, setCooldown] = useState<CooldownState>({ secondsLeft: 0 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    },
    [],
  )

  const startCooldown = () => {
    setCooldown({ secondsLeft: 30 })
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev.secondsLeft <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          return { secondsLeft: 0 }
        }
        return { secondsLeft: prev.secondsLeft - 1 }
      })
    }, 1000)
  }

  const click = async () => {
    if (cooldown.secondsLeft > 0 || busy) return
    setBusy(true)
    setMessage(null)
    const error = await onResend(email, variant)
    setBusy(false)
    if (error) setMessage(error)
    else {
      setMessage('Email sent. Check your inbox.')
      startCooldown()
    }
  }

  const disabled = cooldown.secondsLeft > 0 || busy

  return (
    <div className="resend-block">
      <button type="button" className="pill-button ghost" onClick={() => void click()} disabled={disabled}>
        {busy
          ? 'Sending…'
          : cooldown.secondsLeft > 0
            ? `Resend email (${cooldown.secondsLeft}s)`
            : 'Resend verification email'}
      </button>
      <p className="resend-note" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  )
}

/** Shared "check your email" screen for sign-up, magic link and password reset. */
export function CheckEmailScreen({
  email,
  kind,
  onResend,
  onBack,
}: {
  email: string
  kind: 'signup' | 'magic_link' | 'recovery'
  onResend: (email: string, variant: 'signup' | 'recovery' | 'magic_link') => Promise<string | null>
  onBack: () => void
}) {
  const copy =
    kind === 'signup'
      ? 'We sent a confirmation link to'
      : kind === 'magic_link'
        ? 'We sent a sign-in link to'
        : 'We sent a password reset link to'

  return (
    <div className="auth-card clay-card" role="region" aria-label="Check your email">
      <h2 className="auth-title">Check your email</h2>
      <p className="auth-copy">
        {copy} <strong className="break-all">{email}</strong>. Click the link to {kind === 'recovery' ? 'reset your password' : 'continue'}.
      </p>
      {kind === 'signup' && (
        <p className="auth-hint">You must verify before your first sign-in. The link works once.</p>
      )}
      <ResendButton email={email} onResend={onResend} variant={kind === 'signup' ? 'signup' : kind} />
      <button type="button" className="text-button" onClick={onBack}>
        Use a different email
      </button>
    </div>
  )
}

export function VerifiedScreen() {
  return (
    <div className="auth-card clay-card" role="status" aria-live="polite">
      <div className="verified-badge" aria-hidden="true">
        ✓
      </div>
      <h2 className="auth-title">Email verified</h2>
      <p className="auth-copy">You’re signed in. Taking you to your tasks…</p>
    </div>
  )
}

export function SetNewPasswordForm({
  onSubmit,
  initialError,
}: {
  onSubmit: (password: string) => Promise<string | null>
  initialError?: string | null
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [busy, setBusy] = useState(false)

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password

  const submit = async (event: FormEvent) => {
    event.preventDefault()
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
    const errMsg = await onSubmit(password)
    setBusy(false)
    if (errMsg) setError(errMsg)
  }

  return (
    <form className="auth-card clay-card" onSubmit={(e) => void submit(e)} aria-label="Set a new password">
      <h2 className="auth-title">Set a new password</h2>
      <p className="auth-copy">Choose a password of at least 8 characters.</p>
      {error && (
        <p className="auth-error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      <label className="field-label" htmlFor="new-password">
        New password
      </label>
      <input
        id="new-password"
        className="clay-input"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          setError(null)
        }}
        aria-invalid={tooShort}
      />
      {tooShort && <p className="field-error">At least 8 characters.</p>}
      <label className="field-label" htmlFor="confirm-password">
        Confirm password
      </label>
      <input
        id="confirm-password"
        className="clay-input"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value)
          setError(null)
        }}
        aria-invalid={mismatch}
      />
      {mismatch && <p className="field-error">Passwords do not match.</p>}
      <button type="submit" className="primary-button full" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
    </form>
  )
}
