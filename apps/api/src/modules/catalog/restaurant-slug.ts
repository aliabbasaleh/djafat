/**
 * FEAT-022 (FEAT-022-Q07): a signed-up restaurant's web address — its name in
 * lower case, without accents or punctuation, words joined by dashes — and,
 * when taken, the first free `-2`, `-3`… Pure: the caller lists the taken ones.
 */

export function slugifyRestaurantName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'restaurant';
}

/** The base if free, else `base-2`, `base-3`… — `taken` holds every slug starting with `base`. */
export function firstFreeSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
