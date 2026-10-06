import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { tokens } from '@djafat/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
}

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: tokens.color.brand.primary,
  danger: tokens.color.state.danger,
  secondary: tokens.color.bg.surfaceAlt,
  ghost: 'transparent',
};
const VARIANT_TEXT: Record<ButtonVariant, string> = {
  primary: tokens.color.brand.onPrimary,
  danger: tokens.color.brand.onPrimary,
  secondary: tokens.color.text.primary,
  ghost: tokens.color.brand.primary,
};

/** The one button component for the customer app (Bloc 12) — same structure as `apps/courier`'s `BigButton`, standard (not oversized) density. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        { backgroundColor: VARIANT_BG[variant] },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={VARIANT_TEXT[variant]} />
      ) : (
        <Text style={[styles.label, { color: VARIANT_TEXT[variant] }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.space['4'],
    flexDirection: 'row',
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { fontSize: tokens.type.size.button, fontWeight: '600' },
});
