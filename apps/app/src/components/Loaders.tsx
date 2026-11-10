// AYWO's own loading animations. PageLoader: a whole screen or section is loading. Spinner: a single request.
// Drawn in code rather than GIFs, so they stay sharp at any size and on any background.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, Polygon, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { LOGO_ORANGE, LOGO_PURPLE, MARK_VIEW_BOX, type LogoPiece } from '@/components/logoArt';
import { colors } from '@/theme/tokens';

export const nativeDriver = Platform.OS !== 'web';

/** Motion can make some people unwell, so the phone's "reduce motion" setting stops these animations. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (live) setReduced(on);
      })
      .catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);
  return reduced;
}

/** A value running from 0 to 1 again and again. */
function useLoop(ms: number, stopped: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (stopped) return undefined;
    const run = Animated.loop(Animated.timing(value, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: nativeDriver }));
    run.start();
    return () => run.stop();
  }, [ms, stopped, value]);
  return value;
}

/** One of the two logo pieces. Gradient ids are unique to the piece; every copy draws the same gradient. */
export function LogoPieceArt({ piece, id, size }: { piece: LogoPiece; id: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEW_BOX} style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgGradient id={id} gradientUnits="userSpaceOnUse" x1={piece.from[0]} y1={piece.from[1]} x2={piece.to[0]} y2={piece.to[1]}>
          <Stop offset="0" stopColor={piece.colours[0]} />
          <Stop offset="1" stopColor={piece.colours[1]} />
        </SvgGradient>
      </Defs>
      <Polygon points={piece.points} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The whole logo mark, still. */
export function LogoMark({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <LogoPieceArt piece={LOGO_PURPLE} id="markPurple" size={size} />
      <LogoPieceArt piece={LOGO_ORANGE} id="markOrange" size={size} />
    </View>
  );
}

function mix(a: string, b: string, t: number) {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const part = (at: number) => Math.round(channel(a, at) * (1 - t) + channel(b, at) * t);
  return `rgb(${part(1)},${part(3)},${part(5)})`;
}

/** The ring's tail, cut into short arcs because SVG has no gradient that follows a circle. */
const TAIL_ARCS = 36;
const TAIL_SHARE = 0.8;
const tailArcs = Array.from({ length: TAIL_ARCS }, (_, i) => {
  const behind = i / TAIL_ARCS;
  const colour =
    behind < 0.45
      ? mix(colors.logoYellow, colors.logoOrange, behind / 0.45)
      : mix(colors.logoOrange, colors.logoPurple, (behind - 0.45) / 0.55);
  return { behind, colour, opacity: Math.pow(1 - behind, 0.8) };
});

function arc(radius: number, fromTurn: number, toTurn: number) {
  const at = (turn: number) => {
    const angle = 2 * Math.PI * turn;
    return `${50 + radius * Math.sin(angle)} ${50 - radius * Math.cos(angle)}`;
  };
  return `M${at(fromTurn)}A${radius} ${radius} 0 0 0 ${at(toTurn)}`;
}

/**
 * A single request is working. tone "dark" is for neon panels and buttons. The logo sits inside the ring from 48 upwards;
 * smaller than that it would be too small to read, so the ring is alone.
 */
export function Spinner({ size = 32, tone = 'light', label }: { size?: number; tone?: 'light' | 'dark'; label?: string }) {
  const reduced = useReducedMotion();
  const turn = useLoop(1120, reduced);
  const withMark = size >= 48;
  const stroke = withMark ? 5.5 : 13;
  const radius = withMark ? 44.5 : 40;
  const track = tone === 'dark' ? colors.glass : colors.cardBorder;
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <Circle cx={50} cy={50} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {tailArcs.map((part) => (
            <Path
              key={part.behind}
              d={arc(radius, -part.behind * TAIL_SHARE, -(part.behind + 1.02 / TAIL_ARCS) * TAIL_SHARE)}
              stroke={part.colour}
              strokeOpacity={part.opacity}
              strokeWidth={stroke}
              fill="none"
            />
          ))}
          <Circle cx={50} cy={50 - radius} r={stroke / 2} fill={colors.logoYellow} />
        </Svg>
      </Animated.View>
      {withMark ? (
        <View style={[StyleSheet.absoluteFill, styles.middle]}>
          <LogoMark size={size * 0.72} />
        </View>
      ) : null}
    </View>
  );
}

// The same timing as the page loader GIF and the website's loading page.
const PAGE_LOOP_MS = 2400;
const APART = [1, 1, -0.05, 0, 0, 1, 1];
const APART_AT = [0, 0.04, 0.18, 0.24, 0.7, 0.86, 1];

/** A screen or section is loading: the two logo pieces part and come back together as one, over a moving bar. */
export function PageLoader({ size = 96, label }: { size?: number; label?: string }) {
  const reduced = useReducedMotion();
  const loop = useLoop(PAGE_LOOP_MS, reduced);
  // A quick answer should not flash an animation at the person.
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, delay: 150, duration: 160, useNativeDriver: nativeDriver }).start();
  }, [appear]);

  const part = (size / 500) * (30 / Math.SQRT2);
  const apart = loop.interpolate({ inputRange: APART_AT, outputRange: APART.map((v) => (reduced ? 0 : v * part)) });
  const together = loop.interpolate({ inputRange: APART_AT, outputRange: APART.map((v) => (reduced ? 0 : -v * part)) });
  const barWidth = size * 1.05;
  const runner = barWidth * 0.42;
  // Crosses twice per loop. It jumps back while out of sight behind the bar's clipped ends.
  const across = (share: number) => -runner + (barWidth + runner) * share;
  const slide = loop.interpolate({
    inputRange: [0, 0.12, 0.38, 0.5, 0.5001, 0.62, 0.88, 1],
    outputRange: [across(0), across(0.15), across(0.85), across(1), across(0), across(0.15), across(0.85), across(1)],
  });

  return (
    <Animated.View accessibilityRole="progressbar" accessibilityLabel={label} style={[styles.page, { opacity: appear }]}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: together }, { translateY: together }] }]}>
          <LogoPieceArt piece={LOGO_PURPLE} id="pagePurple" size={size} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: apart }, { translateY: apart }] }]}>
          <LogoPieceArt piece={LOGO_ORANGE} id="pageOrange" size={size} />
        </Animated.View>
      </View>
      <View style={[styles.bar, { width: barWidth }]}>
        {reduced ? null : (
          <Animated.View style={{ width: runner, height: '100%', transform: [{ translateX: slide }] }}>
            <LinearGradient colors={['#8E26E1', '#FD8E49', '#FDD623']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  middle: { alignItems: 'center', justifyContent: 'center' },
  page: { alignItems: 'center', gap: 14 },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, overflow: 'hidden' },
});
