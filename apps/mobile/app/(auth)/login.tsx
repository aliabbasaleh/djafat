import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

type Step = 'phone' | 'code';

/**
 * Customer login (Bloc 12, docs/04 §4.7-ish, same bounded OTP flow every app
 * in this repo uses). `redirect` mirrors `apps/web`'s `?redirect=` query
 * param — reached from the cart/checkout/order-tracking screens that need
 * auth, so sign-in lands the customer back where they were headed.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
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
        user: { id: string; phone: string; fullName: string | null };
      }>('/auth/otp/verify', { body: { phone, code, purpose: 'login' } });

      await signIn({
        access: result.access,
        refresh: result.refresh,
        user: {
          id: result.user.id,
          phone: result.user.phone,
          fullName: result.user.fullName,
        },
      });
      router.replace((redirect as `/${string}`) ?? '/(app)/restaurants');
    } catch {
      setError('Code invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>DJAFAT</Text>
        <Text style={styles.subtitle}>
          {step === 'phone' ? 'Connectez-vous pour commander.' : `Code envoyé au ${phone}.`}
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
          <Button
            label="Envoyer le code"
            onPress={() => void requestCode()}
            loading={loading}
            fullWidth
          />
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
          <Button label="Vérifier" onPress={() => void verifyCode()} loading={loading} fullWidth />
          <Button
            label="Changer de numéro"
            variant="ghost"
            onPress={() => setStep('phone')}
            fullWidth
          />
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
  form: { gap: tokens.space['3'] },
  label: { fontSize: tokens.type.size.label, fontWeight: '600', color: tokens.color.text.primary },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: tokens.color.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space['4'],
    fontSize: tokens.type.size.h3,
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
