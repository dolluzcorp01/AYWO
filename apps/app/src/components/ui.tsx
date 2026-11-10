import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import type { StyleProp, ViewStyle } from 'react-native';
import { BackIcon } from '@/components/ContactIcon';
import { CheckIcon, CloseIcon } from '@/components/Icons';
import { Text, TextInput } from '@/components/Text';
import { colors, fonts, gradients, minTapSize, radius, shadows } from '@/theme/tokens';

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
      <View style={styles.button}>
        <Text style={styles.buttonText}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** White pill under a primary button: 'Not me', 'Just have a look'. */
export function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.secondary, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

/** Purple words that act as a button: 'Someone already in the tree', 'Copy link'. */
export function TextButton({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.textButton, { opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.textButtonText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

/** The small pill on activity cards and the Undo button. */
export function SmallButton({ label, onPress, kind = 'solid', disabled }: { label: string; onPress: () => void; kind?: 'solid' | 'plain' | 'yellow' | 'dark'; disabled?: boolean }) {
  const inner = <Text style={[styles.smallText, (kind === 'plain' || kind === 'yellow') && styles.smallTextDark]}>{label}</Text>;
  const a11y = { accessibilityRole: 'button' as const, onPress, disabled, style: { opacity: disabled ? 0.5 : 1 } };
  if (kind === 'plain') {
    return (
      <Pressable {...a11y}>
        <View style={[styles.small, styles.smallPlain]}>{inner}</View>
      </Pressable>
    );
  }
  if (kind === 'yellow') {
    return (
      <Pressable {...a11y}>
        <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.small}>
          {inner}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable {...a11y}>
      <View style={[styles.small, styles.smallSolid]}>{inner}</View>
    </Pressable>
  );
}

/** Round white button at the top of a screen. */
export function BackButton({ onPress, close }: { onPress: () => void; close?: boolean }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={close ? t('tree.close') : t('card.goBack')} onPress={onPress} style={styles.round}>
      {close ? <CloseIcon color={colors.text} size={18} /> : <BackIcon color={colors.text} />}
    </Pressable>
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

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="alert" style={styles.error}>{children}</Text>;
}

export function Field({ label, style, ...input }: { label?: string } & ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...input}
        style={[styles.input, style]}
      />
    </View>
  );
}

/** One choice in a row of pills, such as Male / Female / Other. */
export function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.pill, on && styles.pillOn]}
    >
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </Pressable>
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
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange(!on)} style={styles.checkRow}>
      <View style={[styles.box, on && styles.boxOn]}>{on ? <CheckIcon color={colors.white} size={16} width={3} /> : null}</View>
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{label}</Text>
        {help ? <Text style={styles.checkHelp}>{help}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Switch({ label, help, on, onChange }: { label: string; help?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => onChange(!on)} style={styles.switchRow}>
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{label}</Text>
        {help ? <Text style={styles.checkHelp}>{help}</Text> : null}
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.thumb, on && styles.thumbOn]} />
      </View>
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

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.centre}>
      <Text style={styles.centreText}>{message}</Text>
    </View>
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
        <View accessibilityRole="alert" style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          {message ? <Text style={styles.muted}>{message}</Text> : null}
          {children}
          <TextButton label={confirmLabel} onPress={onConfirm} disabled={busy} danger={danger} />
          <TextButton label={t('common.cancel')} onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { height: 56, minHeight: minTapSize, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.logoIndigo, ...shadows.card },
  buttonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 17, textAlign: 'center' },
  secondary: {
    minHeight: 56,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
  },
  secondaryText: { color: colors.text, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  textButton: { minHeight: minTapSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  textButtonText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  danger: { color: colors.alert },
  small: { minHeight: minTapSize, borderRadius: 22, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  smallPlain: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  smallSolid: { backgroundColor: colors.logoIndigo },
  smallText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  smallTextDark: { color: colors.text },
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
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
  trackOn: { backgroundColor: colors.logoIndigo },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
  thumbOn: { marginStart: 18 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  centreText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', maxWidth: 480, width: '100%', backgroundColor: colors.card, borderRadius: radius.hero, padding: 22, gap: 8, ...shadows.raised },
  dialogTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
});
