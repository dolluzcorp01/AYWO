// S-02 Phone login (wireframe A2)
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { PhoneField } from '@/components/PhoneField';
import { Text } from '@/components/Text';
import { Card, ErrorText, Heading, Muted, PrimaryButton } from '@/components/ui';
import { api, ApiFailure } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { toE164 } from '@/lib/phone';
import { colors, fonts } from '@/theme/tokens';

export default function Phone() {
  const { t } = useTranslation();
  const router = useRouter();
  // Where to return after signing in, such as the family link this person came from.
  const { next } = useLocalSearchParams<{ next?: string }>();
  // "+919876543210": the country button starts at +91 in India, so people type just their 10 digits.
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);

  const phone = toE164(number);
  const valid = !!phone;

  async function send() {
    if (!phone) return;
    setBusy(true);
    setMessageKey(null);
    try {
      await api.post('/auth/otp/send', { phone });
      router.push({ pathname: '/otp', params: { phone, ...(next ? { next } : {}) } });
    } catch (error) {
      // "Check the number" only when the server refused the number. Too many tries and no connection say so.
      if (error instanceof ApiFailure && error.status !== 429) setMessageKey('phone.sendFailed');
      else setMessageKey(errorKey(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Heading>{t('phone.title')}</Heading>
        <Muted>{t('phone.subtitle')}</Muted>
        <PhoneField
          value={number}
          onChangeText={(v) => {
            setNumber(v);
            setMessageKey(null);
          }}
          placeholder={t('phone.placeholder')}
          autoComplete="tel"
        />
        <Card>
          <Text style={styles.note}>{t('phone.privacyNote')}</Text>
        </Card>
        {messageKey ? <ErrorText>{t(messageKey)}</ErrorText> : null}
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
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  terms: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 28, textAlign: 'center', marginBottom: 12 },
  termsLink: { color: colors.relation, fontFamily: fonts.bold, fontSize: 13, textDecorationLine: 'underline' },
});
