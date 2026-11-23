// Larger pieces of the front page: where the buttons lead, the top bar, the "open on the web" button, the footer.
import type { Href } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { DownIcon, RightIcon } from '@/components/Icons';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LogoLink } from '@/components/LogoLink';
import { Text } from '@/components/Text';
import { languageOfCode } from '@/i18n/languages';
import { HELP_PAGES } from '@/legal/LegalLinks';
import { hasSession, onSessionChange } from '@/lib/api';
import { setLanguage } from '@/lib/prefs';
import { useAppConfig } from '@/ops/appConfig';
import { colors, fonts, minTapSize, radius } from '@/theme/tokens';

/** The store links staff saved, and where "open on the web" goes for this person. */
export function useFrontDoor() {
  const { t } = useTranslation();
  const router = useRouter();
  const stores = useAppConfig().data?.store_links;
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    void hasSession().then((yes) => {
      if (live) setSignedIn(yes);
    });
    const stop = onSessionChange(setSignedIn);
    return () => {
      live = false;
      stop();
    };
  }, []);
  const android = stores?.android ?? '';
  const ios = stores?.ios ?? '';
  return {
    android,
    ios,
    anyStore: !!android || !!ios,
    signedIn,
    openWeb: () => router.push(signedIn ? '/after-login' : '/welcome'),
    webLabel: t(signedIn ? 'landing.openApp' : 'landing.openWeb'),
  };
}

export type Door = ReturnType<typeof useFrontDoor>;

const TONES = {
  indigo: { box: { backgroundColor: colors.logoIndigo }, ink: colors.white },
  yellow: { box: { backgroundColor: colors.logoYellow }, ink: colors.text },
  white: { box: { backgroundColor: colors.white }, ink: colors.text },
  outline: { box: { borderWidth: 1.5, borderColor: colors.logoIndigo }, ink: colors.logoIndigo },
  outlineOnDark: { box: { borderWidth: 1.5, borderColor: colors.white }, ink: colors.white },
} as const;

export function WebButton({ door, tone }: { door: Door; tone: keyof typeof TONES }) {
  const look = TONES[tone];
  return (
    <Pressable accessibilityRole="link" onPress={door.openWeb} style={({ hovered }: { hovered?: boolean }) => [styles.web, look.box, hovered && styles.lift]}>
      <Text style={[styles.webText, { color: look.ink }]}>{door.webLabel}</Text>
      <RightIcon color={look.ink} size={18} />
    </Pressable>
  );
}

export function LandingBar({ door, narrow, onTop, links }: { door: Door; narrow: boolean; onTop: () => void; links?: { label: string; onPress: () => void }[] }) {
  const { t, i18n } = useTranslation();
  const [picker, setPicker] = useState(false);
  return (
    <View style={styles.bar}>
      <View style={[styles.barInner, narrow && styles.barInnerNarrow]}>
        <LogoLink label={t('landing.toTop')} onPress={onTop} style={styles.selfCentre} />
        {links ? (
          <View accessibilityRole="navigation" style={styles.barLinks}>
            {links.map((link) => (
              <Pressable key={link.label} accessibilityRole="link" onPress={link.onPress} style={styles.barLink}>
                <Text style={styles.barLinkText}>{link.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.grow} />
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.chooseLanguage')} onPress={() => setPicker(true)} style={styles.language}>
          <Text style={styles.languageText} numberOfLines={1}>{languageOfCode(i18n.language)?.native ?? 'English'}</Text>
          <DownIcon color={colors.relation} size={14} />
        </Pressable>
        <Pressable accessibilityRole="link" onPress={door.openWeb} style={({ hovered }: { hovered?: boolean }) => [styles.signIn, hovered && styles.lift]}>
          <Text style={styles.signInText}>{door.signedIn ? t('landing.openApp') : t(narrow ? 'landing.signIn' : 'landing.openWeb')}</Text>
        </Pressable>
      </View>
      <LanguagePicker
        visible={picker}
        current={i18n.language}
        onPick={(code) => {
          setLanguage(code);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}

export function LandingFooter({ onTop }: { onTop: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View style={styles.footer}>
      <LogoLink label={t('landing.toTop')} onPress={onTop} style={styles.selfCentre} />
      <Text style={styles.footerText}>{t('welcome.subtitle')}</Text>
      <View accessibilityRole="navigation" style={styles.footerLinks}>
        {HELP_PAGES.map((page) => (
          <Pressable key={page.key} accessibilityRole="link" onPress={() => router.push(page.href as Href)} style={styles.footerLink}>
            <Text style={styles.footerLinkText}>{t(page.label)}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="link" onPress={() => router.push('/takedown')} style={styles.footerLink}>
          <Text style={styles.footerLinkText}>{t('landing.footer.remove')}</Text>
        </Pressable>
      </View>
      <Text style={styles.footerSmall}>{t('landing.footer.rights')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  selfCentre: { alignSelf: 'center' },
  lift: { opacity: 0.9, transform: [{ translateY: -1 }] },
  web: { minHeight: 52, paddingHorizontal: 22, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', cursor: 'pointer' },
  webText: { fontFamily: fonts.bold, fontSize: 16 },
  bar: { backgroundColor: colors.background, borderBottomWidth: 1, borderColor: colors.barEdge, alignItems: 'center' },
  barInner: { width: '100%', maxWidth: 1184, height: 64, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLinks: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  barLink: { minHeight: minTapSize, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12 },
  barLinkText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  barInnerNarrow: { paddingHorizontal: 16, gap: 8 },
  language: {
    minHeight: minTapSize,
    maxWidth: 150,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  languageText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, flexShrink: 1 },
  signIn: { minHeight: minTapSize, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.logoIndigo, justifyContent: 'center' },
  signInText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  footer: { paddingHorizontal: 16, paddingVertical: 40, alignItems: 'center', gap: 12, backgroundColor: colors.background, borderTopWidth: 1, borderColor: colors.barEdge },
  footerText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20 },
  footerLink: { minHeight: minTapSize, justifyContent: 'center' },
  footerLinkText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
  footerSmall: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
});
