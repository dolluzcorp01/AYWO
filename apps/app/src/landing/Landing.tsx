// The website's front page. It says what AYWO is, sends people to the Android and iPhone apps, and keeps a way into
// the web app ("Continue on the web"). The store links come from Admin > App settings > App store links; while a
// link is empty that app shows as "Coming soon". Everything here is public: no account, no family data.
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { BellIcon, CalendarIcon, ChatIcon, CheckIcon, DownIcon, DownloadIcon, LinkedPeopleIcon, MicIcon, PhotoIcon, RightIcon, ShieldIcon, UpIcon } from '@/components/Icons';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LogoLink } from '@/components/LogoLink';
import { Text } from '@/components/Text';
import { languageOfCode } from '@/i18n/languages';
import { HELP_PAGES } from '@/legal/LegalLinks';
import { hasSession, onSessionChange } from '@/lib/api';
import { setLanguage } from '@/lib/prefs';
import { PublicAnnouncementBar } from '@/ops/Announcements';
import { useAppConfig } from '@/ops/appConfig';
import { ProductPicture } from '@/ops/ProductPicture';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';
import { FloatingNote, PhoneMock } from './art';

const MAX_WIDTH = 1120;
const BAR_HEIGHT = 64;

type SectionId = 'features' | 'how' | 'questions';

const FEATURES = [
  { key: 'tree', icon: LinkedPeopleIcon },
  { key: 'memories', icon: PhotoIcon },
  { key: 'calendar', icon: CalendarIcon },
  { key: 'alerts', icon: BellIcon },
  { key: 'chat', icon: ChatIcon },
  { key: 'keep', icon: DownloadIcon },
] as const;

const WORDS = ['one', 'two', 'three'] as const;
const STEPS = ['one', 'two', 'three'] as const;
const ELDER_POINTS = ['big', 'simple', 'voice'] as const;
const SAFE_POINTS = ['private', 'number', 'ads', 'remove'] as const;
// Answers that need no price or contact detail filled in, so they read the same here as on the FAQ page.
const QUESTIONS = [
  { group: 'start', id: 'free' },
  { group: 'tree', id: 'whoSees' },
  { group: 'start', id: 'signIn' },
  { group: 'safety', id: 'sell' },
] as const;

/** One of the two store buttons. With no link yet it is a quiet "Coming soon" tile, not a button that opens nothing. */
function StoreButton({ platform, link, onDark }: { platform: 'android' | 'ios'; link: string; onDark?: boolean }) {
  const { t } = useTranslation();
  const name = t(`landing.store.${platform}`);
  if (!link) {
    return (
      <View accessibilityLabel={t('landing.store.soonLabel', { store: name })} style={[styles.store, styles.storeSoon, onDark && styles.storeSoonOnDark]}>
        <Text style={[styles.storeSmall, onDark && styles.onDarkQuiet]}>{t('landing.store.soon')}</Text>
        <Text style={[styles.storeName, { color: onDark ? colors.white : colors.muted }]}>{name}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('landing.store.getLabel', { store: name })}
      onPress={() => void Linking.openURL(link).catch(() => undefined)}
      style={({ hovered }: { hovered?: boolean }) => [styles.store, onDark ? styles.storeLiveOnDark : styles.storeLive, hovered && styles.lift]}
    >
      <Text style={[styles.storeSmall, { color: onDark ? colors.muted : colors.textOnDark }]}>{t('landing.store.get')}</Text>
      <Text style={[styles.storeName, { color: onDark ? colors.text : colors.white }]}>{name}</Text>
    </Pressable>
  );
}

/** A full-width band of the page with its content kept to a comfortable reading width. */
function Band({ children, tone, onLayout, narrow }: { children: ReactNode; tone?: 'tint' | 'warm' | 'dark'; onLayout?: (e: LayoutChangeEvent) => void; narrow: boolean }) {
  return (
    <View onLayout={onLayout} style={[styles.band, narrow && styles.bandNarrow, tone === 'tint' && styles.bandTint, tone === 'warm' && styles.bandWarm, tone === 'dark' && styles.bandDark]}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

function BandTitle({ eyebrow, title, text, onDark, centre }: { eyebrow: string; title: string; text?: string; onDark?: boolean; centre?: boolean }) {
  return (
    <View style={[styles.bandTitle, centre && styles.bandTitleCentre]}>
      <Text style={[styles.eyebrow, onDark && { color: colors.logoYellow }, centre && styles.textCentre]}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={[styles.h2, onDark && { color: colors.white }, centre && styles.textCentre]}>{title}</Text>
      {text ? <Text style={[styles.lead, onDark && styles.onDarkQuiet, centre && styles.textCentre]}>{text}</Text> : null}
    </View>
  );
}

function Tick({ text, onDark }: { text: string; onDark?: boolean }) {
  return (
    <View style={styles.tick}>
      <View style={[styles.tickMark, onDark && { backgroundColor: colors.glass }]}>
        <CheckIcon color={onDark ? colors.logoYellow : colors.good} size={16} width={2.6} />
      </View>
      <Text style={[styles.tickText, onDark && { color: colors.white }]}>{text}</Text>
    </View>
  );
}

function Question({ group, id }: { group: string; id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.question}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((was) => !was)} style={styles.questionRow}>
        <Text style={styles.questionText}>{t(`legal.faq.${group}.${id}Q`)}</Text>
        {open ? <UpIcon color={colors.relation} size={20} /> : <DownIcon color={colors.relation} size={20} />}
      </Pressable>
      {open ? <Text style={styles.answer}>{t(`legal.faq.${group}.${id}A`)}</Text> : null}
    </View>
  );
}

export function Landing() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const narrow = width < 640;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const tops = useRef<Partial<Record<SectionId, number>>>({});
  const [picker, setPicker] = useState(false);
  const stores = useAppConfig().data?.store_links;
  const android = stores?.android ?? '';
  const ios = stores?.ios ?? '';
  const anyStore = !!android || !!ios;

  const mark = (id: SectionId) => (e: LayoutChangeEvent) => {
    tops.current[id] = e.nativeEvent.layout.y;
  };
  const go = (id: SectionId) => scroll.current?.scrollTo({ y: Math.max(0, (tops.current[id] ?? 0) - BAR_HEIGHT), animated: true });
  // Someone already signed in goes straight back to their family; a visitor starts at the sign-in steps.
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
  const openWeb = () => router.push(signedIn ? '/after-login' : '/welcome');
  const webLabel = t(signedIn ? 'landing.openApp' : 'landing.openWeb');
  const language = languageOfCode(i18n.language)?.native ?? 'English';

  const storeButtons = (onDark?: boolean) => (
    <View style={[styles.stores, onDark && styles.storesCentre]}>
      <StoreButton platform="android" link={android} onDark={onDark} />
      <StoreButton platform="ios" link={ios} onDark={onDark} />
    </View>
  );
  // Until an app is live, the web app is the way in, so it gets the strong button.
  const webButton = (onDark?: boolean) => (
    <Pressable
      accessibilityRole="link"
      onPress={openWeb}
      style={({ hovered }: { hovered?: boolean }) => [
        styles.web,
        anyStore ? (onDark ? styles.webQuietOnDark : styles.webQuiet) : onDark ? styles.webStrongOnDark : styles.webStrong,
        hovered && styles.lift,
      ]}
    >
      <Text style={[styles.webText, { color: anyStore ? (onDark ? colors.white : colors.logoIndigo) : onDark ? colors.text : colors.white }]}>{webLabel}</Text>
      <RightIcon color={anyStore ? (onDark ? colors.white : colors.logoIndigo) : onDark ? colors.text : colors.white} size={18} />
    </Pressable>
  );

  return (
    <View style={styles.page}>
      <ScrollView ref={scroll} style={styles.page} stickyHeaderIndices={[0]}>
        {/* The bar that stays at the top while the page scrolls. */}
        <View style={styles.bar}>
          <View style={[styles.barInner, narrow && styles.barInnerNarrow]}>
            <LogoLink label={t('landing.toTop')} onPress={() => scroll.current?.scrollTo({ y: 0, animated: true })} style={styles.barLogo} />
            {wide ? (
              <View accessibilityRole="navigation" style={styles.barLinks}>
                <Pressable accessibilityRole="link" onPress={() => go('features')} style={styles.barLink}><Text style={styles.barLinkText}>{t('landing.nav.features')}</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => go('how')} style={styles.barLink}><Text style={styles.barLinkText}>{t('landing.nav.how')}</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => go('questions')} style={styles.barLink}><Text style={styles.barLinkText}>{t('landing.nav.questions')}</Text></Pressable>
              </View>
            ) : (
              <View style={styles.grow} />
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.chooseLanguage')} onPress={() => setPicker(true)} style={styles.language}>
              <Text style={styles.languageText} numberOfLines={1}>{language}</Text>
              <DownIcon color={colors.relation} size={14} />
            </Pressable>
            <Pressable accessibilityRole="link" onPress={openWeb} style={({ hovered }: { hovered?: boolean }) => [styles.signIn, hovered && styles.lift]}>
              <Text style={styles.signInText}>{signedIn ? t('landing.openApp') : t(narrow ? 'landing.signIn' : 'landing.openWeb')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Hero */}
        <View style={[styles.hero, narrow && styles.bandNarrow]}>
          <View style={[styles.blob, styles.blobOne]} />
          <View style={[styles.blob, styles.blobTwo]} />
          <View style={styles.inner}>
            <PublicAnnouncementBar />
            <View style={[styles.heroRow, !wide && styles.heroStack]}>
              <View style={[styles.heroWords, !wide && styles.heroWordsStack]}>
                <View style={styles.badge}><Text style={styles.badgeText}>{t('landing.hero.badge')}</Text></View>
                <Text accessibilityRole="header" style={[styles.h1, wide ? styles.h1Wide : narrow ? styles.h1Narrow : styles.h1Mid]}>{t('welcome.title')}</Text>
                <Text style={[styles.heroLead, narrow && styles.heroLeadNarrow]}>{t('landing.hero.lead')}</Text>
                {storeButtons()}
                {webButton()}
                {anyStore ? null : <Text style={styles.soonNote}>{t('landing.hero.soonNote')}</Text>}
                <View style={styles.facts}>
                  <Tick text={t('landing.hero.factFree')} />
                  <Tick text={t('landing.hero.factPrivate')} />
                  <Tick text={t('landing.hero.factAds')} />
                </View>
              </View>
              <View style={[styles.heroArt, narrow && styles.heroArtNarrow]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <PhoneMock />
                {!wide ? null : (
                  <>
                    <FloatingNote icon="calendar" title={t('landing.art.noteBirthdayTitle')} text={t('landing.art.noteBirthdayText')} style={styles.noteOne} />
                    <FloatingNote icon="photo" title={t('landing.art.noteMemoryTitle')} text={t('landing.art.noteMemoryText')} style={styles.noteTwo} />
                  </>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* What do I call them? The thing no other family tree does. */}
        <Band narrow={narrow}>
          <View style={[styles.split, !wide && styles.splitStack]}>
            <View style={[styles.splitWords, !wide && styles.noFlex]}>
              <BandTitle eyebrow={t('landing.words.eyebrow')} title={t('landing.words.title')} text={t('landing.words.text')} />
              <Tick text={t('landing.words.pointAuto')} />
              <Tick text={t('landing.words.pointLanguage')} />
              <Tick text={t('landing.words.pointBoth')} />
            </View>
            <View style={[styles.wordCards, !wide && styles.noFlex]}>
              {WORDS.map((key, i) => (
                <View key={key} style={[styles.wordCard, wide && { marginLeft: i * 28 }]}>
                  <Text style={styles.wordHow}>{t(`landing.words.${key}How`)}</Text>
                  <Text style={styles.wordIs}>{t(`landing.words.${key}Word`)}</Text>
                  <Text style={styles.wordAlso}>{t(`landing.words.${key}Also`)}</Text>
                </View>
              ))}
            </View>
          </View>
        </Band>

        {/* Features */}
        <Band tone="tint" onLayout={mark('features')} narrow={narrow}>
          <BandTitle centre eyebrow={t('landing.features.eyebrow')} title={t('landing.features.title')} text={t('landing.features.text')} />
          <View style={styles.grid}>
            {FEATURES.map(({ key, icon: FeatureIcon }) => (
              <View key={key} style={styles.feature}>
                <View style={styles.featureIcon}><FeatureIcon color={colors.relation} size={24} /></View>
                <Text style={styles.h3}>{t(`landing.features.${key}Title`)}</Text>
                <Text style={styles.body}>{t(`landing.features.${key}Text`)}</Text>
              </View>
            ))}
          </View>
        </Band>

        {/* How it works */}
        <Band onLayout={mark('how')} narrow={narrow}>
          <BandTitle centre eyebrow={t('landing.how.eyebrow')} title={t('landing.how.title')} />
          <View style={styles.grid}>
            {STEPS.map((key, i) => (
              <View key={key} style={styles.step}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{i + 1}</Text></View>
                <Text style={styles.h3}>{t(`landing.how.${key}Title`)}</Text>
                <Text style={styles.body}>{t(`landing.how.${key}Text`)}</Text>
              </View>
            ))}
          </View>
        </Band>

        {/* Elders, and privacy: two panels side by side on a computer. */}
        <Band tone="warm" narrow={narrow}>
          <View style={[styles.pair, !wide && styles.splitStack]}>
            <View style={[styles.panel, styles.panelDark, !wide && styles.noFlex]}>
              <View style={styles.panelIcon}><MicIcon color={colors.logoYellow} size={26} /></View>
              <BandTitle onDark eyebrow={t('landing.elders.eyebrow')} title={t('landing.elders.title')} text={t('landing.elders.text')} />
              {ELDER_POINTS.map((key) => <Tick key={key} onDark text={t(`landing.elders.${key}`)} />)}
            </View>
            <View style={[styles.panel, !wide && styles.noFlex]}>
              <View style={[styles.panelIcon, { backgroundColor: colors.tint }]}><ShieldIcon color={colors.relation} size={26} /></View>
              <BandTitle eyebrow={t('landing.safe.eyebrow')} title={t('landing.safe.title')} text={t('landing.safe.text')} />
              {SAFE_POINTS.map((key) => <Tick key={key} text={t(`landing.safe.${key}`)} />)}
            </View>
          </View>
        </Band>

        {/* Print */}
        <Band narrow={narrow}>
          <View style={[styles.split, !wide && styles.splitStack]}>
            <View style={[styles.splitWords, !wide && styles.noFlex]}>
              <BandTitle eyebrow={t('landing.print.eyebrow')} title={t('landing.print.title')} text={t('landing.print.text')} />
            </View>
            <View style={[styles.products, !wide && styles.noFlex]}>
              {(['tree_poster', 'family_book'] as const).map((product) => (
                <View key={product} style={styles.product}>
                  <ProductPicture product={product} />
                  <View style={styles.productWords}>
                    <Text style={styles.h3}>{t(`ops.shop.products.${product}`)}</Text>
                    <Text style={styles.body}>{t(`ops.shop.about.${product}`)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </Band>

        {/* Questions */}
        <Band tone="tint" onLayout={mark('questions')} narrow={narrow}>
          <BandTitle centre eyebrow={t('landing.questions.eyebrow')} title={t('landing.questions.title')} />
          <View style={styles.questions}>
            {QUESTIONS.map((q) => <Question key={q.id} group={q.group} id={q.id} />)}
            <Pressable accessibilityRole="link" onPress={() => router.push('/faq')} style={styles.allQuestions}>
              <Text style={styles.allQuestionsText}>{t('landing.questions.all')}</Text>
              <RightIcon color={colors.relation} size={18} />
            </Pressable>
          </View>
        </Band>

        {/* The last ask */}
        <Band tone="dark" narrow={narrow}>
          <BandTitle centre onDark eyebrow={t('landing.last.eyebrow')} title={t('landing.last.title')} text={t('landing.last.text')} />
          {storeButtons(true)}
          <View style={styles.centre}>{webButton(true)}</View>
        </Band>

        {/* Footer */}
        <View style={[styles.footer, narrow && styles.bandNarrow]}>
          <View style={[styles.inner, styles.footerInner]}>
            <LogoLink label={t('landing.toTop')} onPress={() => scroll.current?.scrollTo({ y: 0, animated: true })} style={styles.footerLogo} />
            <Text style={[styles.body, styles.textCentre]}>{t('welcome.subtitle')}</Text>
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
            <Text style={styles.small}>{t('landing.footer.rights')}</Text>
          </View>
        </View>
      </ScrollView>

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

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  grow: { flex: 1 },
  centre: { alignItems: 'center' },
  textCentre: { textAlign: 'center' },
  lift: { opacity: 0.9, transform: [{ translateY: -1 }] },
  onDarkQuiet: { color: colors.textOnDark },

  bar: { backgroundColor: colors.background, borderBottomWidth: 1, borderColor: colors.barEdge, alignItems: 'center' },
  barInner: { width: '100%', maxWidth: MAX_WIDTH + 64, height: BAR_HEIGHT, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 10 },
  barInnerNarrow: { paddingHorizontal: 16, gap: 8 },
  barLogo: { alignSelf: 'center' },
  barLinks: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  barLink: { minHeight: minTapSize, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12 },
  barLinkText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
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

  band: { paddingHorizontal: 32, paddingVertical: 72, alignItems: 'center' },
  bandNarrow: { paddingHorizontal: 16, paddingVertical: 48 },
  bandTint: { backgroundColor: colors.tint },
  bandWarm: { backgroundColor: colors.warmTint },
  bandDark: { backgroundColor: colors.logoIndigo },
  inner: { width: '100%', maxWidth: MAX_WIDTH, gap: 28 },
  bandTitle: { gap: 10, maxWidth: 680 },
  bandTitleCentre: { alignSelf: 'center', alignItems: 'center' },
  eyebrow: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase' },
  h2: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 32, lineHeight: 40, letterSpacing: -0.8 },
  h3: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18, lineHeight: 25 },
  lead: { color: colors.muted, fontFamily: fonts.medium, fontSize: 17, lineHeight: 27 },
  body: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23 },
  small: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  hero: { paddingHorizontal: 32, paddingTop: 48, paddingBottom: 72, alignItems: 'center', backgroundColor: colors.background, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 400 },
  blobOne: { width: 520, height: 520, right: -140, top: -160, backgroundColor: colors.tint },
  blobTwo: { width: 360, height: 360, left: -160, bottom: -180, backgroundColor: colors.warmTint },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 48 },
  heroStack: { flexDirection: 'column', alignItems: 'stretch', gap: 40 },
  heroWords: { flex: 1, gap: 18, alignItems: 'flex-start', minWidth: 0 },
  heroWordsStack: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  // Stacked in one column, a piece is as tall as what is in it.
  noFlex: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  badge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.celebrationTint, borderWidth: 1, borderColor: colors.warmBorder },
  badgeText: { color: colors.ask, fontFamily: fonts.bold, fontSize: 13 },
  h1: { color: colors.text, fontFamily: fonts.extrabold },
  h1Wide: { fontSize: 64, lineHeight: 70, letterSpacing: -2.4 },
  h1Mid: { fontSize: 52, lineHeight: 58, letterSpacing: -2 },
  h1Narrow: { fontSize: 40, lineHeight: 46, letterSpacing: -1.6 },
  heroLead: { color: colors.muted, fontFamily: fonts.medium, fontSize: 19, lineHeight: 30, maxWidth: 520 },
  heroLeadNarrow: { fontSize: 17, lineHeight: 26 },
  soonNote: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, maxWidth: 460 },
  facts: { gap: 8, marginTop: 6 },
  heroArt: { width: 480, alignItems: 'center', alignSelf: 'center' },
  heroArtNarrow: { width: '100%' },
  noteOne: { position: 'absolute', left: -78, top: 104 },
  noteTwo: { position: 'absolute', right: -78, top: 204 },

  stores: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  storesCentre: { justifyContent: 'center' },
  store: { minHeight: 60, minWidth: 168, paddingHorizontal: 20, paddingVertical: 9, borderRadius: radius.button, justifyContent: 'center' },
  storeLive: { backgroundColor: colors.text, cursor: 'pointer' },
  storeLiveOnDark: { backgroundColor: colors.white, cursor: 'pointer' },
  storeSoon: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.card },
  storeSoonOnDark: { borderColor: colors.glass, backgroundColor: colors.glass },
  storeSmall: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  storeName: { fontFamily: fonts.extrabold, fontSize: 18, lineHeight: 24 },
  web: { minHeight: 52, paddingHorizontal: 22, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', cursor: 'pointer' },
  webStrong: { backgroundColor: colors.logoIndigo },
  webStrongOnDark: { backgroundColor: colors.logoYellow, alignSelf: 'center' },
  webQuiet: { borderWidth: 1.5, borderColor: colors.logoIndigo },
  webQuietOnDark: { borderWidth: 1.5, borderColor: colors.white, alignSelf: 'center' },
  webText: { fontFamily: fonts.bold, fontSize: 16 },

  tick: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tickMark: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  tickText: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 23 },

  split: { flexDirection: 'row', alignItems: 'center', gap: 56 },
  splitStack: { flexDirection: 'column', alignItems: 'stretch', gap: 28 },
  splitWords: { flex: 1, gap: 12, minWidth: 0 },
  wordCards: { flex: 1, gap: 14, minWidth: 0 },
  wordCard: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 18, gap: 2, maxWidth: 400, ...shadows.card },
  wordHow: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  wordIs: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 32 },
  wordAlso: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  feature: { flexGrow: 1, flexBasis: 300, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 22, gap: 8, ...shadows.card },
  featureIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  step: { flexGrow: 1, flexBasis: 280, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 22, gap: 8 },
  stepNumber: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.logoYellow, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stepNumberText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20 },

  pair: { flexDirection: 'row', alignItems: 'stretch', gap: 20 },
  panel: { flex: 1, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.hero, borderWidth: 1, borderColor: colors.warmBorder, padding: 28, gap: 12, ...shadows.card },
  panelDark: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  panelIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },

  products: { flex: 1.2, flexDirection: 'row', flexWrap: 'wrap', gap: 16, minWidth: 0 },
  product: { flexGrow: 1, flexBasis: 220, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden', ...shadows.card },
  productWords: { padding: 16, gap: 4 },

  questions: { alignSelf: 'center', width: '100%', maxWidth: 760, gap: 10 },
  question: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 18 },
  questionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, cursor: 'pointer' },
  questionText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 16, lineHeight: 23 },
  answer: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 24, paddingBottom: 18 },
  allQuestions: { minHeight: minTapSize, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  allQuestionsText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 15 },

  footer: { paddingHorizontal: 32, paddingVertical: 40, alignItems: 'center', backgroundColor: colors.background, borderTopWidth: 1, borderColor: colors.barEdge },
  footerInner: { alignItems: 'center', gap: 12 },
  footerLogo: { alignSelf: 'center' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20 },
  footerLink: { minHeight: minTapSize, justifyContent: 'center' },
  footerLinkText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
});
