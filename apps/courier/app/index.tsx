import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { useAuth } from '../lib/auth-context';

/** The one entry point — redirects based on the persisted session (Bloc 11). */
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

  return <Redirect href={state === 'signed-in' ? '/(app)/home' : '/(auth)/login'} />;
}
