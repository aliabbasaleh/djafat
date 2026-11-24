import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { tokens } from '@djafat/tokens';
import type { PhoneUse } from '@djafat/core';
import { DIAL_CODE, phoneFieldShowsDialCode } from '@djafat/sdk';

interface PhoneInputProps extends Omit<TextInputProps, 'style' | 'keyboardType' | 'value'> {
  /** The field's name, read with « indicatif +235 » while the prefix shows. */
  readonly label: string;
  readonly value: string;
  /** What the number is for (SPEC-024-02): a Mobile Money number always keeps « +235 ». */
  readonly use?: PhoneUse;
  /** The screen's own input style. */
  readonly inputStyle: StyleProp<TextStyle>;
}

/**
 * A phone field with « +235 » in front of the box (FEAT-024, SPEC-024-02 R1):
 * the 8 digits are enough; a number typed with another country code replaces
 * the prefix, except for Mobile Money.
 */
export function PhoneInput({
  label,
  value,
  use = 'account',
  inputStyle,
  ...rest
}: PhoneInputProps) {
  const dial = phoneFieldShowsDialCode(value, use);
  return (
    <View style={styles.row}>
      {dial ? (
        <Text style={styles.leading} importantForAccessibility="no" accessibilityElementsHidden>
          {DIAL_CODE}
        </Text>
      ) : null}
      <TextInput
        style={[inputStyle, styles.box, dial ? styles.affixed : null]}
        value={value}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel={dial ? `${label}, indicatif ${DIAL_CODE}` : label}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  leading: {
    minHeight: 48,
    paddingHorizontal: tokens.space['3'],
    lineHeight: 46,
    textAlignVertical: 'center',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: tokens.color.border.strong,
    borderTopLeftRadius: tokens.radius.md,
    borderBottomLeftRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.surfaceAlt,
    color: tokens.color.text.secondary,
    fontSize: tokens.type.size.body,
    fontWeight: '600',
  },
  box: { flex: 1 },
  affixed: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
});
