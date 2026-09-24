import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, lockersApi } from './api/client';
import type { Locker, LockerEvent, LockerEventType } from './api/types';

export type LiveStatus = 'connecting' | 'live' | 'polling';

const EVENT_TYPES: LockerEventType[] = ['locker.created', 'package.stored', 'package.retrieved'];
const FALLBACK_POLL_MS = 5_000;
const MAX_FEED = 30;

/**
 * Locker board state shared by every screen.
 *
 * Subscribes to the API's Server-Sent Events stream and refetches the list whenever a locker changes,
 * so all open screens (agent, pickup, admin, on any device) update within a moment of each other.
 * If the stream cannot be established or drops, the hook polls until it reconnects; the UI shows
 * which mode it is in. Also keeps a short feed of recent events for the admin screen.
 */
export function useLiveLockers(enabled = true) {
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [feed, setFeed] = useState<LockerEvent[]>([]);
  // Advances on every successful load, in live and polling mode alike. Panels use it as a refetch key;
  // `feed.length` cannot serve that purpose because the feed is capped and stays empty without SSE.
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const refetchTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const list = await lockersApi.list();
      setLockers(list.items);
      setError(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(describeError(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Coalesce bursts of events (e.g. 20 concurrent stores) into one refetch.
  const scheduleRefresh = useCallback(() => {
    if (refetchTimer.current !== null) return;
    refetchTimer.current = window.setTimeout(() => {
      refetchTimer.current = null;
      void refresh();
    }, 150);
  }, [refresh]);

  useEffect(() => {
    // Logged out: nothing to subscribe to. What the hook reports is derived below, so the previous
    // session's board is never shown to whoever logs in next.
    if (!enabled) return;
    // The rule cannot see that every setState in `refresh` happens after an await, so this is the
    // initial load of a subscription, not a synchronous state write.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    let poll: number | null = null;
    const startPolling = () => {
      if (poll !== null) return;
      setStatus('polling');
      poll = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
    };
    const stopPolling = () => {
      if (poll === null) return;
      window.clearInterval(poll);
      poll = null;
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => stopPolling();
    }

    const source = new EventSource('/api/lockers/events');
    source.onopen = () => {
      stopPolling();
      setStatus('live');
      void refresh(); // catch up on anything missed while disconnected
    };
    // EventSource reconnects by itself; keep the board fresh by polling in the meantime.
    source.onerror = () => startPolling();

    const onEvent = (raw: MessageEvent<string>) => {
      try {
        const event = JSON.parse(raw.data) as LockerEvent;
        setFeed((prev) => [event, ...prev].slice(0, MAX_FEED));
      } catch {
        // A malformed frame is not worth breaking the board over; the refetch below still runs.
      }
      scheduleRefresh();
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent as EventListener);

    return () => {
      for (const type of EVENT_TYPES) source.removeEventListener(type, onEvent as EventListener);
      source.close();
      stopPolling();
      if (refetchTimer.current !== null) {
        window.clearTimeout(refetchTimer.current);
        // Leaving the id set would make scheduleRefresh a no-op for the next subscription.
        refetchTimer.current = null;
      }
    };
  }, [enabled, refresh, scheduleRefresh]);

  return enabled
    ? { lockers, error, loading, status, feed, revision, refresh }
    : {
        lockers: [],
        error: null,
        loading: true,
        status: 'connecting' as LiveStatus,
        feed: [],
        revision,
        refresh,
      };
}
