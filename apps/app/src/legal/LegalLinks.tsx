// Links to the public pages. Sign-in screens show only what signing in needs: Terms and Privacy.
// A wide browser window (the website on a computer) also gets the full footer, which payment providers check for.
// Everything else lives under Help and legal on the Me page.
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/Text';
import { WEB_COLUMN } from '@/components/WebFrame';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export const HELP_PAGES = [
  { key: 'faq', href: '/faq', label: 'legal.faqLink' },
  { key: 'terms', href: '/terms', label: 'legal.termsLink' },
  { key: 'privacy', href: '/privacy', label: 'legal.privacyLink' },
  { key: 'refunds', href: '/refunds', label: 'legal.refundsLink' },
  { key: 'contact', href: '/contact', label: 'legal.contactLink' },
] as const;

const SIGN_IN = new Set(['terms', 'privacy']);

/** signIn: Terms and Privacy only, plus the full footer on a computer's browser. Otherwise every page except this one. */
export function LegalLinks({ current, signIn }: { current?: string; signIn?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width > WEB_COLUMN + 40;
  const pages = HELP_PAGES.filter((page) => page.key !== current && (!signIn || desktop || SIGN_IN.has(page.key)));
  return (
    <View accessibilityRole="navigation" style={styles.row}>
      {pages.map((page) => (
        <Pressable key={page.key} accessibilityRole="link" onPress={() => router.push(page.href as Href)} style={styles.link}>
          <Text style={styles.text}>{t(page.label)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16 },
  link: { minHeight: minTapSize, justifyContent: 'center' },
  text: { color: colors.relation, fontFamily: fonts.bold, fontSize: 13 },
});
