import { useState, type Ref } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { tokens } from '@djafat/tokens';
import { accountStyles as s } from './styles';

interface FieldProps extends TextInputProps {
  readonly label: string;
  readonly error?: string | undefined;
  /** A password: hidden, with « Afficher / Masquer » (FEAT-020-VIS01). */
  readonly secret?: boolean;
  /** FEAT-024 (SPEC-024-02 R1): « +235 » in front of the box, not typed. */
  readonly leadingText?: string | undefined;
  /** FEAT-024 (SPEC-024-04): « Vouliez-vous dire … ? » and « Oui, corriger » under the field. */
  readonly suggestion?: { readonly text: string; readonly onAccept: () => void } | null;
  /** To move the focus here after a refusal (review of FEAT-024, note 1). */
  readonly inputRef?: Ref<TextInput> | undefined;
}

/** A labelled input, its error under it (FEAT-020, SPEC-020-08). */
export function Field({
  label,
  error,
  secret = false,
  leadingText,
  suggestion,
  inputRef,
  ...input
}: FieldProps) {
  const [visible, setVisible] = useState(false);
  const box = (
    <TextInput
      ref={inputRef}
      aria-invalid={error ? true : undefined}
      style={[s.input, leadingText ? s.inputAffixed : null, error ? s.inputError : null]}
      accessibilityLabel={leadingText ? `${label}, indicatif ${leadingText}` : label}
      placeholderTextColor={tokens.color.text.muted}
      secureTextEntry={secret && !visible}
      autoCapitalize={secret ? 'none' : input.autoCapitalize}
      {...input}
    />
  );
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
      {leadingText ? (
        <View style={s.affixed}>
          <Text style={s.leading} importantForAccessibility="no" accessibilityElementsHidden>
            {leadingText}
          </Text>
          {box}
        </View>
      ) : (
        box
      )}
      {error ? (
        // Announced on both platforms (review of FEAT-024, note 1): role alert, live region.
        <Text
          style={s.fieldError}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          aria-live="polite"
        >
          {error}
        </Text>
      ) : null}
      {suggestion !== undefined ? (
        <View accessibilityLiveRegion="polite" aria-live="polite">
          {suggestion ? (
            <View style={s.suggestion}>
              <Text style={s.suggestionText}>{suggestion.text}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={suggestion.onAccept}
                style={s.suggestionAction}
              >
                <Text style={s.suggestionActionText}>Oui, corriger</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
