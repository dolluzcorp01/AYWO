// The bar at the top of every screen while the app cannot reach AYWO: what you see is the copy saved on this phone.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { checkNow, useLastSync, useOffline } from '@/lib/offline';
import { colors, fonts, radius } from '@/theme/tokens';

/** inset: for screens without the usual page padding. */
export function OfflineBar({ inset }: { inset?: boolean }) {
  const { t, i18n } = useTranslation();
  const offline = useOffline();
  const lastSync = useLastSync();
  const [checking, setChecking] = useState(false);
  if (!offline) return null;

  const when = lastSync ? savedWhen(lastSync, i18n.language) : null;
  return (
    <View style={[styles.bar, inset && styles.inset]} accessibilityRole="alert">
      <View style={styles.text}>
        <Text style={styles.title}>{t('offline.title')}</Text>
        <Text style={styles.help}>{when ? t('offline.savedAt', { when }) : t('offline.savedCopy')}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={checking}
        onPress={() => {
          setChecking(true);
          void checkNow().finally(() => setChecking(false));
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>{checking ? t('offline.checking') : t('offline.tryNow')}</Text>
      </Pressable>
    </View>
  );
}

/** "6:30 pm" today, otherwise "10 Nov, 6:30 pm". */
function savedWhen(time: number, lang: string): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return clock;
  return `${date.toLocaleDateString(lang, { day: 'numeric', month: 'short' })}, ${clock}`;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.card,
    backgroundColor: colors.text,
  },
  inset: { marginHorizontal: 20, marginTop: 8 },
  text: { flex: 1, gap: 1 },
  title: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  help: { color: colors.textOnDark, fontFamily: fonts.medium, fontSize: 12 },
  button: { minHeight: 36, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.white, justifyContent: 'center' },
  buttonText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
});
