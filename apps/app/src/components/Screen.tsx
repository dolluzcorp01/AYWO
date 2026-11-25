import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageEnter } from '@/components/Motion';
import { OfflineBar } from '@/components/OfflineBar';
import { colors } from '@/theme/tokens';

/**
 * The warm cream page from the Warm Daylight design: calm, with no glows, so cards and faces carry the colour.
 *
 * On a phone it also looks after the keyboard on every screen: the page moves up so the button under a box stays
 * in reach while typing, and a tap on any empty part of the page puts the keyboard away.
 */
export function Screen({ children, flush }: { children: ReactNode; flush?: boolean }) {
  // Read as numbers rather than through SafeAreaView, which sets its room a moment after the screen slides in and
  // made every screen jump as it opened.
  const insets = useSafeAreaInsets();
  const room = flush
    ? { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }
    : { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 22, paddingLeft: insets.left + 20, paddingRight: insets.right + 20 };
  const inside = (
    <>
      <OfflineBar inset={flush} />
      {children}
    </>
  );
  if (Platform.OS === 'web') {
    return (
      <View style={styles.page}>
        {/* The website swapped pages in an instant; each one now eases in. The phone apps slide their screens. */}
        <PageEnter style={[styles.body, room]}>{inside}</PageEnter>
      </View>
    );
  }
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      {/*
        Takes a touch only while the keyboard is up, and only one that lands on nothing else. With the keyboard
        away it takes nothing: a page that takes every touch stops anything inside it from being dragged, and the
        family tree could then be moved only by starting on a face.
      */}
      <View onStartShouldSetResponder={() => Keyboard.isVisible()} onResponderRelease={Keyboard.dismiss} style={[styles.body, room]}>
        {inside}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
});
