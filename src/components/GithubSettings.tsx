import { useState } from 'react'
import type { FormEvent } from 'react'
import { GearIcon, SyncIcon } from './Icon'
import type { GithubApi } from '../hooks/useGithub'
import { formatRelative, formatTimeUntil } from '../lib/format'
import type { GithubConnection } from '../types'

const TOKEN_CREATE_URL = 'https://github.com/settings/personal-access-tokens/new'
const MAX_CONNECTIONS = 5

function initialsFor(login: string): string {
  const parts = login.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return login.slice(0, 2).toUpperCase()
}

function statusLabel(connection: GithubConnection): string {
  switch (connection.status) {
    case 'active':
      return 'Connected'
    case 'invalid':
      return 'Token rejected'
    case 'expired':
      return 'Token expired'
    case 'rate_limited':
      return 'Rate limited'
  }
}

function statusHint(connection: GithubConnection): string | null {
  switch (connection.status) {
    case 'active':
      return null
    case 'invalid':
      return 'GitHub rejected this token. Create a new fine-grained token and reconnect.'
    case 'expired':
      return 'This token has expired. Create a new fine-grained token in GitHub and reconnect.'
    case 'rate_limited':
      return 'GitHub is rate limiting requests. Wait a few minutes and sync again.'
  }
}

function expiryLabel(connection: GithubConnection): { text: string; warn: boolean } | null {
  if (!connection.token_expires_at) return null
  const ms = Date.parse(connection.token_expires_at) - Date.now()
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return { text: 'Token expired', warn: true }
  const days = Math.ceil(ms / 86_400_000)
  if (days <= 7) return { text: `Expires in ${formatTimeUntil(connection.token_expires_at)} — create a new token soon`, warn: true }
  return { text: `Expires in ${days} day${days === 1 ? '' : 's'}`, warn: false }
}

interface GithubSettingsProps {
  github: GithubApi
}

export function GithubSettings({ github }: GithubSettingsProps) {
  const { connections, loading, error, syncing, syncProgress, lastSyncedAt } = github
  const [showForm, setShowForm] = useState(false)
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null)

  const canAddMore = connections.length < MAX_CONNECTIONS
  const formVisible = !loading && (showForm || connections.length === 0)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) {
      setFormError('Paste your GitHub token first.')
      return
    }
    setBusy(true)
    setFormError(null)
    const result = await github.connect(trimmed, label.trim() || 'GitHub')
    setBusy(false)
    if (result.ok) {
      setToken('')
      setLabel('')
      setShowForm(false)
      // Kick off a full sync right after connecting.
      void github.sync('full')
    } else {
      setFormError(result.message)
    }
  }

  const askDisconnect = async (connection: GithubConnection) => {
    if (confirmDisconnectId !== connection.id) {
      setConfirmDisconnectId(connection.id)
      return
    }
    setConfirmDisconnectId(null)
    await github.disconnect(connection.id)
  }

  return (
    <section className="settings-card clay-card" aria-label="GitHub settings">
      <div className="settings-heading">
        <GearIcon size={20} />
        <h2 className="settings-title">GitHub</h2>
      </div>

      <div className="gh-help">
        <p className="auth-copy">
          Connect a fine-grained personal access token to see your pull requests in the tracker. The
          token is encrypted on our server and never shown again — only your GitHub username, the
          last 4 characters and the expiry are kept visible.
        </p>
        <ol className="gh-steps">
          <li>
            Open{' '}
            <a href={TOKEN_CREATE_URL} target="_blank" rel="noopener noreferrer">
              GitHub → Settings → Developer settings → Fine-grained tokens
            </a>{' '}
            and create a new token.
          </li>
          <li>
            Grant <strong>read-only</strong> access to: <strong>Pull requests: Read</strong> and{' '}
            <strong>Metadata: Read</strong>. Do not grant write or admin permissions.
          </li>
          <li>Choose only the repositories you want to see. Paste the token below.</li>
        </ol>
        <p className="auth-hint">
          A fine-grained token covers one owner (your account or one organization) and only the
          repositories you selected. Organizations may require an owner to approve the token before
          it works.
        </p>
      </div>

      {loading && <p className="gh-note">Loading connections…</p>}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {connections.map((connection) => {
        const expiry = expiryLabel(connection)
        const hint = statusHint(connection)
        const confirming = confirmDisconnectId === connection.id
        return (
          <div key={connection.id} className="connection-card">
            <div className="connection-top">
              <span className="initials-badge" aria-hidden="true">
                {initialsFor(connection.github_login)}
              </span>
              <div className="connection-identity">
                <p className="connection-name">@{connection.github_login}</p>
                <p className="connection-meta">
                  {connection.label}
                  {connection.resource_owner && connection.resource_owner !== connection.github_login
                    ? ` · org: ${connection.resource_owner}`
                    : ''}{' '}
                  · token ending …{connection.token_last4}
                </p>
              </div>
              <span className={`status-chip status-${connection.status}`}>{statusLabel(connection)}</span>
            </div>
            <div className="connection-facts">
              {expiry && (
                <span className={`fact-chip${expiry.warn ? ' is-warn' : ''}`}>{expiry.text}</span>
              )}
              <span className="fact-chip">Last synced {formatRelative(connection.last_synced_at)}</span>
            </div>
            {hint && (
              <p className="auth-hint" role="status">
                {hint}
              </p>
            )}
            <div className="connection-actions">
              <button
                type="button"
                className="pill-button"
                onClick={() => void github.sync('full', connection.id)}
                disabled={syncing || connection.status === 'invalid' || connection.status === 'expired'}
                aria-label={`Sync pull requests for @${connection.github_login}`}
              >
                <SyncIcon />
                Sync now
              </button>
              <button
                type="button"
                className={`pill-button ghost${confirming ? ' is-danger' : ''}`}
                onClick={() => void askDisconnect(connection)}
                aria-label={`Disconnect @${connection.github_login}`}
              >
                {confirming ? 'Yes, remove token & data' : 'Disconnect'}
              </button>
            </div>
            {confirming && (
              <p className="disconnect-confirm" role="alertdialog" aria-label="Confirm disconnect">
                Disconnecting deletes the encrypted token and all cached pull requests for{' '}
                <strong>@{connection.github_login}</strong> immediately. Tasks you added stay. This
                cannot be undone.
              </p>
            )}
          </div>
        )
      })}

      {syncing && (
        <p className="gh-sync-status" role="status" aria-live="polite">
          <span className="pulse-dot" aria-hidden="true" />
          {syncProgress ?? 'Syncing…'}
        </p>
      )}
      {!syncing && lastSyncedAt && (
        <p className="gh-note">Last synced {formatRelative(lastSyncedAt)}</p>
      )}

      {connections.length > 0 && !formVisible && canAddMore && (
        <button type="button" className="pill-button ghost" onClick={() => setShowForm(true)}>
          Add another token
        </button>
      )}
      {connections.length > 0 && !canAddMore && (
        <p className="auth-hint">
          You have reached the limit of {MAX_CONNECTIONS} connections. Disconnect one to add another.
        </p>
      )}

      {formVisible && canAddMore && (
        <form className="token-form" onSubmit={submit} aria-label="Connect a GitHub token">
          <label className="field-label" htmlFor="gh-token">
            Fine-grained personal access token
          </label>
          <input
            id="gh-token"
            className="clay-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_…"
            value={token}
            onChange={(e) => {
              setToken(e.target.value)
              setFormError(null)
            }}
            aria-describedby="gh-token-hint"
          />
          <p id="gh-token-hint" className="field-hint">
            Starts with <code>github_pat_</code>. Only read-only Pull requests + Metadata tokens are
            accepted — classic tokens with broad scopes are rejected.
          </p>
          <label className="field-label" htmlFor="gh-label">
            Label (optional — e.g. “Work org”)
          </label>
          <input
            id="gh-label"
            className="clay-input"
            type="text"
            maxLength={60}
            placeholder="GitHub"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {formError && (
            <p className="field-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" className="primary-button full" disabled={busy}>
            {busy ? 'Checking token…' : 'Connect GitHub'}
          </button>
        </form>
      )}
    </section>
  )
}
