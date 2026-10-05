import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@djafat/tokens';

/**
 * The one screen wrapper every route uses (Bloc 11, docs/04 §4.4 safe-area
 * discipline). `scroll=false` for screens whose single action must stay
 * pinned (the online/offline toggle, an active delivery's primary button) —
 * "gros boutons, une action principale par écran" (docs/04 §4.7) reads
 * worse inside a ScrollView that can hide the button below the fold.
 */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + tokens.space['4'],
    paddingBottom: insets.bottom + tokens.space['4'],
    paddingHorizontal: tokens.space['4'],
  };

  if (!scroll) {
    return <View style={[styles.root, padding]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.color.bg.canvas,
  },
});
