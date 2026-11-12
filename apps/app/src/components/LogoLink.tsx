// The AYWO logo at the top of a side menu. It is always a link (pointer cursor, keyboard and screen reader),
// so every menu uses this one piece instead of a plain image.
import { Image, Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export function LogoLink({ label, onPress, height = 30, width = 104, style }: { label: string; onPress: () => void; height?: number; width?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={[styles.link, style]}>
      {/* The image ignores the pointer, so the link under it gets the hover and the click. */}
      <Image source={require('../../assets/aywo_logo_app.png')} style={[{ height, width }, styles.noPointer]} resizeMode="contain" accessibilityLabel="AYWO" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', borderRadius: 8 },
  noPointer: { pointerEvents: 'none' },
});
