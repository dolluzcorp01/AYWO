// Date and time side by side on one line, as people say them together: "25 Dec, 6:30 pm". Each used to take a
// full line of its own. Where the two cannot fit (the website's time picker on a narrow phone), time drops below.
import { Children, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

/** `dates` is for two dates side by side (from and to): neither needs the extra room a time picker does. */
export function DateTimeRow({ children, dates }: { children: ReactNode; dates?: boolean }) {
  const parts = Children.toArray(children);
  return (
    <View style={styles.row}>
      {parts.map((part, i) => (
        <View key={i} style={[styles.cell, i > 0 && !dates && styles.time]}>
          {part}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Lined up at the top, so a note under one box does not push the other down.
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  cell: { flexGrow: 1, flexShrink: 1, flexBasis: 130, minWidth: 130 },
  // The website's time picker is three boxes (hour, minute, AM / PM) and needs the room for them.
  time: Platform.OS === 'web' ? { flexBasis: 320, minWidth: 290 } : {},
});
