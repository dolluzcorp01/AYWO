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
      style={[style, hovered && !disabled && hoverStyle, { transform: [{ scale }] }]}
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
    Animated.timing(shown, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [shown, delay]);
  return (
    <Animated.View style={[style, { opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
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
