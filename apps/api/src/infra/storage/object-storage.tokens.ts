/** The `ObjectStoragePort` in use (decision A6: no vendor SDK in business code). */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/**
 * The server-disk adapter, or `null` when files are not on this server's disk
 * (driver `none`, or production without `OBJECT_STORAGE_DIR`): `GET /files/:key`
 * then serves nothing (FEAT-022, SPEC-022-04).
 */
export const FILE_STORE = Symbol('FILE_STORE');
