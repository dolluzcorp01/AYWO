import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import type { StyleProp, ViewStyle } from 'react-native';
import { BackIcon } from '@/components/ContactIcon';
import { CheckIcon, CloseIcon } from '@/components/Icons';
import { Appear, Bouncy, Rise, softHover, useGlide } from '@/components/Motion';
import { Text, TextInput } from '@/components/Text';
import { hideToastIf, showToast } from '@/components/Toast';
import { useSimpleMode } from '@/lib/prefs';
import { colors, fonts, gradients, minTapSize, radius, shadows } from '@/theme/tokens';

/**
 * A quick second tap on the same button does nothing. On a slow phone the next screen takes a moment to appear, and
 * a second tap in that moment opened it twice: after saving, the same form was still there, empty.
 */
function useOncePerTap(onPress: () => void): () => void {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (now - last.current < 600) return;
    last.current = now;
    onPress();
  };
}

/**
 * The main button of a screen. Pass `missing` (what is still needed, such as "Choose who can see this") and the
 * button waits, saying so underneath. A greyed-out button with no reason leaves people stuck.
 */
export function PrimaryButton({ label, onPress: press, disabled, missing }: { label: string; onPress: () => void; disabled?: boolean; missing?: string | null }) {
  const big = useSimpleMode();
  const onPress = useOncePerTap(press);
  const off = !!disabled || !!missing;
  return (
    <View style={styles.primaryBox}>
      <Bouncy accessibilityRole="button" accessibilityState={{ disabled: off }} accessibilityHint={missing ?? undefined} onPress={onPress} disabled={off} to={0.97} style={{ opacity: off ? 0.5 : 1 }}>
        <View style={[styles.button, big && styles.bigButton]}>
          <Text style={styles.buttonText}>{label}</Text>
        </View>
      </Bouncy>
      {missing ? <Text style={styles.missing}>{missing}</Text> : null}
    </View>
  );
}

/** The second choice beside or under a primary button: light indigo with an indigo border and words. */
export function SecondaryButton({ label, onPress: press, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const big = useSimpleMode();
  const onPress = useOncePerTap(press);
  return (
    <Bouncy
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      to={0.97}
      hoverStyle={styles.secondaryHover}
      style={[styles.secondary, big && styles.bigSecondary, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Bouncy>
  );
}

/** Purple words that act as a button: 'Someone already in the tree', 'Copy link'. */
export function TextButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const big = useSimpleMode();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.textButton, big && styles.bigMin, { opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.textButtonText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

/** The small pill on activity cards and the Undo button. */
export function SmallButton({ label, onPress, kind = 'solid', disabled, accessibilityLabel }: { label: string; onPress: () => void; kind?: 'solid' | 'plain' | 'yellow' | 'dark'; disabled?: boolean; accessibilityLabel?: string }) {
  const inner = <Text style={[styles.smallText, (kind === 'plain' || kind === 'yellow') && styles.smallTextDark]}>{label}</Text>;
  const a11y = { accessibilityRole: 'button' as const, accessibilityLabel, onPress, disabled, style: { opacity: disabled ? 0.5 : 1, cursor: disabled ? ('default' as const) : ('pointer' as const) } };
  if (kind === 'plain') {
    return (
      <Pressable {...a11y}>
        {({ hovered }: { hovered?: boolean }) => <View style={[styles.small, styles.smallPlain, hovered && !disabled && styles.secondaryHover]}>{inner}</View>}
      </Pressable>
    );
  }
  if (kind === 'yellow') {
    return (
      <Bouncy {...a11y}>
        <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.small}>
          {inner}
        </LinearGradient>
      </Bouncy>
    );
  }
  return (
    <Bouncy {...a11y}>
      <View style={[styles.small, styles.smallSolid]}>{inner}</View>
    </Bouncy>
  );
}

/** Round white button at the top of a screen. */
export function BackButton({ onPress, close }: { onPress: () => void; close?: boolean }) {
  const { t } = useTranslation();
  return (
    <Bouncy accessibilityRole="button" accessibilityLabel={close ? t('tree.close') : t('card.goBack')} onPress={onPress} to={0.9} style={styles.round}>
      {close ? <CloseIcon color={colors.text} size={18} /> : <BackIcon color={colors.text} />}
    </Bouncy>
  );
}

/** Back button, a title and a small line under it. */
export function TopBar({ title, subtitle, onBack, close }: { title: string; subtitle?: string; onBack: () => void; close?: boolean }) {
  return (
    <View style={styles.topBar}>
      <BackButton onPress={onBack} close={close} />
      <View style={styles.topText}>
        <Text style={styles.topTitle}>{title}</Text>
        {subtitle ? <Text style={styles.topSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

/** Deep indigo panel. Use for the one most important thing on a screen only; text inside is white. */
export function NeonPanel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.neon, style]}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

/** Bold heading above a group, such as 'They can'. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={styles.section}>{children}</Text>;
}

/**
 * A problem after an action. Shown in place and, the moment it appears, in the standard popup at the top,
 * so it is seen even when this line is below the fold. One look for every screen.
 */
export function ErrorText({ children }: { children: ReactNode }) {
  const message = typeof children === 'string' ? children : null;
  useEffect(() => {
    if (!message) return;
    showToast('error', message);
    // Fixed (the line went away): its popup goes too, so an old problem is never left on screen.
    return () => hideToastIf(message);
  }, [message]);
  return <Text accessibilityRole="alert" style={styles.error}>{children}</Text>;
}

/** A labelled text box. `invalid` gives it a red border, so the box with the problem is easy to find. */
/** accessory: something beside the box, such as the mic button. */
export function Field({ label, style, invalid, accessory, ...input }: { label?: string; invalid?: boolean; accessory?: ReactNode } & ComponentProps<typeof TextInput>) {
  // The box always sits in the same row, with or without something beside it. When the row was only added once an
  // accessory appeared (a Clear button after the first letter, say), the box was built again and lost the cursor.
  // The box being typed in lights up in purple, so the eye never has to hunt for the cursor.
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <View style={[styles.fieldRow, input.multiline && styles.fieldRowTop]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          {...input}
          onFocus={(event) => {
            setFocused(true);
            input.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            input.onBlur?.(event);
          }}
          style={[styles.input, styles.inputBeside, softHover, style, focused && styles.inputFocused, invalid && styles.inputInvalid]}
        />
        {accessory}
      </View>
    </View>
  );
}

/** One choice in a row of pills, such as Male / Female / Other. */
export function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Bouncy
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      to={0.94}
      style={[styles.pill, on && styles.pillOn]}
    >
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </Bouncy>
  );
}

export function Pills<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (value: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.pills}>
      {options.map((o) => (
        <Pill key={o.value} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

export function Checkbox({ label, help, on, onChange }: { label: string; help?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Bouncy accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange(!on)} to={0.98} style={styles.checkRow}>
      {/* The tick grows into its box, so a tap is seen to have landed. */}
      <View style={[styles.box, on && styles.boxOn]}>{on ? <Appear from={0.4}><CheckIcon color={colors.white} size={16} width={3} /></Appear> : null}</View>
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{label}</Text>
        {help ? <Text style={styles.checkHelp}>{help}</Text> : null}
      </View>
    </Bouncy>
  );
}

export function Switch({ label, help, on, onChange }: { label: string; help?: string; on: boolean; onChange: (on: boolean) => void }) {
  // The knob slides across and the track warms to indigo, instead of jumping from one side to the other.
  const glide = useGlide(on);
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => onChange(!on)} style={styles.switchRow}>
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{label}</Text>
        {help ? <Text style={styles.checkHelp}>{help}</Text> : null}
      </View>
      <Animated.View style={[styles.track, { backgroundColor: glide.interpolate({ inputRange: [0, 1], outputRange: [colors.checkboxOff, colors.logoIndigo] }) }]}>
        <Animated.View style={[styles.thumb, { marginStart: glide.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }]} />
      </Animated.View>
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.centre}>
      <PageLoader label={label} />
    </View>
  );
}

/** A failed load, with a way to try again. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centre}>
      <Text style={styles.centreText}>{message}</Text>
      {onRetry ? <TextButton label={t('tree.tryAgain')} onPress={onRetry} /> : null}
    </View>
  );
}

/** Nothing here yet: said kindly, with a soft mark above the words, and eased in so it does not flash up. */
export function EmptyState({ message }: { message: string }) {
  return (
    <Rise style={styles.centre}>
      <View style={styles.emptyMark}>
        <View style={styles.emptyDot} />
        <View style={[styles.emptyDot, styles.emptyDotMid]} />
        <View style={[styles.emptyDot, styles.emptyDotEnd]} />
      </View>
      <Text style={styles.centreText}>{message}</Text>
    </Rise>
  );
}

/** Asks before something that cannot be taken back. Used instead of Alert, which does nothing on web. */
export function ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel, danger, busy, children }: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        {/* The box grows into place over the dimmed page. */}
        <Appear style={styles.dialogBox}>
          <View accessibilityRole="alert" style={styles.dialog}>
            <Text style={styles.dialogTitle}>{title}</Text>
            {message ? <Text style={styles.muted}>{message}</Text> : null}
            {children}
            <TextButton label={confirmLabel} onPress={onConfirm} disabled={busy} danger={danger} />
            <TextButton label={t('common.cancel')} onPress={onCancel} />
          </View>
        </Appear>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  primaryBox: { gap: 8 },
  missing: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, textAlign: 'center' },
  button: { height: 56, minHeight: minTapSize, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.logoIndigo, ...shadows.card },
  buttonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 17, textAlign: 'center' },
  secondary: {
    minHeight: 56,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.logoIndigo,
    backgroundColor: colors.tint,
    paddingHorizontal: 16,
    cursor: 'pointer',
  },
  secondaryHover: { backgroundColor: colors.tintDeep },
  secondaryText: { color: colors.logoIndigo, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  // Elder mode: the main buttons grow by about a third, so they are easier to hit.
  bigButton: { height: 72 },
  bigSecondary: { minHeight: 72 },
  bigMin: { minHeight: 60 },
  textButton: { minHeight: minTapSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  textButtonText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  danger: { color: colors.alert },
  small: { minHeight: minTapSize, borderRadius: 22, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  smallPlain: { backgroundColor: colors.tint, borderWidth: 1.5, borderColor: colors.logoIndigo },
  smallSolid: { backgroundColor: colors.logoIndigo },
  smallText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  smallTextDark: { color: colors.logoIndigo },
  round: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // marginBottom: room between a page's heading and what comes under it, on every screen.
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  topText: { flex: 1, minWidth: 0 },
  topTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.6 },
  topSubtitle: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  neon: { borderRadius: radius.hero, padding: 20, backgroundColor: colors.logoIndigo, ...shadows.raised },
  heading: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 32, letterSpacing: -1.1, lineHeight: 38 },
  muted: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 16,
    ...shadows.card,
  },
  label: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13 },
  section: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  error: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  field: { gap: 6 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldRowTop: { alignItems: 'flex-start' },
  inputBeside: { flex: 1, minWidth: 0 },
  inputInvalid: { borderColor: colors.alert, borderWidth: 2 },
  inputFocused: { borderColor: colors.logoPurple, backgroundColor: '#FDFBFF', ...Platform.select({ web: { boxShadow: '0 0 0 4px rgba(142,38,225,0.12)', outlineStyle: 'none' }, default: {} }) } as never,
  input: {
    minHeight: 54,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    minHeight: minTapSize,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  pillText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  pillTextOn: { color: colors.white },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTapSize },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  boxOn: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  checkText: { flex: 1, minWidth: 0 },
  checkLabel: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  checkHelp: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, marginTop: 2 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTapSize,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    ...shadows.card,
  },
  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: colors.checkboxOff, padding: 3 },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white, ...shadows.card },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  centreText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialogBox: { alignSelf: 'center', maxWidth: 480, width: '100%' },
  emptyMark: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, width: 76, height: 76, borderRadius: 38, backgroundColor: colors.tint, justifyContent: 'center', paddingBottom: 30 },
  emptyDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.logoYellow },
  emptyDotMid: { backgroundColor: colors.logoOrange },
  emptyDotEnd: { backgroundColor: colors.logoPurple },
  dialog: { backgroundColor: colors.card, borderRadius: radius.hero, padding: 22, gap: 8, ...shadows.raised },
  dialogTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
});
