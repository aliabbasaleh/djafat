import type { Metadata } from 'next';
import { toCssRootBlock } from '@djafat/tokens';

export const metadata: Metadata = {
  title: 'DJAFAT Restaurant',
  description: 'Tableau de bord restaurant DJAFAT',
};

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
