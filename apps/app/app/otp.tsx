// S-03 OTP (wireframe A3)
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { TestCode } from '@/components/TestCode';
import { Text, TextInput } from '@/components/Text';
import { BackButton, ErrorText, Heading, Muted, PrimaryButton, TextButton } from '@/components/ui';
import { api, ApiFailure, saveSession } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { getSignInPhone, getSignInTestCode, setSignInPhone, setSignInTestCode } from '@/lib/signInPhone';
import { track } from '@/lib/track';
import { colors, fonts } from '@/theme/tokens';

const RESEND_SECONDS = 30;

export default function Otp() {
  const { t } = useTranslation();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  // Handed over in memory by the phone screen (never in the address).
  const [phone] = useState(getSignInPhone);
  const [code, setCode] = useState('');
  // Testing only: the code, when the server sends no SMS yet.
  const [testCode, setTestCode] = useState(getSignInTestCode);
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);

  // The number is gone after a page reload, or when this address is opened directly: ask for it again.
  useEffect(() => {
    if (!phone) router.replace({ pathname: '/phone', params: next ? { next } : {} });
  }, [phone, next, router]);

  function changeNumber() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/phone', params: next ? { next } : {} });
  }

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(entered: string = code) {
    if (busy || !phone) return;
    setBusy(true);
    setMessageKey(null);
    try {
      await saveSession(await api.post<{ access_token: string; refresh_token: string }>('/auth/otp/verify', { phone, code: entered }));
      track('code_verified');
      setSignInPhone(null);
      setSignInTestCode(null);
      // The sign-in screens come off the pile first. They used to stay under Home, so Back from Home or Me showed
      // the "enter your mobile number" screen to someone already signed in.
      if (router.canDismiss()) router.dismissAll();
      router.replace({ pathname: '/after-login', params: next ? { next } : {} });
    } catch (error) {
      setMessageKey(error instanceof ApiFailure && error.code === 'otp_wrong' ? 'otp.wrongCode' : errorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setWait(RESEND_SECONDS);
    setMessageKey(null);
    // A refused resend (too many codes, no connection) used to fail silently, leaving people waiting for an SMS.
    await api
      .post<{ test_code?: string }>('/auth/otp/send', { phone })
      .then((sent) => setTestCode(sent.test_code ?? null))
      .catch((error: unknown) => setMessageKey(errorKey(error)));
  }

  if (!phone) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.back}>
          <BackButton onPress={changeNumber} />
        </View>
        <Heading>{t('otp.title')}</Heading>
        <Muted>{t('otp.sentTo', { phone })}</Muted>
        <TextButton label={t('otp.changeNumber')} onPress={changeNumber} />
        <TextInput
          value={code}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            // The sixth digit sends it, as people expect (and as an SMS autofill does in one go).
            if (digits.length === 6 && digits !== code) void verify(digits);
          }}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          autoFocus
          accessibilityLabel={t('otp.title')}
          style={styles.code}
        />
        {messageKey ? <ErrorText>{t(messageKey)}</ErrorText> : null}
        <TestCode
          code={testCode}
          onUse={(value) => {
            setCode(value);
            void verify(value);
          }}
        />
      </View>
      {wait > 0 ? (
        <Text style={styles.resend}>{t('otp.resendIn', { seconds: wait })}</Text>
      ) : (
        <View style={styles.resendButton}>
          <TextButton label={t('otp.resend')} onPress={() => void resend()} />
        </View>
      )}
      <PrimaryButton label={t('otp.verify')} onPress={() => void verify()} disabled={busy} missing={code.length === 6 ? null : t('otp.needCode')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginBottom: 8 },
  top: { flex: 1, gap: 14, paddingTop: 8 },
  code: {
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.logoPurple,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: 'center',
  },
  resend: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, textAlign: 'center', marginBottom: 12, minHeight: 44, textAlignVertical: 'center' },
  // Same room under it as the countdown line it replaces, so the Verify button does not jump.
  resendButton: { marginBottom: 12 },
});
