// S-02 Phone login (wireframe A2)
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text, TextInput } from '@/components/Text';
import { Card, Heading, Muted, PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function Phone() {
  const { t } = useTranslation();
  const router = useRouter();
  // Where to return after signing in, such as the family link this person came from.
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [countryCode, setCountryCode] = useState('+91');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);

  const parsed = parsePhoneNumberFromString(`${countryCode}${number}`);
  const valid = !!parsed && parsed.isValid();

  async function send() {
    if (!parsed) return;
    setBusy(true);
    setMessageKey(null);
    const phone = parsed.number;
    try {
      await api.post('/auth/otp/send', { phone });
      router.push({ pathname: '/otp', params: { phone, ...(next ? { next } : {}) } });
    } catch {
      setMessageKey('phone.sendFailed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Heading>{t('phone.title')}</Heading>
        <Muted>{t('phone.subtitle')}</Muted>
        <View style={styles.row}>
          <TextInput
            value={countryCode}
            onChangeText={setCountryCode}
            keyboardType="phone-pad"
            accessibilityLabel={t('phone.countryCode')}
            style={[styles.input, styles.code]}
          />
          <TextInput
            value={number}
            onChangeText={setNumber}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder={t('phone.placeholder')}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.number]}
          />
        </View>
        <Card>
          <Text style={styles.note}>{t('phone.privacyNote')}</Text>
        </Card>
        {messageKey ? <Text accessibilityRole="alert" style={styles.error}>{t(messageKey)}</Text> : null}
      </View>
      <Text style={styles.terms}>
        <Trans
          i18nKey="phone.terms"
          components={{
            terms: <Text accessibilityRole="link" onPress={() => router.push('/terms')} style={styles.termsLink} />,
            privacy: <Text accessibilityRole="link" onPress={() => router.push('/privacy')} style={styles.termsLink} />,
          }}
        />
      </Text>
      <PrimaryButton label={t('phone.send')} onPress={send} disabled={!valid || busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1, gap: 14, paddingTop: 40 },
  row: { flexDirection: 'row', gap: 10 },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 17,
  },
  code: { width: 84, minHeight: minTapSize },
  number: { flex: 1, borderColor: colors.logoPurple, borderWidth: 2 },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  error: { color: colors.alert, fontFamily: fonts.bold, fontSize: 14 },
  terms: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 28, textAlign: 'center', marginBottom: 12 },
  termsLink: { color: colors.relation, fontFamily: fonts.bold, fontSize: 13, textDecorationLine: 'underline' },
});
