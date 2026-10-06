import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';

export interface StepperProps {
  readonly value: number;
  readonly onChange: (next: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
}

/** Quantity +/- control shared by the product and cart screens (Bloc 12) — same pattern `apps/web`'s stepper UI follows. */
export function Stepper({ value, onChange, min = 1, max = 99, disabled = false }: StepperProps) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Diminuer la quantité"
        disabled={disabled || value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.button, (disabled || value <= min) && styles.disabled]}
      >
        <Text style={styles.buttonLabel}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Augmenter la quantité"
        disabled={disabled || value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.button, (disabled || value >= max) && styles.disabled]}
      >
        <Text style={styles.buttonLabel}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] },
  button: {
    width: 36,
    height: 36,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  buttonLabel: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  value: { fontSize: tokens.type.size.h3, fontWeight: '600', minWidth: 24, textAlign: 'center' },
});
