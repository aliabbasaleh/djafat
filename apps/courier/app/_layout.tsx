import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../lib/auth-context';

/** Root navigation shell (Bloc 11, docs/04 §4.9). `AuthProvider` loads the persisted session once; `(auth)`/`(app)` groups each gate on it themselves (same split as `(app)/_layout.tsx` below). */
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
