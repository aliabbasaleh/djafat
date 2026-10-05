import { redirect } from 'next/navigation';

/** Bloc 10 (docs/33 §profile): the order board now lives at `/restaurant` (gated, redirects to `/login` if unauthenticated) — same split `apps/admin` uses for `/admin`. */
export default function RootPage() {
  redirect('/restaurant');
}
