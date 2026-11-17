// Date and time boxes for the phone app: a tap opens the phone's own calendar or clock (Android and iPhone).
// The web has its own file (DateTimeField.web.tsx). Values are "2026-12-25" and "18:30".
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Label } from '@/components/ui';
import { colors, fonts, radius } from '@/theme/tokens';
import type { DateTimeFieldProps } from './DateTimeField.types';

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(type: 'date' | 'time', value: string): Date {
  const now = new Date();
  if (type === 'date') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : now;
  }
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (m) now.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return now;
}

function fromDate(type: 'date' | 'time', d: Date): string {
  return type === 'date' ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** How the picked value reads in the box: 25 Dec 2026, 6:30 pm. */
function shown(type: 'date' | 'time', value: string, locale: string): string {
  if (!value) return '';
  const d = toDate(type, value);
  return type === 'date'
    ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
}

function Box({ type, label, value, onChange, min, max, invalid, help, error, optional }: DateTimeFieldProps & { type: 'date' | 'time' }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toDate(type, value));
  const ios = Platform.OS === 'ios';

  const picker = (
    <DateTimePicker
      mode={type}
      value={ios ? draft : toDate(type, value)}
      display={ios ? (type === 'date' ? 'inline' : 'spinner') : 'default'}
      // 12-hour with AM / PM on Android, as time is said in India. iPhone follows the phone's own setting.
      is24Hour={false}
      minimumDate={type === 'date' && min ? toDate('date', min) : undefined}
      maximumDate={type === 'date' && max ? toDate('date', max) : undefined}
      onChange={(event: DateTimePickerEvent, picked?: Date) => {
        if (ios) {
          if (picked) setDraft(picked);
          return;
        }
        // Android shows its own dialog: OK gives a date, Cancel gives none.
        setOpen(false);
        if (event.type === 'set' && picked) onChange(fromDate(type, picked));
      }}
    />
  );

  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={value ? `${label ?? ''}: ${shown(type, value, i18n.language)}` : label}
          onPress={() => {
            setDraft(toDate(type, value));
            setOpen(true);
          }}
          style={[styles.box, (invalid || !!error) && styles.boxBad]}
        >
          <Text style={[styles.value, !value && styles.placeholder]}>
            {value ? shown(type, value, i18n.language) : t(type === 'date' ? 'picker.pickDate' : 'picker.pickTime')}
          </Text>
        </Pressable>
        {optional && value ? (
          <Pressable accessibilityRole="button" onPress={() => onChange('')} style={styles.clear}>
            <Text style={styles.clearText}>{t('picker.clear')}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : help ? <Text style={styles.help}>{help}</Text> : null}

      {open && !ios ? picker : null}
      {open && ios ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setOpen(false)}>
          <View style={styles.sheetWrap}>
            <View style={styles.sheet}>
              {picker}
              <View style={styles.sheetActions}>
                <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.sheetButton}>
                  <Text style={styles.cancelText}>{t('picker.cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(fromDate(type, draft));
                    setOpen(false);
                  }}
                  style={[styles.sheetButton, styles.doneButton]}
                >
                  <Text style={styles.doneText}>{t('picker.done')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
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
  box: {
    flex: 1,
    minHeight: 54,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  boxBad: { borderColor: colors.alert },
  value: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16 },
  placeholder: { color: colors.muted },
  clear: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  clearText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  error: { color: colors.alert, fontFamily: fonts.bold, fontSize: 13 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 32, gap: 12 },
  sheetActions: { flexDirection: 'row', gap: 12 },
  sheetButton: { flex: 1, minHeight: 50, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  doneButton: { backgroundColor: colors.activeTab, borderColor: colors.activeTab },
  cancelText: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  doneText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
});
