import { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { tokens } from '@djafat/tokens';
import { accountStyles as s } from './styles';

interface FieldProps extends TextInputProps {
  readonly label: string;
  readonly error?: string | undefined;
  /** A password: hidden, with « Afficher / Masquer » (FEAT-020-VIS01). */
  readonly secret?: boolean;
}

/** A labelled input, its error under it (FEAT-020, SPEC-020-08). */
export function Field({ label, error, secret = false, ...input }: FieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={s.field}>
      <View style={s.labelRow}>
        <Text style={s.label}>{label}</Text>
        {secret && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? `Masquer : ${label}` : `Afficher : ${label}`}
            onPress={() => setVisible((v) => !v)}
            hitSlop={8}
          >
            <Text style={s.reveal}>👁 {visible ? 'Masquer' : 'Afficher'}</Text>
          </Pressable>
        )}
      </View>
      <TextInput
        style={[s.input, error ? s.inputError : null]}
        accessibilityLabel={label}
        placeholderTextColor={tokens.color.text.muted}
        secureTextEntry={secret && !visible}
        autoCapitalize={secret ? 'none' : input.autoCapitalize}
        {...input}
      />
      {error ? (
        <Text style={s.fieldError} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
