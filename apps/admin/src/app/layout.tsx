import type { Metadata } from 'next';
import { toCssRootBlock } from '@djafat/tokens';

export const metadata: Metadata = { title: 'DJAFAT Admin', description: 'Back-office DJAFAT' };

/**
 * The admin app shell (Bloc 9, docs/30 §admin-web). Deliberately minimal —
 * the real navigation/auth gate lives in `app/admin/layout.tsx`, scoped to
 * the `/admin/**` segment only, so `/login` never sees it (no redirect
 * loop). This root layout is just the HTML/CSS skeleton, same pattern as
 * `apps/web`.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `*{box-sizing:border-box}body{margin:0;font-family:var(--djafat-type-family,system-ui,sans-serif);background:var(--djafat-color-bg-canvas);color:var(--djafat-color-text-primary)}\n${toCssRootBlock()}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
