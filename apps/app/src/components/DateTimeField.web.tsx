// Date and time boxes for the web: the browser's own calendar and clock, so nobody types 2026-12-25 by hand.
// Values stay the same strings the screens already use: "2026-12-25" and "18:30".
import { createElement, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Label } from '@/components/ui';
import { CalendarIcon } from '@/components/Icons';
import { colors, fonts, minTapSize, radius } from '@/theme/tokens';
import type { DatePickButtonProps, DateTimeFieldProps } from './DateTimeField.types';

function Box({ type, label, value, onChange, min, max, invalid, help, error, optional }: DateTimeFieldProps & { type: 'date' | 'time' }) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const input = createElement('input', {
    type,
    value,
    min,
    max,
    'aria-label': label,
    'aria-invalid': invalid || !!error ? true : undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    // The whole box opens the picker, not only the little icon at its end.
    onClick: (e: { currentTarget: { showPicker?: () => void } }) => {
      try {
        e.currentTarget.showPicker?.();
      } catch {
        // Some browsers allow showPicker only on a direct tap; the icon still works there.
      }
    },
    style: {
      minHeight: 54,
      width: '100%',
      boxSizing: 'border-box',
      borderRadius: radius.button,
      border: `1px solid ${invalid || error ? colors.alert : focused ? colors.text : colors.cardBorder}`,
      backgroundColor: colors.card,
      padding: '0 16px',
      color: value ? colors.text : colors.muted,
      fontFamily: fonts.semibold,
      fontSize: 16,
      cursor: 'pointer',
      outline: 'none',
    },
  });
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <View style={styles.row}>
        <View style={styles.grow}>{input}</View>
        {optional && value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('picker.clearLabel', { what: label ?? '' })}
            onPress={() => onChange('')}
            style={({ hovered }: { hovered?: boolean }) => [styles.clear, hovered && styles.clearHover]}
          >
            <Text style={styles.clearText}>{t('picker.clear')}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

export function DateField(props: DateTimeFieldProps) {
  return <Box type="date" {...props} />;
}

/** Opens the browser's calendar from a round button. The box beside it keeps taking a typed year. */
export function DatePickButton({ label, value, min, max, onChange }: DatePickButtonProps) {
  const ref = useRef<{ showPicker?: () => void; focus?: () => void } | null>(null);
  const input = createElement('input', {
    ref,
    type: 'date',
    value: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '',
    min,
    max,
    tabIndex: -1,
    'aria-hidden': true,
    onChange: (e: { target: { value: string } }) => {
      if (e.target.value) onChange(e.target.value);
    },
    // Present but unseen: the calendar needs a real date box to open from.
    style: { position: 'absolute', left: 0, bottom: 0, width: '100%', height: 1, opacity: 0, border: 0, padding: 0, pointerEvents: 'none' },
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        try {
          ref.current?.showPicker?.();
        } catch {
          ref.current?.focus?.();
        }
      }}
      style={({ hovered }: { hovered?: boolean }) => [styles.pick, hovered && styles.clearHover]}
    >
      <CalendarIcon color={colors.text} size={20} />
      {input}
    </Pressable>
  );
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, '0');

/** "18:30" as 6, 30, pm. */
function split(value: string): { hour: number | null; minute: number | null; pm: boolean | null } {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: null, minute: null, pm: null };
  const h = Number(m[1]);
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: Number(m[2]), pm: h >= 12 };
}

function join(hour: number, minute: number, pm: boolean): string {
  const h = (hour % 12) + (pm ? 12 : 0);
  return `${pad(h)}:${pad(minute)}`;
}

/**
 * Hour, minute and AM / PM, the way time is said in India: 6:30 PM, 12 AM. The same on every computer, unlike the
 * browser's clock, which turns 24-hour on some. Minutes go in fives; a saved time like 6:37 still shows as it is.
 */
export function TimeField({ label, value, onChange, invalid, help, error }: DateTimeFieldProps) {
  const { t } = useTranslation();
  const now = split(value);
  // AM or PM picked before the hour is kept here until there is a time to give back.
  const [pmChoice, setPmChoice] = useState<boolean>(now.pm ?? true);
  const pm = now.pm ?? pmChoice;
  const minutes = now.minute !== null && !MINUTES.includes(now.minute) ? [...MINUTES, now.minute].sort((a, b) => a - b) : MINUTES;
  const bad = invalid || !!error;

  const select = (aria: string, current: number | null, options: number[], show: (n: number) => string, placeholder: string, pick: (n: number) => void) =>
    createElement(
      'select',
      {
        'aria-label': aria,
        value: current === null ? '' : String(current),
        onChange: (e: { target: { value: string } }) => e.target.value !== '' && pick(Number(e.target.value)),
        style: {
          minHeight: 54,
          minWidth: 0,
          flex: 1,
          boxSizing: 'border-box',
          borderRadius: radius.button,
          border: `1px solid ${bad ? colors.alert : colors.cardBorder}`,
          backgroundColor: colors.card,
          padding: '0 12px',
          color: current === null ? colors.muted : colors.text,
          fontFamily: fonts.semibold,
          fontSize: 16,
          cursor: 'pointer',
        },
      },
      createElement('option', { value: '', disabled: true }, placeholder),
      ...options.map((n) => createElement('option', { key: n, value: String(n) }, show(n))),
    );

  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <View accessibilityRole="group" accessibilityLabel={label} style={styles.timeRow}>
        {select(t('picker.hour'), now.hour, HOURS, String, t('picker.hour'), (h) => onChange(join(h, now.minute ?? 0, pm)))}
        <Text style={styles.colon}>:</Text>
        {select(t('picker.minute'), now.minute, minutes, pad, t('picker.minute'), (m) => onChange(join(now.hour ?? 12, m, pm)))}
        <View accessibilityRole="radiogroup" style={styles.ampm}>
          {[false, true].map((isPm) => {
            const on = pm === isPm;
            return (
              <Pressable
                key={String(isPm)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  setPmChoice(isPm);
                  if (now.hour !== null) onChange(join(now.hour, now.minute ?? 0, isPm));
                }}
                style={({ hovered }: { hovered?: boolean }) => [styles.ampmButton, on && styles.ampmOn, hovered && !on && styles.ampmHover]}
              >
                <Text style={[styles.ampmText, on && styles.ampmTextOn]}>{isPm ? t('picker.pm') : t('picker.am')}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pick: { width: 54, height: 54, minWidth: minTapSize, borderRadius: radius.button, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  clear: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', cursor: 'pointer' },
  clearHover: { backgroundColor: colors.tint },
  clearText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colon: { color: colors.text, fontFamily: fonts.bold, fontSize: 20 },
  ampm: { flexDirection: 'row', borderRadius: radius.button, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden', backgroundColor: colors.card },
  ampmButton: { minHeight: 52, minWidth: 64, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  ampmOn: { backgroundColor: colors.activeTab },
  ampmHover: { backgroundColor: colors.tint },
  ampmText: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  ampmTextOn: { color: colors.white },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  error: { color: colors.alert, fontFamily: fonts.bold, fontSize: 13 },
});
