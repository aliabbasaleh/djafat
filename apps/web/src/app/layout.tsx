import type { Metadata, Viewport } from 'next';
import { toCssRootBlock } from '@djafat/tokens';
import { Header, Footer } from '@djafat/ui';
import { MobileNav } from '@/components/ui-client';
import { CartIndicator } from '@/components/CartIndicator';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'DJAFAT', template: '%s' },
  description: 'Livraison de repas à N’Djamena.',
  applicationName: 'DJAFAT',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e8531b',
};

/**
 * The app shell (docs/21 §6-§8): one `Header`/`MobileNav`/`Footer` for
 * every route, from `@djafat/ui` — a page never builds its own header. The
 * header's `search` slot is deliberately left empty here: each catalogue
 * page (`/`, `/restaurants`) already carries its own prominent search box
 * per the Bloc 2 mockup, and a second search field in the sticky header
 * would just be visual noise without adding capability yet (docs/21 §17.1).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <style dangerouslySetInnerHTML={{ __html: toCssRootBlock() }} />
      </head>
      <body>
        <Header
          wordmark="DJAFAT"
          locationLabel="📍 N’Djamena"
          navItems={[{ label: 'Mes adresses', href: '/adresses' }]}
          actions={<CartIndicator />}
        />
        {children}
        <Footer
          wordmark="DJAFAT"
          tagline="Livraison de repas à N’Djamena, pensée pour l’Afrique."
          columns={[
            {
              title: 'Découvrir',
              items: [
                { label: 'Restaurants', href: '/restaurants' },
                { label: 'À propos', soon: true },
                { label: 'Aide', soon: true },
              ],
            },
            {
              title: 'Partenaires',
              items: [
                { label: 'Devenir livreur', soon: true },
                { label: 'Devenir restaurant', soon: true },
              ],
            },
            {
              title: 'Légal',
              items: [
                { label: 'Conditions générales', soon: true },
                { label: 'Confidentialité', soon: true },
                { label: 'Contact', soon: true },
              ],
            },
          ]}
          bottomNote="© 2026 DJAFAT — N’Djamena, Tchad."
        />
        <MobileNav
          items={[
            { label: 'Accueil', icon: '🏠', href: '/' },
            { label: 'Restaurants', icon: '🍽️', href: '/restaurants' },
            { label: 'Panier', icon: '🛒', href: '/panier' },
            { label: 'Adresses', icon: '📍', href: '/adresses' },
            { label: 'Profil', icon: '👤', href: '/profil' },
          ]}
        />
      </body>
    </html>
  );
}
