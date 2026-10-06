import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../lib/auth-context';

/** Root navigation shell (Bloc 12, docs/04 §4.9). Same split as `apps/courier`: `AuthProvider` loads the persisted session once; `(auth)`/`(app)` groups gate on it themselves. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
