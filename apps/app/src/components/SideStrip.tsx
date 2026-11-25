// A row of cards that slides sideways. A finger can swipe it; a mouse cannot, so on a computer a round arrow shows
// at whichever end still has cards hidden. Without the arrows the last card sat cut in half with no way to reach it.
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronIcon } from '@/components/Icons';
import { colors, shadows } from '@/theme/tokens';

const SLACK = 4;

export function SideStrip({ children, contentStyle }: { children: ReactNode; contentStyle?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const [at, setAt] = useState(0);
  const arrows = Platform.OS === 'web' && content > box + SLACK;
  const step = (direction: 1 | -1) => {
    const to = Math.max(0, Math.min(content - box, at + direction * Math.max(box * 0.8, 120)));
    scroller.current?.scrollTo({ x: to, animated: true });
    setAt(to);
  };
  return (
    <View>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentStyle}
        onLayout={(e) => setBox(e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => setContent(w)}
        onScroll={(e) => setAt(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {arrows && at > SLACK ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('admin.common.previous')} onPress={() => step(-1)} style={[styles.arrow, styles.start]}>
          <View style={styles.flip}>
            <ChevronIcon color={colors.text} size={18} width={2.2} />
          </View>
        </Pressable>
      ) : null}
      {arrows && at < content - box - SLACK ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('admin.common.next')} onPress={() => step(1)} style={[styles.arrow, styles.end]}>
          <ChevronIcon color={colors.text} size={18} width={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  start: { start: 4 },
  end: { end: 4 },
  flip: { transform: [{ scaleX: -1 }] },
});
