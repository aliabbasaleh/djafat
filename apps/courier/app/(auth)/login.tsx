import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { api } from '../../lib/api';
import { hasCourierAccess, type StoredCourierUser } from '../../lib/auth-storage';
import { useAuth } from '../../lib/auth-context';

type Step = 'phone' | 'code';

/**
 * Courier login (Bloc 11, docs/04 §4.7, same bounded OTP flow as every other
 * app in this repo). The one app-specific check: a successful OTP whose
 * account does NOT hold `courier` is refused HERE, client-side — the API
 * would reject every subsequent `/couriers/me/*` call anyway, but failing
 * fast is a better experience than a signed-in shell showing only errors.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode() {
    setError(null);
    setLoading(true);
    try {
      await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
      setStep('code');
    } catch {
      setError("Impossible d'envoyer le code. Vérifiez le numéro (+235XXXXXXXX).");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setLoading(true);
    try {
      const result = await api.http.post<{
        access: string;
        refresh: string;
        user: { id: string; phone: string; fullName: string | null; roles: string[] };
      }>('/auth/otp/verify', { body: { phone, code, purpose: 'login' } });

      const user: StoredCourierUser = {
        id: result.user.id,
        phone: result.user.phone,
        fullName: result.user.fullName,
        roles: result.user.roles,
      };
      if (!hasCourierAccess(user)) {
        setError('Ce compte n’est pas enregistré comme livreur DJAFAT.');
        return;
      }

      await signIn({ access: result.access, refresh: result.refresh, user });
      router.replace('/(app)/home');
    } catch {
      setError('Code invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>DJAFAT Livreur</Text>
        <Text style={styles.subtitle}>
          {step === 'phone' ? 'Connexion livreur.' : `Code envoyé au ${phone}.`}
        </Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {step === 'phone' ? (
        <View style={styles.form}>
          <Text style={styles.label}>Numéro de téléphone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+23566000000"
            placeholderTextColor={tokens.color.text.muted}
            keyboardType="phone-pad"
            autoFocus
          />
          <BigButton label="Envoyer le code" onPress={() => void requestCode()} loading={loading} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Code à 6 chiffres</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={tokens.color.text.muted}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <BigButton label="Vérifier" onPress={() => void verifyCode()} loading={loading} />
          <BigButton label="Changer de numéro" variant="ghost" onPress={() => setStep('phone')} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: tokens.space['10'], marginBottom: tokens.space['6'] },
  title: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  subtitle: {
    marginTop: tokens.space['2'],
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
  },
  form: { gap: tokens.space['4'] },
  label: { fontSize: tokens.type.size.label, fontWeight: '600', color: tokens.color.text.primary },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: tokens.color.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space['4'],
    fontSize: tokens.type.size.h2,
    color: tokens.color.text.primary,
    backgroundColor: tokens.color.bg.surface,
  },
  errorBox: {
    backgroundColor: tokens.color.state.dangerBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['4'],
  },
  errorText: { color: tokens.color.state.danger, fontSize: tokens.type.size.body },
});
