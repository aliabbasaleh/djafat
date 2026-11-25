'use client';

import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { cx } from '@djafat/ui';
import 'leaflet/dist/leaflet.css';
import styles from './LocationMap.module.css';

/** Where the map opens when the restaurant has no point yet: N'Djamena. */
export const NDJAMENA_CENTRE = { lat: 12.1348, lng: 15.0557 } as const;

export interface MapPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * FEAT-022 (SPEC-022-05 R1, step 1): the restaurant's point on the map — a
 * tap places it, the pin can be dragged; OpenStreetMap tiles with their
 * attribution, the same Leaflet as the customer site's delivery map
 * (`apps/web/src/components/LiveMap.tsx`). The address field next to it
 * still works if the map cannot load; « Utiliser ma position » places the
 * point without it, and « Placer le point au centre de la carte » without a
 * mouse (the map pans with the arrow keys).
 */
export function LocationMap({
  point,
  onChange,
  readOnly = false,
  label,
}: {
  readonly point: MapPoint | null;
  readonly onChange: (point: MapPoint) => void;
  readonly readOnly?: boolean;
  readonly label: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<{ map: Leaflet.Map; marker: Leaflet.Marker | null; L: typeof Leaflet } | null>(
    null,
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pointRef = useRef(point);
  pointRef.current = point;

  function place(next: MapPoint) {
    const current = map.current;
    if (!current) return;
    if (current.marker) {
      current.marker.setLatLng([next.lat, next.lng]);
      return;
    }
    const icon = current.L.divIcon({
      className: cx(styles['pin']),
      html: '📍',
      iconSize: [36, 36],
      iconAnchor: [18, 34],
    });
    const marker = current.L.marker([next.lat, next.lng], {
      icon,
      draggable: !readOnly,
      title: 'Votre restaurant',
    }).addTo(current.map);
    if (!readOnly) {
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        onChangeRef.current({ lat: at.lat, lng: at.lng });
      });
    }
    current.marker = marker;
  }

  // The map, once.
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !box.current || map.current) return;
      const start = pointRef.current ?? NDJAMENA_CENTRE;
      const created = L.map(box.current, { attributionControl: true }).setView(
        [start.lat, start.lng],
        pointRef.current ? 16 : 13,
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(created);
      map.current = { map: created, marker: null, L };
      if (pointRef.current) place(pointRef.current);
      if (!readOnly) {
        created.on('click', (event: Leaflet.LeafletMouseEvent) => {
          const next = { lat: event.latlng.lat, lng: event.latlng.lng };
          place(next);
          onChangeRef.current(next);
        });
      }
    });
    return () => {
      cancelled = true;
      map.current?.map.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; the point follows below
  }, []);

  // A point set from outside (« Utiliser ma position »).
  useEffect(() => {
    if (!point || !map.current) return;
    place(point);
    map.current.map.setView([point.lat, point.lng], Math.max(map.current.map.getZoom(), 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the coordinates only
  }, [point?.lat, point?.lng]);

  return (
    <div className={cx(styles['wrap'])}>
      <div ref={box} className={cx(styles['map'])} role="region" aria-label={label} />
      {!readOnly && (
        // Without a mouse: the map pans with the arrow keys, then the point goes to its centre.
        <button
          type="button"
          className={cx(styles['centre'])}
          onClick={() => {
            const current = map.current;
            if (!current) return;
            const at = current.map.getCenter();
            const next = { lat: at.lat, lng: at.lng };
            place(next);
            onChangeRef.current(next);
          }}
        >
          Placer le point au centre de la carte
        </button>
      )}
    </div>
  );
}
