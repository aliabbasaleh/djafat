import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BG: Record<BadgeTone, string> = {
  success: tokens.color.state.successBg,
  warning: tokens.color.state.warningBg,
  danger: tokens.color.state.dangerBg,
  info: tokens.color.state.infoBg,
  neutral: tokens.color.bg.surfaceAlt,
};
const TONE_TEXT: Record<BadgeTone, string> = {
  success: tokens.color.state.success,
  warning: tokens.color.state.warning,
  danger: tokens.color.state.danger,
  info: tokens.color.state.info,
  neutral: tokens.color.text.secondary,
};

/** Same "colour is never the only signal" rule as `@djafat/ui`'s web `Badge` — always paired with text. */
export function Badge({ tone = 'neutral', label }: { tone?: BadgeTone; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={[styles.label, { color: TONE_TEXT[tone] }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.space['3'],
    paddingVertical: tokens.space['1'],
    borderRadius: tokens.radius.pill,
  },
  label: {
    fontSize: tokens.type.size.small,
    fontWeight: '600',
  },
});
