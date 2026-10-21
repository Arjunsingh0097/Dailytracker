import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from './hooks/useAuth'
import { useTasks } from './hooks/useTasks'
import { useTheme } from './hooks/useTheme'
import { useGithub, type GithubApi } from './hooks/useGithub'
import { useToasts, ToastProvider } from './hooks/useToasts'
import { authErrorMessage, cleanAuthRedirectFromUrl, parseAuthRedirect } from './lib/errors'
import { addDays, formatDayHeading, todayKey, weekOf } from './lib/dates'
import { buildShareUrl, copyText } from './lib/shares'
import { supabase } from './lib/supabase'
import { Header } from './components/Header'
import { WeekStrip } from './components/WeekStrip'
import { DayHeading } from './components/DayHeading'
import { DaySummary } from './components/DaySummary'
import { AddTaskForm } from './components/AddTaskForm'
import { TaskList } from './components/TaskList'
import { Toasts } from './components/Toasts'
import { AuthScreen } from './components/auth/AuthScreen'
import { SetNewPasswordForm, VerifiedScreen } from './components/auth/AuthScreens'
import { GithubSettings } from './components/GithubSettings'
import { PullRequestList } from './components/PullRequestList'
import { GithubActivity } from './components/GithubActivity'
import { SharedDay } from './components/SharedDay'

type MainView = 'tasks' | 'prs' | 'settings'

/** Read ?date=YYYY-MM-DD from the URL (shareable day links), validated. */
function dateFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('date')
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}` === raw ? raw : null
}

/** Write ?date= into the address bar without navigating. */
function syncDateToUrl(dateKey: string): void {
  const url = new URL(window.location.href)
  if (url.searchParams.get('date') === dateKey) return
  url.searchParams.set('date', dateKey)
  window.history.replaceState(null, '', url.toString())
}

function TrackerApp({ github }: { github: GithubApi }) {
  const { user } = useAuth()
  const { showToast } = useToasts()
  const today = todayKey()
  const [selectedDate, setSelectedDate] = useState(() => dateFromUrl() ?? todayKey())
  const addInputRef = useRef<HTMLInputElement | null>(null)

  // Keep the address bar in sync so every day has a shareable link.
  useEffect(() => {
    syncDateToUrl(selectedDate)
  }, [selectedDate])

  // Public share state for the selected day
  const [shareId, setShareId] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (!user) {
      setShareId(null)
      return
    }
    let cancelled = false
    void supabase
      .from('day_shares')
      .select('id')
      .eq('user_id', user.id)
      .eq('task_date', selectedDate)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setShareId(data?.id ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [user?.id, selectedDate])

  const copyShareLink = async (id: string) => {
    const ok = await copyText(buildShareUrl(id))
    if (ok) {
      showToast({
        message: `Public link copied — anyone with it can view ${formatDayHeading(selectedDate)} without signing in.`,
        type: 'success',
        action: { label: 'Unshare', onClick: () => void revokeShare(id) },
      })
    } else {
      showToast({ message: 'Could not copy — open the share link from the address bar instead.', type: 'error' })
    }
  }

  const handleShare = async () => {
    if (!user || sharing) return
    setSharing(true)
    const { data, error } = await supabase
      .from('day_shares')
      .insert({ user_id: user.id, task_date: selectedDate })
      .select('id')
      .single()
    setSharing(false)
    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('day_shares')
          .select('id')
          .eq('user_id', user.id)
          .eq('task_date', selectedDate)
          .maybeSingle()
        if (existing) {
          setShareId(existing.id)
          await copyShareLink(existing.id)
        }
        return
      }
      showToast({ message: `Could not share this day (${error.message}).`, type: 'error' })
      return
    }
    if (data) {
      setShareId(data.id)
      await copyShareLink(data.id)
    }
  }

  const revokeShare = async (id: string) => {
    const { error } = await supabase.from('day_shares').delete().eq('id', id)
    if (error) {
      showToast({ message: `Could not stop sharing (${error.message}).`, type: 'error' })
      return
    }
    setShareId(null)
    showToast({ message: 'Sharing stopped — the public link no longer works.', type: 'info' })
  }

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
    <main className="app-main">
      <WeekStrip days={week} selected={selectedDate} today={today} stats={dayStats} onSelect={setSelectedDate} />

      <DayHeading
        dateKey={selectedDate}
        today={today}
        shared={shareId !== null}
        sharing={sharing}
        onPrev={() => setSelectedDate((d) => addDays(d, -1))}
        onNext={() => setSelectedDate((d) => addDays(d, 1))}
        onJumpToToday={() => setSelectedDate(today)}
        onShare={() => void handleShare()}
        onCopyShare={() => {
          if (shareId) void copyShareLink(shareId)
        }}
        onRevokeShare={() => {
          if (shareId) void revokeShare(shareId)
        }}
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

      {user && (
        <GithubActivity
          userId={user.id}
          dateKey={selectedDate}
          enabled={github.connections.length > 0}
        />
      )}

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
  )
}

function MainApp({ user }: { user: User }) {
  const { signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const github = useGithub(user.id)
  const [view, setView] = useState<MainView>('tasks')

  return (
    <div className="app-shell">
      <Header
        email={user.email ?? ''}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={() => void signOut()}
        onOpenSettings={() => setView('settings')}
        settingsActive={view === 'settings'}
      />

      {view !== 'settings' && (
        <nav className="tab-strip" aria-label="Main sections">
          <button
            type="button"
            className={`tab-pill${view === 'tasks' ? ' is-selected' : ''}`}
            aria-current={view === 'tasks' ? 'page' : undefined}
            onClick={() => setView('tasks')}
          >
            Tasks
          </button>
          <button
            type="button"
            className={`tab-pill${view === 'prs' ? ' is-selected' : ''}`}
            aria-current={view === 'prs' ? 'page' : undefined}
            onClick={() => setView('prs')}
          >
            Pull requests
          </button>
        </nav>
      )}

      {view === 'tasks' && <TrackerApp github={github} />}
      {view === 'prs' && (
        <PullRequestList userId={user.id} github={github} onOpenTasks={() => setView('tasks')} />
      )}
      {view === 'settings' && (
        <div className="settings-page">
          <GithubSettings github={github} />
          <button type="button" className="pill-button ghost" onClick={() => setView('tasks')}>
            Back to tasks
          </button>
        </div>
      )}
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
    async (email: string, _variant: 'signup' | 'recovery' | 'magic_link') => {
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

  return <MainApp user={session.user} />
}

export default function App() {
  const [shareToken] = useState(() => new URLSearchParams(window.location.search).get('share'))

  // Public share links render without any sign-in.
  if (shareToken) return <SharedDay token={shareToken} />

  return (
    <ToastProvider>
      <Shell />
      <Toasts />
    </ToastProvider>
  )
}
