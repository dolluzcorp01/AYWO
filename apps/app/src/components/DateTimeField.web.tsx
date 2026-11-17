// Date and time boxes for the web: the browser's own calendar and clock, so nobody types 2026-12-25 by hand.
// Values stay the same strings the screens already use: "2026-12-25" and "18:30".
import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Label } from '@/components/ui';
import { colors, fonts, radius } from '@/theme/tokens';
import type { DateTimeFieldProps } from './DateTimeField.types';

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

export function TimeField(props: DateTimeFieldProps) {
  return <Box type="time" {...props} />;
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  clear: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', cursor: 'pointer' },
  clearHover: { backgroundColor: colors.tint },
  clearText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  error: { color: colors.alert, fontFamily: fonts.bold, fontSize: 13 },
});
