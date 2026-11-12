// The health card notice (DPDP Rules, rule 3): on its own, in plain words, item by item: what is kept, why, who sees
// it, for how long, that it is optional, how to withdraw, and where to complain. Shown before the first save.
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { TextButton } from '@/components/ui';
import { PUBLISHER } from '@/legal/publisher';
import { colors, fonts, radius } from '@/theme/tokens';

const SECTIONS = ['what', 'why', 'who', 'howLong', 'optional', 'withdraw', 'complain'] as const;

export function HealthNotice() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View style={styles.box} accessibilityLabel={t('ops.consent.noticeTitle')}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('ops.consent.noticeTitle')}
      </Text>
      {SECTIONS.map((s) => (
        <View key={s} style={styles.item}>
          <Text style={styles.label}>{t(`ops.consent.${s}Title`)}</Text>
          <Text style={styles.body}>{t(`ops.consent.${s}Body`, { ...PUBLISHER })}</Text>
        </View>
      ))}
      <TextButton label={t('legal.privacyLink')} onPress={() => router.push('/privacy')} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 10,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.dashed,
  },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  item: { gap: 2 },
  label: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  body: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
  },
});
