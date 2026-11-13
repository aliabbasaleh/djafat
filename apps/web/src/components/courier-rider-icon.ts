/**
 * Courier riding a motorbike (inline SVG), used as the live map marker:
 * a rider in a DJAFAT-orange jacket and helmet, with the delivery box on the
 * back. Drawn facing right; the map flips it when the courier heads west.
 */
export const COURIER_RIDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 56" width="56" height="49" aria-hidden="true">
  <ellipse cx="32" cy="52" rx="24" ry="3" fill="rgba(0,0,0,.18)"/>
  <circle cx="14" cy="42" r="9" fill="#222"/><circle cx="14" cy="42" r="4" fill="#bbb"/>
  <circle cx="50" cy="42" r="9" fill="#222"/><circle cx="50" cy="42" r="4" fill="#bbb"/>
  <path d="M14 42 L26 30 L42 30 L50 42" stroke="#333" stroke-width="4" fill="none" stroke-linejoin="round"/>
  <path d="M22 33 H44 Q48 33 49 37 L50 40 H20 Z" fill="#E8531B"/>
  <path d="M44 24 L52 22" stroke="#333" stroke-width="3" stroke-linecap="round"/>
  <rect x="4" y="18" width="16" height="14" rx="2" fill="#E8531B" stroke="#B83E10" stroke-width="1.5"/>
  <text x="12" y="28" font-family="Arial" font-size="7" font-weight="bold" fill="#fff" text-anchor="middle">DJ</text>
  <path d="M26 31 L30 20 L38 18 L44 24" stroke="#1f2d5a" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M28 20 L35 8 L42 12 L38 22 Z" fill="#E8531B"/>
  <path d="M40 15 L47 23" stroke="#E8531B" stroke-width="4" stroke-linecap="round"/>
  <circle cx="38" cy="6" r="6.5" fill="#E8531B" stroke="#B83E10" stroke-width="1.5"/>
  <path d="M38 6 h6.5 a6.5 6.5 0 0 1 -2 4.5 h-4.5 z" fill="#1d1d1d"/>
</svg>`;
