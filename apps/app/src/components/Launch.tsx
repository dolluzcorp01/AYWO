// What people see from opening the app to the first screen.
// Phones: the native splash (a still picture) hands over to this, on exactly the same logo in exactly the same place.
// Web: public/index.html shows its loading page before any code arrives, and this removes it.
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { LogoPieceArt, nativeDriver, Spinner, useReducedMotion } from '@/components/Loaders';
import { LOGO_ORANGE, LOGO_PURPLE, WORDMARK_PATH, WORDMARK_WIDTH } from '@/components/logoArt';
import { colors } from '@/theme/tokens';

// Keeps the native splash up until the launch screen has drawn its first frame.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const SPLASH_SIZE = 200; // Must match imageWidth for expo-splash-screen in app.json.
const PLAY_MS = 1000;
const LEAVE_MS = 200;
const PART = (SPLASH_SIZE / 500) * (22 / Math.SQRT2);
const WORD_HEIGHT = 32;

function removeWebBootPage() {
  const page = globalThis.document?.getElementById('aywo-boot');
  if (!page) return;
  page.classList.add('done');
  setTimeout(() => page.remove(), LEAVE_MS + 50);
}

function Glow({ id, x, y, radius, colour, strength }: { id: string; x: number; y: number; radius: number; colour: string; strength: number }) {
  return (
    <>
      <Defs>
        <RadialGradient id={id} cx={x} cy={y} r={radius} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colour} stopOpacity={strength} />
          <Stop offset="1" stopColor={colour} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={x} cy={y} r={radius} fill={`url(#${id})`} />
    </>
  );
}

function PhoneLaunch({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const reduced = useReducedMotion();
  const clock = useRef(new Animated.Value(0)).current;
  const leave = useRef(new Animated.Value(1)).current;
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    const play = Animated.timing(clock, { toValue: 1, duration: PLAY_MS, easing: Easing.linear, useNativeDriver: nativeDriver });
    play.start(() => setPlayed(true));
    return () => play.stop();
  }, [clock]);

  useEffect(() => {
    if (!ready || (!played && !reduced)) return;
    Animated.timing(leave, { toValue: 0, duration: LEAVE_MS, useNativeDriver: nativeDriver }).start(onDone);
  }, [ready, played, reduced, leave, onDone]);

  // Clock runs 0 to 1 over a second. The pieces part slightly, then snap together as the glow blooms; then the name arrives.
  const apart = clock.interpolate({ inputRange: [0, 0.22, 0.46, 0.52, 1], outputRange: [0, PART, -PART * 0.08, 0, 0] });
  const together = clock.interpolate({ inputRange: [0, 0.22, 0.46, 0.52, 1], outputRange: [0, -PART, PART * 0.08, 0, 0] });
  // Curves are written as stops: the native driver ignores an easing option on interpolate.
  const lift = clock.interpolate({ inputRange: [0, 0.5, 0.6, 0.75, 0.9, 1], outputRange: [0, 0, -3, -17, -31, -34] });
  const shrink = clock.interpolate({ inputRange: [0, 0.5, 0.6, 0.75, 0.9, 1], outputRange: [1, 1, 0.988, 0.93, 0.872, 0.86] });
  const bloom = clock.interpolate({ inputRange: [0, 0.26, 0.56, 1], outputRange: [0, 0, 1, 0.65] });
  const wordShow = clock.interpolate({ inputRange: [0, 0.62, 0.72, 1], outputRange: [0, 0, 0.6, 1] });
  const wordRise = clock.interpolate({ inputRange: [0, 0.62, 0.72, 1], outputRange: [12, 12, 5, 0] });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.page, { opacity: leave }]}
      pointerEvents={ready ? 'none' : 'auto'}
      onLayout={() => {
        SplashScreen.hideAsync().catch(() => undefined);
      }}
    >
      <Animated.View style={[styles.glow, { opacity: reduced ? 0.65 : bloom }]}>
        <Svg width={560} height={560}>
          <Glow id="launchPurple" x={230} y={230} radius={170} colour={colors.logoPurple} strength={0.34} />
          <Glow id="launchOrange" x={330} y={330} radius={150} colour={colors.logoOrange} strength={0.34} />
          <Glow id="launchYellow" x={220} y={340} radius={120} colour={colors.logoYellow} strength={0.2} />
        </Svg>
      </Animated.View>
      <Animated.View style={{ width: SPLASH_SIZE, height: SPLASH_SIZE, transform: [{ translateY: reduced ? -34 : lift }, { scale: reduced ? 0.86 : shrink }] }}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: reduced ? 0 : together }, { translateY: reduced ? 0 : together }] }]}>
          <LogoPieceArt piece={LOGO_PURPLE} id="launchMarkPurple" size={SPLASH_SIZE} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: reduced ? 0 : apart }, { translateY: reduced ? 0 : apart }] }]}>
          <LogoPieceArt piece={LOGO_ORANGE} id="launchMarkOrange" size={SPLASH_SIZE} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.word, { opacity: reduced ? 1 : wordShow, transform: [{ translateY: reduced ? 0 : wordRise }] }]}>
        <Svg width={(WORD_HEIGHT * WORDMARK_WIDTH) / 511} height={WORD_HEIGHT} viewBox={`0 0 ${WORDMARK_WIDTH} 511`}>
          <Path d={WORDMARK_PATH} fill="#000000" />
        </Svg>
      </Animated.View>
      {played && !ready ? (
        <View style={styles.slow}>
          <Spinner size={28} />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Stays on top of the app until the app can show its first screen. */
export function Launch({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const finish = useCallback(() => setGone(true), []);
  useEffect(() => {
    if (Platform.OS === 'web' && ready) removeWebBootPage();
  }, [ready]);
  if (Platform.OS === 'web' || gone) return null;
  return <PhoneLaunch ready={ready} onDone={finish} />;
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  glow: { position: 'absolute' },
  word: { position: 'absolute', top: '50%', marginTop: 58 },
  slow: { position: 'absolute', top: '50%', marginTop: 118 },
});
