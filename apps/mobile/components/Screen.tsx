import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@djafat/tokens';

/** Same wrapper as `apps/courier/components/Screen.tsx` (Bloc 11). */
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
  root: { flex: 1, backgroundColor: tokens.color.bg.canvas },
});
