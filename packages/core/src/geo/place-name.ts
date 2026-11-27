/**
 * FEAT-022 (SPEC-022-09 R4): the key two place names are compared by —
 * lower-case, accents removed, spaces, dashes and apostrophes collapsed — so
 * « Paris-Congo », « paris congo » and « PARIS  CONGO » are one neighbourhood.
 */
export function placeNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-‐-―'’]+/g, ' ')
    .trim();
}

/** A place name as typed under « Autre » or by an admin: trimmed, inner spaces collapsed. */
export function tidyPlaceName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}
