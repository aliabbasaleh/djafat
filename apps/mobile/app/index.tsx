import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { createApiClient } from '@djafat/sdk';
import { tokens } from '@djafat/tokens';

const apiBaseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3001/v1';

const api = createApiClient({ baseUrl: apiBaseUrl });

export default function Home() {
  const insets = useSafeAreaInsets();
  const [apiStatus, setApiStatus] = useState('vérification…');

  useEffect(() => {
    api
      .health()
      .then((h) => setApiStatus(`${h.status} (v${h.version})`))
      .catch(() => setApiStatus('API injoignable'));
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.title}>DJAFAT</Text>
      <Text style={styles.subtitle}>Socle mobile — Bloc 0.</Text>
      <Text style={styles.meta}>API : {apiStatus}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.color.bg.canvas,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  subtitle: { marginTop: 8, color: tokens.color.text.secondary },
  meta: { marginTop: 16, color: tokens.color.text.primary },
});
