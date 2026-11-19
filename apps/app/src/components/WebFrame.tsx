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

export type FrameSection = 'app' | 'public' | 'admin' | 'landing';

/** Screens whose content should use the whole width on a computer, rather than a reading column. */
const WIDE_ROUTES = new Set(['home', 'tree', 'calendar']);

/**
 * In a browser the screens always sit at the same place in the tree: outer > middle > inner > children. Only the
 * styles and the side menu change between the three shapes. It used to return three different trees, so going from a
 * public page to an app page on a computer, or resizing the window past 560 or 1024 px, threw the whole navigator
 * away and built it again: anything typed in a form and the way back were lost.
 */
export function WebFrame({ children, section = 'public', route }: { children: ReactNode; section?: FrameSection; route?: string }) {
  const { width } = useWindowDimensions();
  // The platform never changes while the app runs, so phones keep their untouched tree.
  if (Platform.OS !== 'web') return <>{children}</>;
  const shape: 'plain' | 'shell' | 'column' =
    section === 'admin' || section === 'landing' ? 'plain' : section === 'app' && width >= DESKTOP_MIN ? 'shell' : width <= WEB_COLUMN + 40 ? 'plain' : 'column';
  const wide = WIDE_ROUTES.has(route ?? '');
  return (
    <View style={shape === 'shell' ? styles.shell : shape === 'column' ? styles.outside : styles.plain}>
      {shape === 'shell' ? <SideNav /> : null}
      <View style={shape === 'shell' ? styles.main : shape === 'column' ? styles.column : styles.plain}>
        <View style={shape === 'shell' ? [styles.content, { maxWidth: wide ? WIDE_WIDTH : READING_WIDTH }] : styles.plain}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A wrapper that changes nothing: it fills its parent and lays its one child out the same way.
  plain: { flex: 1 },
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
