import { useEffect, useState } from 'react';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SignedIn } from '@djafat/sdk';
import { tokens } from '@djafat/tokens';
import { Screen } from '../../components/Screen';
import { LoginForm, type AuthMethods } from '../../components/account/LoginForm';
import { RegisterForm } from '../../components/account/RegisterForm';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { saveDeviceToken } from '../../lib/auth-storage';
import { afterLoginRoute } from '../../lib/account';

type TabId = 'connexion' | 'inscription';

/**
 * « Mon compte » (FEAT-020, SPEC-020-08): the signed-out screen of the app —
 * « Se connecter » and « Créer un compte », the same flows as the site's
 * `/compte`. `redirect` mirrors the site's `?redirect=`: only an in-app path
 * is followed, otherwise the restaurants.
 */
export default function AccountScreen() {
  const router = useRouter();
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { signIn } = useAuth();
  const [tab, setTab] = useState<TabId>('connexion');
  const [methods, setMethods] = useState<AuthMethods | undefined>(undefined);

  useEffect(() => {
    api.auth
      .methods()
      .then((res) => setMethods(res.methods))
      .catch(() => setMethods(null));
  }, []);

  async function onSignedIn(result: SignedIn) {
    if (result.deviceToken) await saveDeviceToken(result.deviceToken);
    await signIn({
      access: result.access,
      refresh: result.refresh,
      user: { id: result.user.id, phone: result.user.phone, fullName: result.user.fullName },
    });
    // `redirect` comes from the URL, so it cannot be typed statically.
    router.replace(afterLoginRoute(redirect) as Href);
  }

  const tabs: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'connexion', label: 'Se connecter' },
    { id: 'inscription', label: 'Créer un compte' },
  ];

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.brand}>DJAFAT</Text>
        <Text style={styles.title} accessibilityRole="header">
          Mon compte
        </Text>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t.id)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'connexion' ? (
        <LoginForm methods={methods ?? null} onSignedIn={onSignedIn} />
      ) : (
        <RegisterForm onSignedIn={onSignedIn} onGoToLogin={() => setTab('connexion')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: tokens.space['8'], marginBottom: tokens.space['4'] },
  brand: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  title: {
    marginTop: tokens.space['2'],
    fontSize: tokens.type.size.h1,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: tokens.space['4'],
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border.default,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: tokens.color.brand.primary },
  tabLabel: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  tabLabelActive: { color: tokens.color.text.primary, fontWeight: '700' },
});
