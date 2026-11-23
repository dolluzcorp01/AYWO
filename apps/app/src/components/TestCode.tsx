// Only while AYWO is being tested: the sign-in code shown on the screen, since no SMS is sent yet.
// The server hands the code over only when it is set to print codes instead of sending them, which it refuses to
// do when live. So in the real app this never has anything to show.
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { SmallButton } from '@/components/ui';
import { colors, fonts, radius } from '@/theme/tokens';

export function TestCode({ code, onUse }: { code: string | null | undefined; onUse: (code: string) => void }) {
  const { t } = useTranslation();
  if (!code) return null;
  const copy = () =>
    Clipboard.setStringAsync(code).then(
      () => showToast('success', t('otp.testCopied')),
      () => showToast('error', t('otp.testCopyFailed')),
    );
  return (
    <View accessibilityRole="alert" style={styles.box}>
      <Text style={styles.label}>{t('otp.testLabel')}</Text>
      <Text selectable style={styles.code}>{code}</Text>
      <View style={styles.buttons}>
        <SmallButton kind="plain" label={t('otp.testCopy')} onPress={() => void copy()} />
        <SmallButton label={t('otp.testUse')} onPress={() => onUse(code)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6, padding: 14, borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.logoPurple, backgroundColor: colors.tint },
  label: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19 },
  code: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 26, letterSpacing: 6 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
