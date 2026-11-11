// The one phone box for every screen: a country button (+91 to start, for India) and a box for just the number.
// Elders know their 10 digits, not the +91, so nobody has to type a country code. Hands back "+919876543210".
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import type { CountryCode } from 'libphonenumber-js';
import * as FLAGS from 'country-flag-icons/string/3x2';
import { SvgXml } from 'react-native-svg';
import { CloseIcon, ContactsIcon } from '@/components/Icons';
import { showToast } from '@/components/Toast';
import { Text, TextInput } from '@/components/Text';
import { callingCode, countryOptions, defaultCountry, joinPhone, splitPhone } from '@/lib/phone';
import { bestNumber, canPickContact, ContactsDenied, pickContact } from '@/lib/pickContact';
import type { PickedContact } from '@/lib/pickContact';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

interface Props {
  label?: string;
  /** "+919876543210", or whatever was saved before (an old number without a code still shows). */
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  editable?: boolean;
  autoComplete?: 'tel' | 'off';
  /** Shows a "Choose from contacts" button; called with the chosen contact after its number is filled in. */
  onPickContact?: (contact: PickedContact) => void;
}

export function PhoneField({ label, value, onChangeText, placeholder, invalid, editable = true, autoComplete = 'off', onPickContact }: Props) {
  const { t, i18n } = useTranslation();
  const [country, setCountry] = useState<CountryCode>(() => splitPhone(value, defaultCountry()).country);
  const [national, setNational] = useState(() => splitPhone(value, defaultCountry()).national);
  const [picking, setPicking] = useState(false);

  // A value set from outside (loaded from the server, "Same as mobile") replaces what the boxes show.
  useEffect(() => {
    if (joinPhone(country, national) === value || (!value && !national)) return;
    const next = splitPhone(value, country);
    setCountry(next.country);
    setNational(next.national);
    // Only when the value itself changes from outside.
  }, [value]);

  function typeNumber(text: string) {
    if (text.trim().startsWith('+')) {
      // Someone typed the code anyway: move it to the country button.
      const next = splitPhone(text, country);
      if (next.country !== country || text.replace(/\D/g, '').length > 3) {
        setCountry(next.country);
        setNational(next.national);
        onChangeText(joinPhone(next.country, next.national));
        return;
      }
    }
    setNational(text);
    onChangeText(joinPhone(country, text));
  }

  async function fromContacts() {
    try {
      const picked = await pickContact();
      if (!picked) return;
      const number = bestNumber(picked, country);
      if (number) {
        const next = splitPhone(number, country);
        setCountry(next.country);
        setNational(next.national);
        onChangeText(joinPhone(next.country, next.national));
      } else {
        showToast('error', t('phoneField.contactNoNumber'));
      }
      onPickContact?.(picked);
    } catch (error) {
      showToast('error', t(error instanceof ContactsDenied ? 'phoneField.contactsDenied' : 'phoneField.contactsFailed'));
    }
  }

  function choose(code: CountryCode) {
    setCountry(code);
    setPicking(false);
    onChangeText(joinPhone(code, national));
  }

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('phoneField.country', { code: callingCode(country) })}
          disabled={!editable}
          onPress={() => setPicking(true)}
          style={[styles.box, styles.countryBox, invalid && styles.invalid]}
        >
          <Flag code={country} />
          <Text style={styles.code}>{callingCode(country)}</Text>
          <Text style={styles.caret}>▾</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={label}
          value={national}
          onChangeText={typeNumber}
          placeholder={placeholder ?? t('phoneField.placeholder')}
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          autoComplete={autoComplete}
          editable={editable}
          maxLength={18}
          style={[styles.box, styles.number, invalid && styles.invalid, !editable && styles.disabled]}
        />
        {onPickContact && editable && canPickContact() ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('phoneField.fromContacts')} onPress={() => void fromContacts()} style={[styles.box, styles.contactsButton]}>
            <ContactsIcon color={colors.logoIndigo} size={22} />
          </Pressable>
        ) : null}
      </View>
      <CountryPicker visible={picking} language={i18n.language} current={country} onPick={choose} onClose={() => setPicking(false)} />
    </View>
  );
}

/**
 * A flag drawn from the app's own pictures, so it looks the same everywhere: Windows has no flag emoji and
 * would show the letters "IN" instead.
 */
function Flag({ code }: { code: string }) {
  const xml = (FLAGS as Record<string, string>)[code];
  return (
    <View style={styles.flagBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {xml ? <SvgXml xml={xml} width={24} height={16} /> : <Text style={styles.flagText}>{code}</Text>}
    </View>
  );
}

function CountryPicker({ visible, language, current, onPick, onClose }: {
  visible: boolean;
  language: string;
  current: CountryCode;
  onPick: (code: CountryCode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const options = useMemo(() => countryOptions(language), [language]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase() === q || o.dial.slice(1).startsWith(q));
  }, [options, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.close')}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHead}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>{t('phoneField.chooseCountry')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <CloseIcon size={20} color={colors.text} />
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('phoneField.search')}
            placeholderTextColor={colors.muted}
            autoFocus
            style={[styles.box, styles.search]}
          />
          <FlatList
            data={shown}
            keyExtractor={(o) => o.code}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.code === current }}
                onPress={() => onPick(item.code)}
                style={[styles.option, item.code === current && styles.optionOn]}
              >
                <Flag code={item.code} />
                <Text style={styles.optionName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.optionDial}>{item.dial}</Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13 },
  row: { flexDirection: 'row', gap: 8 },
  box: {
    minHeight: 54,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },
  countryBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  number: { flex: 1, minWidth: 0 },
  contactsButton: { width: 54, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  invalid: { borderColor: colors.alert, borderWidth: 2 },
  disabled: { color: colors.muted },
  flagBox: { width: 24, height: 16, borderRadius: 3, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  flagText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 9 },
  code: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  caret: { color: colors.muted, fontSize: 12 },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '80%',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 16,
    gap: 12,
    ...shadows.raised,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  closeButton: { width: minTapSize, height: minTapSize, alignItems: 'center', justifyContent: 'center' },
  search: {},
  list: { flexGrow: 0 },
  option: { minHeight: minTapSize + 4, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: 12 },
  optionOn: { backgroundColor: colors.tint },
  optionName: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  optionDial: { color: colors.muted, fontFamily: fonts.bold, fontSize: 15 },
});
