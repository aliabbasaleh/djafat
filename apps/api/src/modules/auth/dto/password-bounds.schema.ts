/**
 * The longest raw password accepted anywhere (FEAT-020): a guard before NFKC and
 * hashing — the password rule itself caps at 128 characters.
 */
export const MAX_RAW_PASSWORD = 1024;
