import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';

/** The warm cream page from the Warm Daylight design: calm, with no glows, so cards and faces carry the colour. */
export function Screen({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return (
    <View style={styles.page}>
      <SafeAreaView style={flush ? styles.flush : styles.body}>{children}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: 20, paddingBottom: 22, paddingTop: 12 },
  flush: { flex: 1 },
});
