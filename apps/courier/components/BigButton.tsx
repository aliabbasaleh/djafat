import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { tokens } from '@djafat/tokens';

export type BigButtonVariant = 'primary' | 'danger' | 'secondary' | 'ghost';

export interface BigButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: BigButtonVariant;
  readonly disabled?: boolean;
  readonly loading?: boolean;
}

const VARIANT_BG: Record<BigButtonVariant, string> = {
  primary: tokens.color.brand.primary,
  danger: tokens.color.state.danger,
  secondary: tokens.color.bg.surface,
  ghost: 'transparent',
};
const VARIANT_TEXT: Record<BigButtonVariant, string> = {
  primary: tokens.color.brand.onPrimary,
  danger: tokens.color.brand.onPrimary,
  secondary: tokens.color.text.primary,
  ghost: tokens.color.text.secondary,
};

/**
 * The ONE button component for the courier app (Bloc 11, docs/04 §4.7 "gros
 * boutons, peu de texte... contraste élevé (usage en extérieur, plein
 * soleil)") — large touch target (56px min height), high-contrast fill,
 * never a subtle text link for a primary action.
 */
export function BigButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: BigButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      // react-native-web ignores `accessibilityState`: `disabled` is what says « indisponible »
      // in the browser (aria-disabled) — found by FEAT-022's run of the app in the browser.
      disabled={isDisabled}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: VARIANT_BG[variant] },
        variant === 'secondary' && styles.secondaryBorder,
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
    minHeight: 56,
    borderRadius: tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.space['6'],
  },
  secondaryBorder: {
    borderWidth: 1,
    borderColor: tokens.color.border.strong,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
  },
});
