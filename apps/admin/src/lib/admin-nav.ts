/**
 * A console page is allowed when it is an entry of the nav or a page under
 * one (`/admin/users/<id>`, `/admin/applications/courier/<id>`). An exact
 * match only — the rule since 0.23.0 — sent a full admin opening a detail
 * page back to the first entry (found by FEAT-022 part 2).
 */
export function isAllowedPath(
  pathname: string,
  items: ReadonlyArray<{ readonly href: string }>,
): boolean {
  return items.some(
    (i) => pathname === i.href || (i.href !== '/admin' && pathname.startsWith(`${i.href}/`)),
  );
}
