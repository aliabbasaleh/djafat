import { redirect } from 'next/navigation';

/** Bloc 9 (docs/30 §admin-web): the back-office now lives at `/admin` (gated, redirects to `/login` if unauthenticated). */
export default function RootPage() {
  redirect('/admin');
}
