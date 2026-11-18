'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { getAccessToken } from './auth-storage';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * The API base URL is `.../v1`; the Socket.IO namespace lives at the server
 * ROOT under `/rt` (see `RealtimeGateway`'s `@WebSocketGateway`). Strip the
 * version prefix rather than hardcoding a second env var, so one setting keeps
 * both transports pointing at the same backend.
 */
function realtimeOrigin(): string {
  const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';
  return base.replace(/\/v\d+\/?$/, '');
}

/**
 * Subscribes to one room and calls `onChange` whenever the server says
 * something happened there (Bloc 7, docs/27 §17-18).
 *
 * The deliberate shape of this hook: **it never applies an event payload to
 * UI state.** An event is a hint that means "refetch"; the REST response is
 * what renders. That single rule removes a whole class of bug the mandate
 * warns about (docs/27 §9): an event arriving before the initial load, or two
 * events arriving out of order, cannot produce an inconsistent screen, because
 * the screen is only ever a function of a REST read.
 *
 * It also makes reconnection trivially correct (docs/27 §18): there is no
 * replay to catch up on, no cursor to track. On every (re)connect the hook
 * re-joins the room and calls `onChange` once, so whatever happened during the
 * outage is picked up by the refetch that follows.
 */
export function useRoomRealtime(
  room: string | null,
  onChange: () => void | Promise<void>,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  // Kept in a ref so a new `onChange` identity on every render does not tear
  // the socket down and reconnect on each parent re-render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Fire-and-forget: a refetch failure is the page's own concern to render, not the socket's. */
  const notifyChange = (): void => {
    void onChangeRef.current();
  };

  useEffect(() => {
    if (!room) return;
    const token = getAccessToken();
    if (!token) {
      // No session: the gateway would disconnect us anyway (docs/27 §19).
      // Staying `offline` keeps the REST-only path working unchanged.
      setStatus('offline');
      return;
    }

    // FE-02: the token is read at every (re)connection, so a renewed one is
    // used; `connectedWith` remembers which one this socket presented.
    let connectedWith: string | null = token;
    const socket: Socket = io(`${realtimeOrigin()}/rt`, {
      auth: (cb) => {
        connectedWith = getAccessToken();
        cb({ token: connectedWith });
      },
      transports: ['websocket'],
      // Let socket.io handle backoff; the REST fallback covers any gap.
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    const join = (): void => {
      socket.emit('subscribe', { room });
      setStatus('live');
      // Resynchronise on every connect, including reconnects: this is what
      // makes a missed transition during an outage self-healing.
      notifyChange();
    };

    socket.on('connect', join);
    // The server closes a socket whose access token expired (15 min), and
    // socket.io never reconnects after a server-side close (FE-02): renew the
    // session, then reconnect. At most once a minute, so a socket the server
    // refuses for another reason cannot loop.
    let lastRenewal = 0;
    socket.on('disconnect', (reason) => {
      setStatus('offline');
      if (reason !== 'io server disconnect' || Date.now() - lastRenewal < 60_000) return;
      lastRenewal = Date.now();
      void api.renewSession(connectedWith).then((renewed) => {
        if (renewed) socket.connect();
      });
    });
    socket.on('connect_error', () => setStatus('offline'));
    // One handler for every event the room can carry: the hook does not care
    // WHICH event arrived, only that something changed (see the doc comment).
    socket.onAny(() => notifyChange());

    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [room]);

  return status;
}
