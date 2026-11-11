// Shown on Home and Me while an account deletion is booked: the day it goes, and one tap to keep the account.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { ErrorText, SmallButton } from '@/components/ui';
import { useKeepAccount, useMe } from '@/lib/account';
import { useErrorText } from '@/lib/errors';
import { colors, fonts, radius } from '@/theme/tokens';

export function DeleteBanner() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const keep = useKeepAccount();
  const errorText = useErrorText();
  const when = me.data?.delete_after;
  if (!when) return null;
  const day = new Date(when).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.title}>{t('settings.deleteBooked', { date: day })}</Text>
      <Text style={styles.help}>{t('settings.deleteBookedHelp')}</Text>
      <View style={styles.button}>
        <SmallButton label={t('settings.keepAccount')} onPress={() => keep.mutate()} disabled={keep.isPending} />
      </View>
      {keep.isError ? <ErrorText>{errorText(keep.error)}</ErrorText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: 6,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.alertTint,
    borderWidth: 1,
    borderColor: colors.alert,
  },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
  button: { alignSelf: 'flex-start', marginTop: 4 },
});
