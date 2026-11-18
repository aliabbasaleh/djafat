'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { getAccessToken } from './auth-storage';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Copied from `apps/web/src/lib/realtime.ts` (Bloc 7, docs/27 §17-18) — same
 * hook, same reasoning, a different app. The API base URL is `.../v1`; the
 * Socket.IO namespace lives at the server ROOT under `/rt`.
 */
function realtimeOrigin(): string {
  const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001/v1';
  return base.replace(/\/v\d+\/?$/, '');
}

/**
 * Subscribes to one room and calls `onChange` whenever the server says
 * something happened there. For the restaurant order board this is
 * `restaurant:orders:{restaurantId}` (docs/27 §4, §7 — already authorized
 * server-side by `RealtimeGateway.isAuthorizedForRoom` against the same
 * `user_roles` membership `OrdersService.listOrdersForRestaurant` resolves
 * the board from; Bloc 10 adds no new authorization surface here).
 *
 * Deliberately: **an event never carries UI state.** It is a hint that means
 * "refetch the board" — the REST response is what renders. This removes the
 * whole class of bug an event arriving before the initial load, or two
 * events arriving out of order, would otherwise cause, and makes
 * reconnection trivially correct: there is no replay to catch up on, no
 * cursor to track. On every (re)connect the hook re-joins the room and calls
 * `onChange` once, so whatever happened during an outage is picked up by the
 * refetch that follows.
 */
export function useRoomRealtime(
  room: string | null,
  onChange: () => void | Promise<void>,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const notifyChange = (): void => {
    void onChangeRef.current();
  };

  useEffect(() => {
    if (!room) return;
    const token = getAccessToken();
    if (!token) {
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
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    const join = (): void => {
      socket.emit('subscribe', { room });
      setStatus('live');
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
    socket.onAny(() => notifyChange());

    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [room]);

  return status;
}
