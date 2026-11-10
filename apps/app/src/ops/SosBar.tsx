// The SOS bar at the top of Home: full width, hard to miss, hard to press by accident. Holding it for 2 seconds starts
// the SOS straight away (the SOS screen opens already sending). A short tap only explains how it works.
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '@/components/Loaders';
import { Text } from '@/components/Text';
import { colors, fonts, radius } from '@/theme/tokens';

export const SOS_HOLD_MS = 2_000;

function Siren({ size = 26 }: { size?: number }) {
  return (
    <View style={[styles.siren, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.sirenMark, { fontSize: size * 0.6 }]}>!</Text>
    </View>
  );
}

export function SosBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [holding, setHolding] = useState(false);
  const [explained, setExplained] = useState(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function begin() {
    setHolding(true);
    setExplained(false);
    fill.setValue(0);
    Animated.timing(fill, { toValue: 1, duration: SOS_HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start();
    timer.current = setTimeout(() => {
      setHolding(false);
      fill.setValue(0);
      router.push({ pathname: '/social/sos', params: { start: '1' } });
    }, SOS_HOLD_MS);
  }

  function end() {
    if (timer.current) clearTimeout(timer.current);
    if (holding) setExplained(true);
    setHolding(false);
    fill.stopAnimation();
    if (reduced) fill.setValue(0);
    else Animated.timing(fill, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  }

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('ops.sos.label')}
      accessibilityHint={t('ops.sos.hint')}
      // Screen readers: a double tap opens the SOS screen, where the big button starts it.
      onAccessibilityTap={() => router.push('/social/sos')}
      onPressIn={begin}
      onPressOut={end}
      style={[styles.bar, compact && styles.compact]}
    >
      <Animated.View style={[styles.fill, { width }]} pointerEvents="none" />
      <Siren size={compact ? 22 : 30} />
      <View style={styles.texts}>
        <Text style={[styles.title, compact && styles.titleCompact]}>{holding ? t('ops.sos.keep') : t('ops.sos.title')}</Text>
        {compact ? null : <Text style={styles.sub}>{explained ? t('ops.sos.explain') : t('ops.sos.sub')}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 76,
    borderRadius: radius.card,
    backgroundColor: colors.alert,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    overflow: 'hidden',
    shadowColor: colors.alert,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  compact: { minHeight: 64, paddingHorizontal: 14, gap: 10 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#B3161A' },
  siren: { backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  sirenMark: { color: colors.alert, fontFamily: fonts.extrabold, lineHeight: undefined },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 20, letterSpacing: 0.4 },
  titleCompact: { fontSize: 16 },
  sub: { color: colors.white, fontFamily: fonts.semibold, fontSize: 13, opacity: 0.95 },
});
