'use client';

/** Root error boundary (docs/03 §3.7). */
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
            borderRadius: 'var(--djafat-radius-md)',
            border: 'none',
            background: 'var(--djafat-color-brand-primary)',
            color: 'var(--djafat-color-brand-on-primary)',
            fontSize: 'var(--djafat-type-size-body)',
          }}
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
