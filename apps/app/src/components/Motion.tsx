// Small movements that make the app feel alive: a button gives a little under the finger, and a screen's parts rise
// into place as it opens. Colours and shapes stay as the Warm Daylight design has them; only movement is added.
//
// Motion can make some people unwell, so the phone's "reduce motion" setting turns all of it off. The setting is read
// once for the whole app, not by each button: a screen has dozens of buttons and each one listening was wasteful.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable } from 'react-native';
import type { GestureResponderEvent, PressableProps, StyleProp, ViewStyle } from 'react-native';

const nativeDriver = Platform.OS !== 'web';

let reduced = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    reduced = on;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
  reduced = on;
});

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * On the website, colour and shadow changes under the mouse glide instead of snapping. Movement is left out here:
 * the spring below owns it, and two things moving the same button would fight.
 */
export const softHover = (Platform.OS === 'web'
  ? { transitionProperty: 'background-color, border-color, box-shadow, opacity', transitionDuration: '160ms', transitionTimingFunction: 'ease-out' }
  : {}) as ViewStyle;

/** The same glide for something that also lifts under the mouse (a card that is a link) and has no spring. */
export const softLift = (Platform.OS === 'web'
  ? { transitionProperty: 'background-color, border-color, box-shadow, transform', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' }
  : {}) as ViewStyle;

type BouncyProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Added while the mouse is over it (web). */
  hoverStyle?: StyleProp<ViewStyle>;
  /** How far it gives when pressed: 0.96 for a button, nearer 1 for a wide card. */
  to?: number;
};

/** A Pressable that gives a little under the finger and springs back. Use it exactly like Pressable. */
export function Bouncy({ children, style, hoverStyle, to = 0.96, disabled, onPressIn, onPressOut, ...rest }: BouncyProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);
  const spring = (value: number) => Animated.spring(scale, { toValue: value, useNativeDriver: nativeDriver, speed: 40, bounciness: 7 }).start();
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={(event: GestureResponderEvent) => {
        if (!reduced) spring(to);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        spring(1);
        onPressOut?.(event);
      }}
      style={[softHover, style, hovered && !disabled && hoverStyle, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Fades and rises into place once, when the screen opens. `delay` staggers the parts of a screen, top first. */
export function Rise({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const shown = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      shown.setValue(1);
      return;
    }
    // On a phone the screen has already taken a moment to open, so the parts come in quickly and almost together.
    // A long, stepped rise there read as the app being slow.
    const quick = Platform.OS !== 'web';
    Animated.timing(shown, {
      toValue: 1,
      duration: quick ? 200 : 420,
      delay: quick ? Math.min(delay * 0.4, 90) : delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
  }, [shown, delay]);
  return (
    <Animated.View style={[style, { opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [Platform.OS === 'web' ? 16 : 8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Pops in from small, for the mark under the tab you are on. */
export function Pop({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const shown = useRef(new Animated.Value(reduced ? 1 : 0.5)).current;
  useEffect(() => {
    Animated.spring(shown, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 10 }).start();
  }, [shown]);
  return <Animated.View style={[style, { opacity: shown.interpolate({ inputRange: [0.5, 1], outputRange: [0, 1] }), transform: [{ scaleX: shown }] }]}>{children}</Animated.View>;
}

/**
 * A whole page easing in as it opens: a short fade with a small rise. Used on the website, where moving between
 * pages was an instant swap; the phone apps slide their screens already.
 */
export function PageEnter({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const shown = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.timing(shown, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [shown]);
  return (
    <Animated.View style={[style, { opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>
  );
}

/** Grows gently into place from a little smaller: a dialog, a tick in its box. */
export function Appear({ children, style, from = 0.92 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; from?: number }) {
  const shown = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.spring(shown, { toValue: 1, useNativeDriver: nativeDriver, speed: 22, bounciness: 6 }).start();
  }, [shown]);
  return (
    <Animated.View style={[style, { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }]}>{children}</Animated.View>
  );
}

/** A value that glides between 0 and 1 as `on` changes: the knob of a switch, a colour that warms up. */
export function useGlide(on: boolean, duration = 180): Animated.Value {
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(on ? 1 : 0);
      return;
    }
    // Colours cannot be moved by the phone's own animator, so this one runs in the app on every platform.
    Animated.timing(value, { toValue: on ? 1 : 0, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [on, value, duration]);
  return value;
}

/**
 * A soft ring that swells and fades behind something, over and over, like slow breathing: it says "this is the one
 * thing here" without a word. Still when the phone asks for less motion.
 */
export function Breathe({ size, color }: { size: number; color: string }) {
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }));
    loop.start();
    return () => loop.stop();
  }, [beat]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
        transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }],
      }}
    />
  );
}

/**
 * Drifts slowly up and down, for a picture that is only there to be looked at (the faces on Welcome, the phone on
 * the front page). `by` is how far in points; `delay` keeps several from moving in step. Still on "less motion".
 */
export function Float({ children, style, by = 6, duration = 3200, delay = 0 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; by?: number; duration?: number; delay?: number }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const half = (toValue: number) => Animated.timing(drift, { toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver });
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]));
    const start = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [drift, duration, delay]);
  return <Animated.View style={[style, { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -by] }) }] }]}>{children}</Animated.View>;
}

/** A plain fade in. Give it a `key` that changes and its contents fade in afresh each time. */
export function Fade({ children, style, duration = 220 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; duration?: number }) {
  const shown = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.timing(shown, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }).start();
  }, [shown, duration]);
  return <Animated.View style={[style, { opacity: shown }]}>{children}</Animated.View>;
}
