import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  GithubFunctionError,
  githubConnect,
  githubDisconnect,
  streamGithubSync,
} from '../lib/github'
import type { GithubConnection } from '../types'
import { useToasts } from './useToasts'

export type SyncMode = 'full' | 'incremental'

const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000

export interface GithubApi {
  connections: GithubConnection[]
  loading: boolean
  error: string | null
  syncing: boolean
  syncProgress: string | null
  lastSyncedAt: string | null
  connect: (token: string, label: string) => Promise<{ ok: boolean; message: string }>
  disconnect: (connectionId: string) => Promise<boolean>
  sync: (mode: SyncMode, connectionId?: string) => Promise<boolean>
}

export function useGithub(userId: string | undefined): GithubApi {
  const { showToast } = useToasts()
  const [connections, setConnections] = useState<GithubConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const syncingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchConnections = useCallback(async () => {
    if (!userId) {
      setConnections([])
      setLoading(false)
      return
    }
    const { data, error: fetchError } = await supabase
      .from('github_connections')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (!mountedRef.current) return
    if (fetchError) {
      setError(`Could not load GitHub connections (${fetchError.message}).`)
    } else {
      setError(null)
      setConnections(data ?? [])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    setLoading(true)
    void fetchConnections()
  }, [fetchConnections])

  const connect = useCallback(
    async (token: string, label: string) => {
      try {
        const result = await githubConnect(token, label)
        if (!mountedRef.current) return { ok: false, message: 'Component unmounted.' }
        await fetchConnections()
        showToast({
          message: result.replaced
            ? `Updated the token for @${result.connection.github_login}.`
            : `Connected GitHub as @${result.connection.github_login}.`,
          type: 'success',
        })
        if (result.warning) {
          showToast({ message: result.warning, type: 'info' })
        }
        return { ok: true, message: '' }
      } catch (err) {
        const message =
          err instanceof GithubFunctionError ? err.message : 'Could not connect GitHub. Try again.'
        return { ok: false, message }
      }
    },
    [fetchConnections, showToast],
  )

  const disconnect = useCallback(
    async (connectionId: string) => {
      const snapshot = connections
      setConnections((prev) => prev.filter((c) => c.id !== connectionId))
      try {
        await githubDisconnect(connectionId)
        showToast({ message: 'Disconnected. The token and cached pull requests were removed.', type: 'success' })
        return true
      } catch (err) {
        if (mountedRef.current) setConnections(snapshot)
        const message =
          err instanceof GithubFunctionError ? err.message : 'Could not disconnect. Try again.'
        showToast({ message, type: 'error' })
        return false
      }
    },
    [connections, showToast],
  )

  const sync = useCallback(
    async (mode: SyncMode, connectionId?: string) => {
      if (syncingRef.current) return false
      syncingRef.current = true
      if (mountedRef.current) {
        setSyncing(true)
        setSyncProgress(mode === 'full' ? 'Starting full sync…' : 'Syncing…')
      }
      try {
        const result = await streamGithubSync({
          mode,
          ...(connectionId ? { connectionId } : {}),
          onProgress: (message) => {
            if (mountedRef.current) setSyncProgress(message)
          },
        })
        if (!mountedRef.current) return false
        await fetchConnections()
        const messages = result.done.errors.map((e) => e.message)
        for (const message of messages) {
          showToast({ message, type: 'error' })
        }
        const total = result.done.totalFetched
        if (messages.length === 0) {
          showToast({
            message: `Sync complete — ${total} pull request${total === 1 ? '' : 's'} found.`,
            type: 'success',
          })
        } else if (total > 0) {
          showToast({
            message: `Sync finished with problems — ${total} pull request${total === 1 ? '' : 's'} saved.`,
            type: 'info',
          })
        }
        return messages.length === 0
      } catch (err) {
        const message =
          err instanceof GithubFunctionError ? err.message : 'Sync failed. Try again.'
        if (mountedRef.current) {
          await fetchConnections()
          showToast({ message, type: 'error' })
        }
        return false
      } finally {
        syncingRef.current = false
        if (mountedRef.current) {
          setSyncing(false)
          setSyncProgress(null)
        }
      }
    },
    [fetchConnections, showToast],
  )

  // Incremental sync every 10 minutes while the app is open.
  useEffect(() => {
    if (!userId || connections.length === 0) return
    const id = window.setInterval(() => {
      if (document.hidden || syncingRef.current) return
      void sync('incremental')
    }, AUTO_SYNC_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [userId, connections.length, sync])

  const lastSyncedAt = useMemo(() => {
    let latest: string | null = null
    for (const connection of connections) {
      if (connection.last_synced_at && (latest === null || connection.last_synced_at > latest)) {
        latest = connection.last_synced_at
      }
    }
    return latest
  }, [connections])

  return {
    connections,
    loading,
    error,
    syncing,
    syncProgress,
    lastSyncedAt,
    connect,
    disconnect,
    sync,
  }
}
