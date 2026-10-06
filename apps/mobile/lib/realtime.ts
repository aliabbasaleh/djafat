import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { io, type Socket } from 'socket.io-client';

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
