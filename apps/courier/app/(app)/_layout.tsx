import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/auth-context';

/** The gate for every `/(app)/**` screen — mirrors `apps/restaurant`'s `RestaurantLayout` (Bloc 10): deny-by-default, redirect to login when the session is absent. Declarative — `state` alone drives the redirect, no effect needed. */
export default function AppLayout() {
  const { state } = useAuth();

  if (state === 'loading') return null;
  if (state !== 'signed-in') return <Redirect href="/(auth)/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
