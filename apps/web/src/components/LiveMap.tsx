'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrderTracking } from '@djafat/sdk';
import type * as Leaflet from 'leaflet';
import { cx } from '@djafat/ui';
import 'leaflet/dist/leaflet.css';
import { api } from '@/lib/api';
import { COURIER_RIDER_SVG } from './courier-rider-icon';
import styles from './LiveMap.module.css';

/**
 * Live delivery map (asked by the user: "see the courier on his motorbike,
 * like Deliveroo"): restaurant, home, and the courier gliding between the
 * positions the courier app reports. Polls the tracking route every 3 s while
 * mounted; OpenStreetMap tiles, attribution kept as required.
 */
const POLL_MS = 3000;
const SPEED_KMH = 20; // average motorbike speed in N'Djamena traffic, for the ETA only

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function LiveMap({ orderId }: { orderId: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const mapRef = useRef<{
    map: Leaflet.Map;
    courier: Leaflet.Marker | null;
    L: typeof Leaflet;
  } | null>(null);

  // poll the position
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const t = await api.orders.tracking(orderId);
        if (!stop) setTracking(t);
      } catch {
        /* keep the last known state */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [orderId]);

  // create the map once the restaurant and home are known
  useEffect(() => {
    if (!box.current || mapRef.current || !tracking?.restaurant || !tracking.dropoff) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !box.current || !tracking.restaurant || !tracking.dropoff) return;
      const map = L.map(box.current, { zoomControl: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      const emoji = (e: string, cls = '') =>
        L.divIcon({
          className: cx(styles['pin'], cls),
          html: e,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
      const r = [tracking.restaurant.lat, tracking.restaurant.lng] as [number, number];
      const d = [tracking.dropoff.lat, tracking.dropoff.lng] as [number, number];
      L.marker(r, { icon: emoji('🍽️') })
        .addTo(map)
        .bindTooltip(tracking.restaurant.name);
      L.marker(d, { icon: emoji('🏠') })
        .addTo(map)
        .bindTooltip('Chez vous');
      L.polyline([r, d], { color: '#E8531B', weight: 4, dashArray: '8 8', opacity: 0.8 }).addTo(
        map,
      );
      map.fitBounds(L.latLngBounds([r, d]).pad(0.35));
      mapRef.current = { map, courier: null, L };
    });
    return () => {
      cancelled = true;
    };
  }, [tracking]);

  // move the courier
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !tracking) return;
    if (tracking.courier) {
      const pos = [tracking.courier.lat, tracking.courier.lng] as [number, number];
      if (!m.courier) {
        m.courier = m.L.marker(pos, {
          icon: m.L.divIcon({
            className: cx(styles['courier']),
            html: `<div class="${styles['rider'] ?? ''}">${COURIER_RIDER_SVG}</div>`,
            iconSize: [56, 49],
            iconAnchor: [28, 44],
          }),
          zIndexOffset: 1000,
        }).addTo(m.map);
      } else {
        const before = m.courier.getLatLng();
        m.courier.setLatLng(pos); // CSS transition makes it glide
        // face the direction of travel: the drawing faces east, flip it going west
        const rider = m.courier.getElement()?.querySelector('div');
        if (rider && Math.abs(pos[1] - before.lng) > 1e-6) {
          rider.style.transform = pos[1] < before.lng ? 'scaleX(-1)' : 'scaleX(1)';
        }
      }
    } else if (m.courier) {
      m.courier.remove();
      m.courier = null;
    }
  });

  useEffect(
    () => () => {
      mapRef.current?.map.remove();
      mapRef.current = null;
    },
    [],
  );

  const eta =
    tracking?.courier && tracking.dropoff
      ? Math.max(1, Math.round((km(tracking.courier, tracking.dropoff) / SPEED_KMH) * 60))
      : null;

  return (
    <section className={cx(styles['wrap'])} aria-label="Carte de la livraison">
      <div ref={box} className={cx(styles['map'])} />
      <p className={cx(styles['eta'])}>
        {tracking?.courier
          ? `🛵 Le livreur arrive dans environ ${eta} min`
          : 'La position du livreur apparaîtra dès qu’il prendra votre commande.'}
      </p>
    </section>
  );
}
