import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { useAuth } from './auth-context';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Same hook as `apps/web`/`apps/restaurant`'s `useRoomRealtime` (Bloc 7,
 * docs/27 §17-18) — an event is a hint to refetch, never a payload to apply.
 * The RN-specific bit: the access token comes from `useAuth()` (in-memory,
 * loaded from `SecureStore`) rather than `localStorage`, and the room this
 * app actually subscribes to is `courier:{userId}` (docs/25 §23's `delivery.
 * assigned`/`delivery.accepted` reach it — see `domain-event-router.ts`).
 */
function realtimeOrigin(): string {
  const apiBaseUrl =
    (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
    'http://localhost:3001/v1';
  return apiBaseUrl.replace(/\/v\d+\/?$/, '');
}

export function useRoomRealtime(
  room: string | null,
  token: string | null,
  onChange: () => void | Promise<void>,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const onChangeRef = useRef(onChange);
  const lastRenewal = useRef(0);
  onChangeRef.current = onChange;
  const notifyChange = (): void => {
    void onChangeRef.current();
  };

  useEffect(() => {
    if (!room || !token) {
      setStatus('offline');
      return;
    }

    const socket: Socket = io(`${realtimeOrigin()}/rt`, {
      auth: { token },
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
    // session; the `AuthProvider` then hands this hook the new token, which
    // opens a new socket. At most once a minute, so a socket refused for
    // another reason cannot loop.
    socket.on('disconnect', (reason) => {
      setStatus('offline');
      if (reason !== 'io server disconnect' || Date.now() - lastRenewal.current < 60_000) return;
      lastRenewal.current = Date.now();
      void api.renewSession(token);
    });
    socket.on('connect_error', () => setStatus('offline'));
    socket.onAny(() => notifyChange());

    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [room, token]);

  return status;
}

/** Convenience wrapper: the courier's own room, built from the authenticated user. */
export function useCourierRealtime(onChange: () => void | Promise<void>): RealtimeStatus {
  const { user, accessToken } = useAuth();
  return useRoomRealtime(user ? `courier:${user.id}` : null, accessToken, onChange);
}
