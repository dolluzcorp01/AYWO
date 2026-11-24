// An address that is not a page of AYWO: a mistyped or old link. Before this the app showed the developer's
// "Unmatched Route" page, in English, with a list of every file.
import { useRouter } from '@/lib/router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Heading, Muted, PrimaryButton, TextButton } from '@/components/ui';
import { goBack } from '@/lib/nav';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <View style={styles.box}>
        <Heading>{t('notFound.title')}</Heading>
        <Muted>{t('notFound.text')}</Muted>
        {/* '/' sends a signed-in person to Home and everyone else to Welcome. */}
        <PrimaryButton label={t('notFound.home')} onPress={() => router.replace('/')} />
        {router.canGoBack() ? <TextButton label={t('notFound.back')} onPress={() => goBack(router)} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: 'center', gap: 14, width: '100%', maxWidth: 520, alignSelf: 'center' },
});
