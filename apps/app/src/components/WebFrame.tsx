// How the app sits in a browser window. Phones and narrow windows: untouched.
// A computer, signed in: a side menu on the left and the screen beside it (Home, Family and Calendar use the full width).
// Sign-in and public pages on a computer: a centred column. The admin web app has its own full-width layout.
import type { ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SideNav } from '@/components/SideNav';
import { colors } from '@/theme/tokens';

export const WEB_COLUMN = 520;
export const DESKTOP_MIN = 1024;
const READING_WIDTH = 820;
const WIDE_WIDTH = 1240;

/** True on a computer's browser, wide enough for the side menu. */
export function useDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_MIN;
}

export type FrameSection = 'app' | 'public' | 'admin';

/** Screens whose content should use the whole width on a computer, rather than a reading column. */
const WIDE_ROUTES = new Set(['home', 'tree', 'calendar']);

export function WebFrame({ children, section = 'public', route }: { children: ReactNode; section?: FrameSection; route?: string }) {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= DESKTOP_MIN;
  if (Platform.OS !== 'web' || section === 'admin') return <>{children}</>;
  if (section === 'app' && desktop) {
    const wide = WIDE_ROUTES.has(route ?? '');
    return (
      <View style={styles.shell}>
        <SideNav />
        <View style={styles.main}>
          <View style={[styles.content, { maxWidth: wide ? WIDE_WIDTH : READING_WIDTH }]}>{children}</View>
        </View>
      </View>
    );
  }
  if (width <= WEB_COLUMN + 40) return <>{children}</>;
  return (
    <View style={styles.outside}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  main: { flex: 1, alignItems: 'center', minWidth: 0 },
  content: { flex: 1, width: '100%' },
  outside: { flex: 1, alignItems: 'center', backgroundColor: colors.tint },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: WEB_COLUMN,
    backgroundColor: colors.background,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
});
