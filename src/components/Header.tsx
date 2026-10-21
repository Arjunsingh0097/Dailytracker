import { GearIcon, MoonIcon, SignOutIcon, SunIcon } from './Icon'
import type { Theme } from '../hooks/useTheme'

interface HeaderProps {
  email: string
  theme: Theme
  onToggleTheme: () => void
  onSignOut: () => void
  onOpenSettings: () => void
  settingsActive: boolean
}

export function Header({ email, theme, onToggleTheme, onSignOut, onOpenSettings, settingsActive }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <span className="app-logo" aria-hidden="true" />
        <span className="app-name">Daily Task Tracker</span>
      </div>
      <div className="app-header-actions">
        <span className="app-email" title={email}>
          {email}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className={`icon-button${settingsActive ? ' is-active' : ''}`}
          onClick={onOpenSettings}
          aria-label="Open settings"
          aria-pressed={settingsActive}
        >
          <GearIcon />
        </button>
        <button type="button" className="icon-button" onClick={onSignOut} aria-label="Sign out">
          <SignOutIcon />
        </button>
      </div>
    </header>
  )
}
