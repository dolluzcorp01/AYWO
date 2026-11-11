// S-03 OTP (wireframe A3)
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text, TextInput } from '@/components/Text';
import { ErrorText, Heading, Muted, PrimaryButton } from '@/components/ui';
import { api, ApiFailure, saveSession } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { colors, fonts } from '@/theme/tokens';

const RESEND_SECONDS = 30;

export default function Otp() {
  const { t } = useTranslation();
  const router = useRouter();
  const { phone, next } = useLocalSearchParams<{ phone: string; next?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(entered: string = code) {
    if (busy) return;
    setBusy(true);
    setMessageKey(null);
    try {
      await saveSession(await api.post<{ access_token: string; refresh_token: string }>('/auth/otp/verify', { phone, code: entered }));
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
    await api.post('/auth/otp/send', { phone }).catch((error: unknown) => setMessageKey(errorKey(error)));
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Heading>{t('otp.title')}</Heading>
        <Muted>{t('otp.sentTo', { phone })}</Muted>
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
      </View>
      {wait > 0 ? (
        <Text style={styles.resend}>{t('otp.resendIn', { seconds: wait })}</Text>
      ) : (
        <Text accessibilityRole="button" onPress={resend} style={[styles.resend, styles.resendOn]}>{t('otp.resend')}</Text>
      )}
      <PrimaryButton label={t('otp.verify')} onPress={() => void verify()} disabled={code.length !== 6 || busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1, gap: 14, paddingTop: 40 },
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
  resendOn: { color: colors.logoPurple },
});
