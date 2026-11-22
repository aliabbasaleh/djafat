import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { compteHref } from '@/lib/account';

/**
 * FEAT-020 (SPEC-020-07): « Connexion » became « Compte ». Old links and
 * bookmarks `/connexion?redirect=X` land on `/compte?redirect=X`.
 */
export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)['redirect'];
  redirect(compteHref(typeof raw === 'string' ? raw : null) as Route);
}
