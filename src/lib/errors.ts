/** Turn Supabase auth errors into plain, actionable messages. */

export function authErrorMessage(error: unknown): string {
  if (!error) return 'Something went wrong. Try again.'

  const err = error as { message?: string; status?: number; code?: string }
  const message = err.message ?? String(error)
  const msg = message.toLowerCase()
  const code = (err.code ?? '').toLowerCase()

  if (
    msg.includes('rate limit') ||
    msg.includes('too many') ||
    msg.includes('security purposes') ||
    msg.includes('for security purposes') ||
    err.status === 429
  ) {
    return 'Too many emails requested. Try again in a minute.'
  }
  if (msg.includes('email not confirmed') || code.includes('email_not_confirmed')) {
    return 'This account is not verified yet. Open the confirmation email we sent you, or resend it below.'
  }
  if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'Wrong email or password. Try again, or reset your password.'
  }
  if (
    msg.includes('already registered') ||
    msg.includes('already been registered') ||
    msg.includes('user already exists') ||
    code.includes('user_already_exists')
  ) {
    return 'An account with this email already exists. Sign in instead.'
  }
  if (msg.includes('password should be at least')) {
    return 'Password must be at least 8 characters.'
  }
  if (msg.includes('identifier') && msg.includes('invalid')) {
    return 'That email address looks invalid. Check it and try again.'
  }
  if (error instanceof TypeError || msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return 'Could not reach the server. Check your internet connection and try again.'
  }
  return message
}

/** Map Supabase redirect errors (from ?error_description= / #error_description=) to a clear message. */
export function redirectErrorMessage(description: string, errorCode: string): string {
  const desc = description.toLowerCase()
  const code = errorCode.toLowerCase()

  if (
    desc.includes('invalid or has expired') ||
    desc.includes('expired') ||
    code.includes('otp_expired') ||
    code.includes('email_expired') ||
    desc.includes('already been used')
  ) {
    return 'This verification link is expired or has already been used. Sign in and resend a fresh email.'
  }
  if (desc.includes('access_denied') || code.includes('access_denied')) {
    return 'The link was rejected. It may have been opened in a different browser — try signing in with your password instead.'
  }
  if (desc.includes('provider') && desc.includes('not')) {
    return 'Email sign-in is not enabled on this project. Enable the Email provider in Supabase Auth settings.'
  }
  return description || 'The link could not be processed. Try signing in again.'
}

export interface ParsedRedirect {
  error: string | null
  cameFromAuthLink: boolean
  authType: string | null
}

/** Parse an auth redirect landing (?error… / #access_token…&type=… / ?code=…). */
export function parseAuthRedirect(): ParsedRedirect {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  const description = search.get('error_description') ?? hash.get('error_description') ?? ''
  const errorCode = search.get('error_code') ?? hash.get('error_code') ?? ''
  const errorParam = search.get('error') ?? hash.get('error') ?? ''

  const cameFromAuthLink =
    Boolean(search.get('code')) ||
    Boolean(hash.get('access_token')) ||
    Boolean(hash.get('token_hash')) ||
    Boolean(description) ||
    Boolean(errorParam)

  const authType = hash.get('type') ?? search.get('type')

  const error = description || errorParam
    ? redirectErrorMessage(description || errorParam, errorCode)
    : null

  return { error, cameFromAuthLink, authType }
}

/** Remove auth tokens/errors from the address bar without navigating. */
export function cleanAuthRedirectFromUrl(): void {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  window.history.replaceState(null, '', url.toString())
}
