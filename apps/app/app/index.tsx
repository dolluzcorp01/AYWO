// S-01 Welcome + language (wireframe Main)
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Text } from '@/components/Text';
import { Checkbox, ErrorText, Field, PrimaryButton, TextButton } from '@/components/ui';
import { firstScreenLanguages, moreLanguageCount } from '@/i18n/languages';
import type { Language } from '@/i18n/languages';
import { LegalLinks } from '@/legal/LegalLinks';
import { setLanguage, setLargeText, useLargeText } from '@/lib/prefs';
import { PublicAnnouncementBar } from '@/ops/Announcements';
import { colors, fonts, minTapSize, shadows } from '@/theme/tokens';

/** Takes a pasted family link, or just the code at the end of it. */
function tokenFromLink(text: string): string | null {
  const match = text.trim().replace(/\/+$/, '').match(/([A-Za-z0-9_-]{32,64})$/);
  return match ? match[1] : null;
}

export default function Welcome() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  const [picker, setPicker] = useState<{ startWith: Language | null } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkBad, setLinkBad] = useState(false);

  function tapChip(language: Language) {
    // English has regional variants too, but American English is a fine first answer. Change it from the full list.
    if (language.variants.length === 1 || language.id === 'en') {
      setLanguage(language.variants[0].code);
    } else {
      setPicker({ startWith: language });
    }
  }

  function openLink() {
    const token = tokenFromLink(linkText);
    if (!token) {
      setLinkBad(true);
      return;
    }
    setLinkOpen(false);
    router.push({ pathname: '/invite/[token]', params: { token } });
  }

  return (
    <View style={styles.page}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 22 }]}>
        <PublicAnnouncementBar />
        <Image source={require('../assets/aywo_logo_app.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="AYWO" />
        <View style={styles.faces} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.face, { left: '4%', top: 26 }]}><Avatar personId="welcome-a" size={56} /></View>
          <View style={[styles.face, { left: '70%', top: 6 }]}><Avatar personId="welcome-b" size={52} /></View>
          <View style={[styles.face, { left: '34%', top: 24 }]}><Avatar personId="welcome-c" size={92} ring /></View>
          <View style={[styles.face, { left: '16%', top: 96 }]}><Avatar personId="welcome-d" size={48} /></View>
          <View style={[styles.face, { left: '74%', top: 88 }]}><Avatar personId="welcome-e" size={56} /></View>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>

        <View style={styles.languages}>
          {firstScreenLanguages.map((language) => {
            const on = language.variants.some((v) => v.code === i18n.language);
            return (
              <Pressable
                key={language.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => tapChip(language)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{language.native}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.chooseLanguage')} onPress={() => setPicker({ startWith: null })} style={styles.chip}>
            <Text style={[styles.chipText, styles.more]}>{t('language.more', { count: moreLanguageCount })}</Text>
          </Pressable>
        </View>
        <Checkbox label={t('settings.largeText')} on={large} onChange={setLargeText} />
        <View style={styles.spacer} />
        <PrimaryButton label={t('welcome.getStarted')} onPress={() => router.push('/phone')} />
        <TextButton label={t('welcome.gotLink')} onPress={() => setLinkOpen(true)} />
        <LegalLinks signIn />
        <Pressable accessibilityRole="link" onPress={() => router.push('/takedown')} style={styles.takedown}>
          <Text style={styles.takedownText}>{t('takedown.askLink')}</Text>
        </Pressable>
      </ScrollView>

      <LanguagePicker
        visible={picker !== null}
        startWith={picker?.startWith}
        current={i18n.language}
        onPick={(code) => {
          setLanguage(code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />

      <Modal visible={linkOpen} transparent animationType="fade" onRequestClose={() => setLinkOpen(false)}>
        <View style={styles.scrim}>
          <View style={styles.dialog}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>{t('welcome.gotLink')}</Text>
            <Field
              value={linkText}
              onChangeText={(v) => {
                setLinkText(v);
                setLinkBad(false);
              }}
              placeholder={t('welcome.pasteLink')}
              accessibilityLabel={t('welcome.pasteLink')}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {linkBad ? <ErrorText>{t('link.notFound')}</ErrorText> : null}
            <PrimaryButton label={t('welcome.openLink')} onPress={openLink} disabled={!linkText.trim()} />
            <TextButton label={t('common.cancel')} onPress={() => setLinkOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 24, gap: 12 },
  logo: { height: 30, width: 104 },
  faces: { height: 160, marginTop: 8 },
  face: { position: 'absolute' },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 40, lineHeight: 44, letterSpacing: -1.6 },
  subtitle: { color: colors.muted, fontFamily: fonts.medium, fontSize: 17, lineHeight: 25, maxWidth: 320 },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    minHeight: minTapSize,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    justifyContent: 'center',
    ...shadows.card,
  },
  chipOn: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  chipText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  chipTextOn: { color: colors.white },
  more: { color: colors.relation },
  spacer: { flex: 1, minHeight: 12 },
  takedown: { alignSelf: 'center', minHeight: minTapSize, justifyContent: 'center' },
  takedownText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12, textDecorationLine: 'underline' },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', maxWidth: 480, backgroundColor: colors.card, borderRadius: 28, padding: 22, gap: 10, ...shadows.raised },
  dialogTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
});
