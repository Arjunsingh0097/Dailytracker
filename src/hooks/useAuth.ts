import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthError, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface AuthResult {
  error: AuthError | null
}

interface AuthContextValue {
  session: Session | null
  user: User | null
  initializing: boolean
  recovery: boolean
  signUp: (email: string, password: string) => Promise<AuthResult>
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>
  signInWithMagicLink: (email: string) => Promise<AuthResult>
  resendVerification: (email: string) => Promise<AuthResult>
  resetPassword: (email: string) => Promise<AuthResult>
  updateUserPassword: (password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
  clearRecovery: () => void
}

export function useAuth(): AuthContextValue {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [recovery, setRecovery] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted.current) return
      setSession(newSession)
      setInitializing(false)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
    })
    return () => {
      mounted.current = false
      subscription.unsubscribe()
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error }
  }, [])

  const signInWithPassword = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  const signInWithMagicLink = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error }
  }, [])

  const resendVerification = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error }
  }, [])

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    return { error }
  }, [])

  const updateUserPassword = useCallback(async (password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.updateUser({ password })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const clearRecovery = useCallback(() => setRecovery(false), [])

  return useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      recovery,
      signUp,
      signInWithPassword,
      signInWithMagicLink,
      resendVerification,
      resetPassword,
      updateUserPassword,
      signOut,
      clearRecovery,
    }),
    [
      session,
      initializing,
      recovery,
      signUp,
      signInWithPassword,
      signInWithMagicLink,
      resendVerification,
      resetPassword,
      updateUserPassword,
      signOut,
      clearRecovery,
    ],
  )
}
