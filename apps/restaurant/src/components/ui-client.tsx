'use client';

/**
 * Same re-export boundary as `apps/admin`/`apps/web` (docs/21 §17.2 —
 * Next.js's `transpilePackages` does not reliably preserve a `'use client'`
 * directive living INSIDE an external transpiled workspace package once a
 * page is statically prerendered).
 */
export { Button, Input, Select, Checkbox, Alert, Textarea, Switch, Modal } from '@djafat/ui';
