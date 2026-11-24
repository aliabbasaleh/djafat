/**
 * FEAT-022 (SPEC-022-04 R3): a private photo's link is its own authorization for
 * 5 minutes, so a request log must not keep it — `GET /v1/files/<key>?exp=…&sig=…`
 * is logged without its query (review of FEAT-022 parts 1-2, note 19). Pure.
 */
export function withoutFileSignature<T extends { url?: unknown; query?: unknown }>(req: T): T {
  if (typeof req.url !== 'string' || !/\/files\/[^?]*\?/.test(req.url)) return req;
  return { ...req, url: req.url.replace(/\?.*$/, '?[redacted]'), query: '[redacted]' };
}
