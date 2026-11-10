// The public pages: Terms, Privacy policy, Return and refund policy, Contact. Open to everyone, signed in or not.
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, TopBar } from '@/components/ui';
import { LegalLinks } from '@/legal/LegalLinks';
import { LEGAL_DRAFT, LEGAL_VERSION, PUBLISHER } from '@/legal/publisher';
import { colors, fonts } from '@/theme/tokens';

export type LegalKind = 'terms' | 'privacy' | 'refunds' | 'contact';

const SECTIONS: Record<LegalKind, string[]> = {
  terms: ['who', 'account', 'family', 'others', 'plus', 'orders', 'removal', 'ending', 'liability', 'changes', 'law'],
  privacy: ['who', 'collect', 'contacts', 'share', 'providers', 'location', 'cookies', 'security', 'keep', 'rights', 'children', 'changes'],
  refunds: ['summary', 'cancel', 'web', 'stores', 'invites', 'physical', 'damaged', 'delivery', 'money', 'help'],
  contact: ['support', 'company', 'grievance', 'remove'],
};

export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useTranslation();
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t(`legal.${kind}.title`)} subtitle={t('legal.version', { version: LEGAL_VERSION })} onBack={close} />
        {LEGAL_DRAFT ? (
          <Card>
            <Text accessibilityRole="alert" style={styles.draft}>{t('legal.draft')}</Text>
          </Card>
        ) : null}
        {SECTIONS[kind].map((section) => (
          <View key={section} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>{t(`legal.${kind}.${section}Title`)}</Text>
            <Text style={styles.body}>{t(`legal.${kind}.${section}Body`, { ...PUBLISHER })}</Text>
          </View>
        ))}
        <LegalLinks current={kind} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, paddingBottom: 24 },
  draft: { color: colors.alert, fontFamily: fonts.extrabold, fontSize: 15 },
  section: { gap: 4 },
  heading: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  body: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23 },
});
