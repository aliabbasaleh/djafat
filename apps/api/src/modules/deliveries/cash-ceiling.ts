/**
 * FEAT-010 (SPEC-010-01 R2): a courier holding cash at or above the ceiling
 * gets no new delivery offers. A ceiling <= 0 disables the rule. Pure.
 */
export function isCashBlocked(heldMinor: bigint, ceilingMinor: bigint): boolean {
  return ceilingMinor > 0n && heldMinor >= ceilingMinor;
}
