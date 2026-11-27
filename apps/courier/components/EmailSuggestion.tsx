import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { emailSuggestionText } from '@djafat/sdk';

/**
 * « Vouliez-vous dire … ? » under an e-mail field (FEAT-024, SPEC-024-04),
 * with « Oui, corriger ». The live region stays, so the suggestion is read
 * when it appears.
 */
export function EmailSuggestion({
  suggestion,
  onAccept,
}: {
  readonly suggestion: string | null;
  readonly onAccept: (address: string) => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" aria-live="polite">
      {suggestion ? (
        <View style={styles.row}>
          <Text style={styles.text}>{emailSuggestionText(suggestion)}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAccept(suggestion)}
            style={styles.action}
          >
            <Text style={styles.actionText}>Oui, corriger</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space['2'] },
  text: { fontSize: tokens.type.size.label, color: tokens.color.text.primary },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: tokens.space['3'],
    borderWidth: 1,
    borderColor: tokens.color.brand.primary,
    borderRadius: tokens.radius.md,
  },
  actionText: {
    fontSize: tokens.type.size.label,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
});
