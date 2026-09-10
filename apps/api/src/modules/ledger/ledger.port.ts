import type { LedgerPort } from '@djafat/types';

/** DI token for the single ledger writer. Inject this, never the repository. */
export const LEDGER_PORT = Symbol('LEDGER_PORT');

export type { LedgerPort };
