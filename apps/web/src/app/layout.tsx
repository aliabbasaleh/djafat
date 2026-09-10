import type { Metadata, Viewport } from 'next';
import { toCssRootBlock } from '@djafat/tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'DJAFAT',
  description: 'Livraison de repas à N’Djamena — bientôt.',
  applicationName: 'DJAFAT',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e8531b',
};

/** Root layout — mobile-first, tokens injected as CSS custom properties. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <style dangerouslySetInnerHTML={{ __html: toCssRootBlock() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
