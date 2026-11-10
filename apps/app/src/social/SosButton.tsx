// Owned by the social area: the SOS entry on the Me screen. Opens the screen with the hold and the 5-second cancel.
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export function SosButton() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/social/sos')} style={styles.row}>
      <View style={styles.mark}>
        <Text style={styles.markText}>{t('social.sos.mark')}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('social.sos.entryTitle')}</Text>
        <Text style={styles.hint}>{t('social.sos.entryHint')}</Text>
      </View>
      <ChevronIcon color={colors.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTapSize + 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  mark: { minWidth: 44, height: 44, borderRadius: 22, paddingHorizontal: 6, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 13 },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  hint: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
});
