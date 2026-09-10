export default function AdminShell() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: 'var(--djafat-color-brand-primary)' }}>DJAFAT · Admin</h1>
        <p style={{ color: 'var(--djafat-color-text-secondary)' }}>
          Shell technique (Bloc&nbsp;0). 2FA + step-up MFA et le back-office arrivent au
          Bloc&nbsp;9.
        </p>
      </div>
    </main>
  );
}
