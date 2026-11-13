import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { api } from './api';

/**
 * Courier position reporting (Bloc 11, docs/04 §4.7, docs/25 §9, §34) —
 * FOREGROUND ONLY. Starts `Location.watchPositionAsync` (throttled to the
 * 5-10s window docs/04 §4.7 asks for) whenever `active` is true and stops it
 * the moment it's false or the component unmounts; sends every fix straight
 * to the already-built `POST /couriers/me/location` (validated server-side —
 * see `CouriersService.updateLocation`).
 *
 * **What this deliberately does NOT do** — the real debt of this bloc:
 * docs/04 §4.5/§57 calls background tracking "le point technique le plus
 * fragile" and asks for `expo-task-manager` + a foreground SERVICE
 * (persistent notification) so OEM task-killers (Xiaomi/Transsion, very
 * present in the target market) don't silently stop it. That needs a native
 * background-location entitlement + a `TaskManager.defineTask` registered
 * outside React's tree, configured per-platform, and genuinely exercised on
 * a real device/emulator to know it works — none of which this environment
 * can build or verify (no Android/iOS simulator here). Shipping a
 * `expo-task-manager` call that has never once actually run would be
 * exactly the kind of unverified "written, presented as done" this project
 * explicitly refuses to do (docs/32, docs/33 §dette precedent). Foreground
 * tracking while the app is open and a delivery is active is the honest,
 * verifiable slice; the background service is listed as the real remaining
 * gap in the final report, not hidden behind a plausible-looking stub.
 */
const THROTTLE_MS = 8_000;
/**
 * A courier waiting for a course does not move, so `watchPositionAsync`
 * (distanceInterval 20 m) stays silent — and dispatch ignores a position older
 * than `courier_location_stale_seconds` (120 s by default). The last fix is
 * therefore re-sent at this pace while reporting is active.
 */
const HEARTBEAT_MS = 45_000;

export function useForegroundLocationReporting(active: boolean): void {
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastRef = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED || cancelled) return;

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: THROTTLE_MS,
          distanceInterval: 20, // meters — avoids a flood of near-identical fixes while stationary
        },
        (position) => {
          lastRef.current = position;
          send(position, new Date(position.timestamp));
        },
      );
      if (cancelled) {
        stop(sub);
      } else {
        subscriptionRef.current = sub;
      }
    })();

    const heartbeat = setInterval(() => {
      if (lastRef.current) send(lastRef.current, new Date());
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      if (subscriptionRef.current) stop(subscriptionRef.current);
      subscriptionRef.current = null;
    };
  }, [active]);
}

/** `remove()` throws on some platforms (expo-location web); stopping must never crash the screen. */
function stop(sub: Location.LocationSubscription): void {
  try {
    sub.remove();
  } catch {
    // already stopped, or not supported here: nothing to release
  }
}

function send(position: Location.LocationObject, at: Date): void {
  void api.courier.updateLocation({
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    ...(position.coords.accuracy !== null ? { accuracyM: position.coords.accuracy } : {}),
    ...(position.coords.heading !== null && position.coords.heading >= 0
      ? { heading: position.coords.heading }
      : {}),
    ...(position.coords.speed !== null && position.coords.speed >= 0
      ? { speedMps: position.coords.speed }
      : {}),
    timestamp: at.toISOString(),
  });
}
