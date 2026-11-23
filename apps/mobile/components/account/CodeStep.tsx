import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../Button';
import { RESEND_COOLDOWN_SECONDS } from '../../lib/account';
import { Field } from './Field';
import { accountStyles as s } from './styles';

interface CodeStepProps {
  readonly title: string;
  readonly intro: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly submitLabel?: string | undefined;
  readonly remember?:
    | { readonly checked: boolean; readonly onChange: (v: boolean) => void }
    | undefined;
  readonly before?: ReactNode;
  readonly children?: ReactNode;
  readonly onSubmit: (code: string) => void;
  readonly onResend?: (() => Promise<void>) | undefined;
  readonly onBack: () => void;
}

/** The code step (FEAT-020-VIS03): « Renvoyer le code » waits 60 s between two sends. */
export function CodeStep(props: CodeStepProps) {
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  return (
    <View style={s.form}>
      <Text style={s.heading} accessibilityRole="header">
        {props.title}
      </Text>
      <Text style={s.intro}>{props.intro}</Text>
      {props.before}
      {props.error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{props.error}</Text>
        </View>
      ) : null}
      <Field
        label="Code à 6 chiffres"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        placeholder="123456"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
      />
      {props.children}
      {props.remember ? (
        <Pressable
          style={s.checkboxRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: props.remember.checked }}
          onPress={() => props.remember?.onChange(!props.remember.checked)}
        >
          <View style={[s.checkbox, props.remember.checked && s.checkboxOn]}>
            {props.remember.checked ? <Text style={s.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={s.label}>Se souvenir de cet appareil</Text>
        </Pressable>
      ) : null}
      <Button
        label={props.submitLabel ?? 'Vérifier'}
        onPress={() => props.onSubmit(code.trim())}
        loading={props.busy}
        fullWidth
      />
      {props.onResend ? (
        <Pressable
          accessibilityRole="button"
          disabled={wait > 0}
          onPress={() => {
            void props.onResend?.().then(() => setWait(RESEND_COOLDOWN_SECONDS));
          }}
        >
          <Text style={[s.link, wait > 0 && s.linkDisabled]}>
            {wait > 0 ? `Renvoyer le code (dans ${wait} s)` : 'Renvoyer le code'}
          </Text>
        </Pressable>
      ) : null}
      <Button label="Retour" variant="ghost" onPress={props.onBack} fullWidth />
    </View>
  );
}
