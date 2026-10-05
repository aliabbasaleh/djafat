import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { io, type Socket } from 'socket.io-client';
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
    socket.on('disconnect', () => setStatus('offline'));
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
