import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTasks } from './hooks/useTasks'
import { useTheme } from './hooks/useTheme'
import { useToasts, ToastProvider } from './hooks/useToasts'
import { authErrorMessage, cleanAuthRedirectFromUrl, parseAuthRedirect } from './lib/errors'
import { addDays, todayKey, weekOf } from './lib/dates'
import { Header } from './components/Header'
import { WeekStrip } from './components/WeekStrip'
import { DayHeading } from './components/DayHeading'
import { DaySummary } from './components/DaySummary'
import { AddTaskForm } from './components/AddTaskForm'
import { TaskList } from './components/TaskList'
import { Toasts } from './components/Toasts'
import { AuthScreen } from './components/auth/AuthScreen'
import { SetNewPasswordForm, VerifiedScreen } from './components/auth/AuthScreens'

function TrackerApp() {
  const { user, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { showToast } = useToasts()
  const today = todayKey()
  const [selectedDate, setSelectedDate] = useState(today)
  const addInputRef = useRef<HTMLInputElement | null>(null)

  const {
    tasks,
    dayStats,
    loading,
    error,
    refresh,
    addTask,
    updateTaskFields,
    toggleDone,
    deleteTask,
    startTimer,
    pauseTimer,
    moveUnfinishedToTomorrow,
  } = useTasks(user?.id, selectedDate)

  // Keyboard shortcut: N focuses the add-task input
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        addInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const week = useMemo(() => weekOf(selectedDate), [selectedDate])
  const unfinishedCount = tasks.filter((t) => !t.is_done).length

  const handleMoveUnfinished = async () => {
    const moved = await moveUnfinishedToTomorrow()
    if (moved > 0) {
      showToast({ message: 'You can find them under tomorrow’s date.', type: 'info' })
      setSelectedDate((d) => addDays(d, 1))
    }
  }

  return (
    <div className="app-shell">
      <Header email={user?.email ?? ''} theme={theme} onToggleTheme={toggleTheme} onSignOut={() => void signOut()} />

      <main className="app-main">
        <WeekStrip days={week} selected={selectedDate} today={today} stats={dayStats} onSelect={setSelectedDate} />

        <DayHeading
          dateKey={selectedDate}
          today={today}
          onPrev={() => setSelectedDate((d) => addDays(d, -1))}
          onNext={() => setSelectedDate((d) => addDays(d, 1))}
          onJumpToToday={() => setSelectedDate(today)}
        />

        <DaySummary tasks={tasks} />

        <AddTaskForm onAdd={addTask} titleInputRef={addInputRef} />

        {error && (
          <div className="load-error clay-card" role="alert">
            <p>{error}</p>
            <button type="button" className="pill-button ghost" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}

        <TaskList
          tasks={tasks}
          loading={loading}
          onToggleDone={toggleDone}
          onUpdate={updateTaskFields}
          onDelete={deleteTask}
          onStartTimer={startTimer}
          onPauseTimer={pauseTimer}
        />

        <footer className="app-footer">
          {unfinishedCount > 0 ? (
            <button type="button" className="pill-button ghost" onClick={() => void handleMoveUnfinished()}>
              Move unfinished to tomorrow ({unfinishedCount})
            </button>
          ) : (
            <span className="footer-note">Press N to add a task · Start a timer and it keeps running across reloads and devices.</span>
          )}
        </footer>
      </main>
    </div>
  )
}

function Shell() {
  const {
    session,
    initializing,
    recovery,
    signUp,
    signInWithPassword,
    signInWithMagicLink,
    resendVerification,
    resetPassword,
    updateUserPassword,
    clearRecovery,
  } = useAuth()
  const { showToast } = useToasts()

  const [redirect] = useState(() => parseAuthRedirect())
  const [showVerified, setShowVerified] = useState(false)

  // If we landed from an auth link, clean the URL once the state is parsed
  useEffect(() => {
    if (redirect.cameFromAuthLink) {
      cleanAuthRedirectFromUrl()
    }
  }, [redirect])

  // Verified-success: we came from a link and now have a session
  useEffect(() => {
    if (session && redirect.cameFromAuthLink && !redirect.error && !recovery && redirect.authType !== 'recovery') {
      setShowVerified(true)
      const timer = window.setTimeout(() => setShowVerified(false), 2000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [session, redirect, recovery])

  const handleSignUp = useCallback(
    async (email: string, password: string) => {
      const { error } = await signUp(email, password)
      if (error) return { error: authErrorMessage(error), needsVerification: false }
      return { error: null, needsVerification: true }
    },
    [signUp],
  )

  const handleSignIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await signInWithPassword(email, password)
      return error ? authErrorMessage(error) : null
    },
    [signInWithPassword],
  )

  const handleMagicLink = useCallback(
    async (email: string) => {
      const { error } = await signInWithMagicLink(email)
      return error ? authErrorMessage(error) : null
    },
    [signInWithMagicLink],
  )

  const handleForgot = useCallback(
    async (email: string) => {
      const { error } = await resetPassword(email)
      return error ? authErrorMessage(error) : null
    },
    [resetPassword],
  )

  const handleResend = useCallback(
    async (email: string) => {
      const { error } = await resendVerification(email)
      return error ? authErrorMessage(error) : null
    },
    [resendVerification],
  )

  const handleSetPassword = useCallback(
    async (password: string) => {
      const { error } = await updateUserPassword(password)
      if (error) return authErrorMessage(error)
      clearRecovery()
      showToast({ message: 'Password updated. Welcome back.', type: 'success' })
      return null
    },
    [updateUserPassword, clearRecovery, showToast],
  )

  if (initializing) {
    return (
      <div className="auth-shell" aria-busy="true">
        <div className="auth-card clay-card skeleton-card" aria-label="Loading">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-meta" />
        </div>
      </div>
    )
  }

  if (!session) {
    if (redirect.error) {
      return (
        <div className="auth-shell">
          <div className="auth-card clay-card">
            <h2 className="auth-title">Link problem</h2>
            <p className="auth-error" role="alert" aria-live="assertive">
              {redirect.error}
            </p>
          </div>
          <AuthScreen
            notice={redirect.error}
            onSignIn={handleSignIn}
            onSignUp={handleSignUp}
            onMagicLink={handleMagicLink}
            onForgot={handleForgot}
            onResend={handleResend}
          />
        </div>
      )
    }
    return (
      <div className="auth-shell">
        <AuthScreen
          notice={null}
          onSignIn={handleSignIn}
          onSignUp={handleSignUp}
          onMagicLink={handleMagicLink}
          onForgot={handleForgot}
          onResend={handleResend}
        />
      </div>
    )
  }

  if (recovery) {
    return (
      <div className="auth-shell">
        <SetNewPasswordForm onSubmit={handleSetPassword} />
      </div>
    )
  }

  if (showVerified) {
    return (
      <div className="auth-shell">
        <VerifiedScreen />
      </div>
    )
  }

  return <TrackerApp />
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
      <Toasts />
    </ToastProvider>
  )
}
