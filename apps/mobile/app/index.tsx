import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { useAuth } from '../lib/auth-context';

/**
 * Entry point (Bloc 12). Unlike `apps/courier`/`apps/restaurant`, browsing is
 * PUBLIC (docs/20 §24 — no account needed to look at restaurants/menus,
 * exactly `apps/web`'s own behaviour) — both signed-in and signed-out land on
 * the catalog; auth is only enforced per-screen at cart/addresses/checkout/
 * order-tracking, same split `apps/web`'s `/panier` and `/commandes/[id]`
 * already use.
 */
export default function Index() {
  const { state } = useAuth();

  if (state === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tokens.color.bg.canvas,
        }}
      >
        <ActivityIndicator color={tokens.color.brand.primary} size="large" />
      </View>
    );
  }

  return <Redirect href="/(app)/restaurants" />;
}
