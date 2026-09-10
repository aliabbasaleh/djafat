import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Bloc-0 shell page. Proves the app boots, tokens are applied and the SDK can
 * reach the API. No business UI yet.
 */
export default async function HomePage() {
  let apiStatus = 'indisponible';
  try {
    const health = await api.health();
    apiStatus = `${health.status} (v${health.version})`;
  } catch {
    apiStatus = 'API injoignable (lancez `pnpm infra:up` + `pnpm --filter @djafat/api dev`)';
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--djafat-space-6)',
      }}
    >
      <section style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 'var(--djafat-type-size-display)',
            color: 'var(--djafat-color-brand-primary)',
          }}
        >
          DJAFAT
        </h1>
        <p style={{ color: 'var(--djafat-color-text-secondary)' }}>
          Socle technique — Bloc&nbsp;0. Rien d’applicatif ici pour l’instant.
        </p>
        <p style={{ marginTop: 'var(--djafat-space-4)' }}>
          <strong>API :</strong> {apiStatus}
        </p>
      </section>
    </main>
  );
}
