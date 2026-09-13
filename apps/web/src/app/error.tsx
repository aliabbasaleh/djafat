'use client';

/**
 * Root error boundary (docs/03 §3.7).
 *
 * Numeric design tokens (`--djafat-space-*`, `--djafat-radius-*`,
 * `--djafat-type-size-*`) are stored UNITLESS in `@djafat/tokens` — the
 * same source feeds React Native, where sizes are plain numbers
 * (`packages/tokens/src/tokens.spec.ts`). Used directly as a CSS length
 * (`fontSize: 'var(--djafat-radius-md)'`) that is invalid-at-computed-value
 * time and the browser drops the whole declaration. `calc(var(...) * 1px)`
 * turns the unitless number into a real length — see docs/20 Bugs trouvés.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h2 style={{ color: 'var(--djafat-color-state-danger)' }}>Une erreur est survenue</h2>
        <p style={{ color: 'var(--djafat-color-text-secondary)' }}>Réessayez dans un instant.</p>
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            padding: '12px 20px',
            minHeight: 48,
            borderRadius: 'calc(var(--djafat-radius-md) * 1px)',
            border: 'none',
            background: 'var(--djafat-color-brand-primary)',
            color: 'var(--djafat-color-brand-on-primary)',
            fontSize: 'calc(var(--djafat-type-size-body) * 1px)',
          }}
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
