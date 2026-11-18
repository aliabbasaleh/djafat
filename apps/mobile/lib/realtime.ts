import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Same hook as `apps/courier/lib/realtime.ts` (Bloc 11) / `apps/web`'s
 * `useRoomRealtime` (Bloc 7) — an event is a hint to refetch, never a
 * payload to apply. This app joins `order:{id}` (docs/27 §4) for order
 * tracking.
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
