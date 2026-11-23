// S-02 Phone login (wireframe A2)
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { PhoneField } from '@/components/PhoneField';
import { Text } from '@/components/Text';
import { BackButton, Card, ErrorText, Heading, Muted, PrimaryButton } from '@/components/ui';
import { api, ApiFailure } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { toE164 } from '@/lib/phone';
import { setSignInPhone, setSignInTestCode } from '@/lib/signInPhone';
import { track } from '@/lib/track';
import { colors, fonts } from '@/theme/tokens';

export default function Phone() {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  // Where to return after signing in, such as the family link this person came from.
  const { next } = useLocalSearchParams<{ next?: string }>();
  // "+919876543210": the country button starts at +91 in India, so people type just their 10 digits.
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const phone = toE164(number);
  const valid = !!phone;

  async function send() {
    if (!phone) return;
    setBusy(true);
    setMessage(null);
    try {
      const sent = await api.post<{ test_code?: string }>('/auth/otp/send', { phone });
      setSignInTestCode(sent.test_code ?? null);
      track('code_requested');
      // In memory, not in the address: a phone number must not sit in the browser's history.
      setSignInPhone(phone);
      router.push({ pathname: '/otp', params: next ? { next } : {} });
    } catch (error) {
      // "Check the number" only when the server refused the number itself. Too many tries, no connection and a
      // problem on AYWO's side each say what they are, so nobody retypes a number that was right.
      const badNumber = error instanceof ApiFailure && (error.code === 'phone_invalid' || error.code === 'bad_input');
      setMessage(badNumber ? t('phone.sendFailed') : errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}>
        {/* Back to Welcome: to change the language, or to use "Got a link from family?". */}
        <View style={styles.back}>
          <BackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
        <Heading>{t('phone.title')}</Heading>
        <Muted>{t('phone.subtitle')}</Muted>
        <PhoneField
          value={number}
          onChangeText={(v) => {
            setNumber(v);
            setMessage(null);
          }}
          placeholder={t('phone.placeholder')}
          autoComplete="tel"
        />
        <Card>
          <Text style={styles.note}>{t('phone.privacyNote')}</Text>
        </Card>
        {message ? <ErrorText>{message}</ErrorText> : null}
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
      <PrimaryButton label={t('phone.send')} onPress={send} disabled={busy} missing={valid ? null : t('phone.needNumber')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1, gap: 14, paddingTop: 8 },
  back: { alignSelf: 'flex-start', marginBottom: 8 },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  terms: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 28, textAlign: 'center', marginBottom: 12 },
  termsLink: { color: colors.relation, fontFamily: fonts.bold, fontSize: 13, textDecorationLine: 'underline' },
});
