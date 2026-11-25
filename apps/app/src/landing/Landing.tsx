// The website's front page. It says what AYWO is, sends people to the Android and iPhone apps, and keeps a way into
// the web app ("Continue on the web"). The store links come from Admin > App settings > App store links; while a
// link is empty that app shows as "Coming soon". Everything here is public: no account, no family data.
// The look: a deep indigo opening with a drawn phone, a wall of relationship words, and a feature explorer where
// tapping a name changes the panel beside it.
import { Float } from '@/components/Motion';
import { pricesFor } from '@aywo/shared';
import { getCalendars } from 'expo-localization';
import { useRouter } from '@/lib/router';
import { useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { MicIcon, RightIcon, ShieldIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';
import { FloatingNote, PhoneMock } from './art';
import { FEATURES, Question, QUESTIONS, StoreButton, Tick } from './parts';
import { ProductPicture } from '@/ops/ProductPicture';
import { LandingBar, LandingFooter, useFrontDoor, WebButton } from './shared';
import { useProductWords } from '@/ops/productWords';

const STEPS = ['one', 'two', 'three'] as const;
const BAR_HEIGHT = 64;
type SectionId = 'features' | 'how' | 'price' | 'questions';
const FREE = ['one', 'two', 'three', 'four', 'five'] as const;
const PLUS = ['pay.benefitCall', 'pay.benefitChat', 'pay.benefitReact', 'pay.oneFamily'] as const;
// A visitor in India sees rupees, everyone else US dollars: the same two price lists the Plus page charges from.
const INDIA_ZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);
// How each word on the wall looks, in turn: size and colours.
const WORD_LOOKS = [
  { size: 30, box: colors.logoIndigo, ink: colors.white },
  { size: 20, box: colors.card, ink: colors.relation },
  { size: 24, box: colors.celebrationTint, ink: colors.ask },
  { size: 34, box: colors.card, ink: colors.text },
  { size: 20, box: colors.tintDeep, ink: colors.logoIndigo },
  { size: 26, box: colors.logoYellow, ink: colors.text },
] as const;

export function Landing() {
  const { t } = useTranslation();
  const productWords = useProductWords();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const narrow = width < 640;
  const door = useFrontDoor();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const toTop = () => scroll.current?.scrollTo({ y: 0, animated: true });
  // The top bar's links scroll to their part of the page.
  const tops = useRef<Partial<Record<SectionId, number>>>({});
  const mark = (id: SectionId) => (e: LayoutChangeEvent) => {
    tops.current[id] = e.nativeEvent.layout.y;
  };
  const go = (id: SectionId) => scroll.current?.scrollTo({ y: Math.max(0, (tops.current[id] ?? 0) - BAR_HEIGHT), animated: true });
  const links = (['features', 'how', 'price', 'questions'] as const).map((id) => ({ label: t(`landing.nav.${id}`), onPress: () => go(id) }));
  const pad = narrow ? styles.padNarrow : null;
  const [shown, setShown] = useState(0);
  const feature = FEATURES[shown];
  const ShownIcon = feature.icon;
  // "Across years," stays white and "we're one." turns gold.
  const [first, ...rest] = t('welcome.title').split('\n');
  const india = INDIA_ZONES.has(getCalendars()[0]?.timeZone ?? '');
  const prices = pricesFor(india ? 'razorpay' : 'stripe');
  // Plus is bought inside the app: signed in goes straight to it, a visitor signs in first.
  const openPlus = () => (door.signedIn ? router.push('/plus') : door.openWeb());
  const cloud = t('landing.words.cloud').split(',').map((word) => word.trim()).filter(Boolean);

  return (
    <View style={styles.page}>
      <ScrollView ref={scroll} style={styles.page} stickyHeaderIndices={[0]}>
        <LandingBar door={door} narrow={narrow} onTop={toTop} links={wide ? links : undefined} />

        {/* Opening: indigo, words on one side and the phone on the other */}
        <View style={[styles.hero, pad]}>
          <View style={[styles.ring, styles.ringOne]} />
          <View style={[styles.ring, styles.ringTwo]} />
          <View style={[styles.inner, styles.heroRow, !wide && styles.stack]}>
            <View style={[styles.heroWords, !wide && styles.heroWordsStack]}>
              <View style={styles.badge}><Text style={styles.badgeText}>{t('landing.hero.badge')}</Text></View>
              <Text accessibilityRole="header" style={[styles.h1, wide ? styles.h1Wide : narrow ? styles.h1Narrow : styles.h1Mid, !wide && styles.textCentre]}>
                {first}
                {rest.length ? <Text style={styles.gold}>{`\n${rest.join('\n')}`}</Text> : null}
              </Text>
              <Text style={[styles.heroLead, narrow && styles.heroLeadNarrow, !wide && styles.textCentre]}>{t('landing.hero.lead')}</Text>
              <View style={[styles.stores, !wide && styles.storesCentre]}>
                <StoreButton platform="android" link={door.android} onDark />
                <StoreButton platform="ios" link={door.ios} onDark />
              </View>
              <View style={wide ? styles.start : styles.centre}>
                <WebButton door={door} tone={door.anyStore ? 'outlineOnDark' : 'yellow'} />
              </View>
              {door.anyStore ? null : <Text style={[styles.soonNote, !wide && styles.textCentre]}>{t('landing.hero.soonNote')}</Text>}
            </View>
            <View style={[styles.heroArt, narrow && styles.heroArtNarrow]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.glow} />
              {/* The phone and its two notes drift slowly, out of step with each other. */}
              <Float by={6} duration={4200}>
                <PhoneMock />
              </Float>
              {wide ? (
                <>
                  <FloatingNote icon="calendar" title={t('landing.art.noteBirthdayTitle')} text={t('landing.art.noteBirthdayText')} style={styles.noteOne} />
                  <FloatingNote icon="photo" title={t('landing.art.noteMemoryTitle')} text={t('landing.art.noteMemoryText')} style={styles.noteTwo} />
                </>
              ) : null}
            </View>
          </View>
        </View>

        {/* The three promises, on a card that sits half over the opening */}
        <View style={[styles.promiseBand, narrow && styles.promiseBandNarrow]}>
          <View style={styles.promiseCard}>
            <View style={styles.promise}><Tick text={t('landing.hero.factFree')} /></View>
            <View style={styles.promise}><Tick text={t('landing.hero.factPrivate')} /></View>
            <View style={styles.promise}><Tick text={t('landing.hero.factAds')} /></View>
          </View>
        </View>

        {/* The wall of relationship words */}
        <View style={[styles.band, pad]}>
          <View style={[styles.inner, styles.split, !wide && styles.stack]}>
            <View style={[styles.side, !wide && styles.noFlex]}>
              <Text style={styles.eyebrow}>{t('landing.words.eyebrow')}</Text>
              <Text accessibilityRole="header" style={styles.h2}>{t('landing.words.title')}</Text>
              <Text style={styles.lead}>{t('landing.words.text')}</Text>
              <Tick text={t('landing.words.pointAuto')} />
              <Tick text={t('landing.words.pointLanguage')} />
            </View>
            <View style={[styles.wall, !wide && styles.noFlex]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {cloud.map((word, i) => {
                const look = WORD_LOOKS[i % WORD_LOOKS.length];
                const size = narrow ? Math.round(look.size * 0.8) : look.size;
                return (
                  <View key={word} style={[styles.wallWord, { backgroundColor: look.box, transform: [{ rotate: `${(i % 3) - 1}deg` }] }]}>
                    <Text style={{ color: look.ink, fontFamily: fonts.extrabold, fontSize: size, lineHeight: Math.round(size * 1.4) }}>{word}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Feature explorer: tap a name, the panel changes */}
        <View onLayout={mark('features')} style={[styles.band, styles.bandTint, pad]}>
          <View style={styles.inner}>
            <View style={styles.titleCentre}>
              <Text style={styles.eyebrow}>{t('landing.features.eyebrow')}</Text>
              <Text accessibilityRole="header" style={[styles.h2, styles.textCentre]}>{t('landing.features.title')}</Text>
              <Text style={[styles.lead, styles.textCentre]}>{t('landing.features.text')}</Text>
            </View>
            <View style={[styles.explorer, !wide && styles.stack]}>
              <View accessibilityRole="tablist" style={[styles.tabs, !wide && styles.tabsWrap]}>
                {FEATURES.map(({ key, icon: TabIcon }, i) => {
                  const on = shown === i;
                  return (
                    <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setShown(i)} style={[styles.tab, !wide && styles.tabChip, on && styles.tabOn]}>
                      <TabIcon color={on ? colors.logoYellow : colors.relation} size={20} />
                      <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(`landing.features.${key}Title`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={[styles.panel, !wide && styles.noFlex]} accessibilityLiveRegion="polite">
                <View style={styles.panelIcon}><ShownIcon color={colors.logoYellow} size={44} /></View>
                <Text style={styles.panelTitle}>{t(`landing.features.${feature.key}Title`)}</Text>
                <Text style={styles.panelText}>{t(`landing.features.${feature.key}Text`)}</Text>
                <Text style={styles.panelCount}>{`${shown + 1} / ${FEATURES.length}`}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Steps with big numbers */}
        <View onLayout={mark('how')} style={[styles.band, pad]}>
          <View style={styles.inner}>
            <View style={styles.titleCentre}>
              <Text style={styles.eyebrow}>{t('landing.how.eyebrow')}</Text>
              <Text accessibilityRole="header" style={[styles.h2, styles.textCentre]}>{t('landing.how.title')}</Text>
            </View>
            <View style={styles.steps}>
              {STEPS.map((key, i) => (
                <View key={key} style={styles.step}>
                  <Text style={styles.stepNumber}>{`0${i + 1}`}</Text>
                  <View style={styles.stepBar} />
                  <Text style={styles.h3}>{t(`landing.how.${key}Title`)}</Text>
                  <Text style={styles.body}>{t(`landing.how.${key}Text`)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Price: what is free, and what Plus adds */}
        <View onLayout={mark('price')} style={[styles.band, styles.bandTint, pad]}>
          <View style={styles.inner}>
            <View style={styles.titleCentre}>
              <Text style={styles.eyebrow}>{t('landing.price.eyebrow')}</Text>
              <Text accessibilityRole="header" style={[styles.h2, styles.textCentre]}>{t('landing.price.title')}</Text>
            </View>
            <View style={[styles.pair, !wide && styles.stack]}>
              <View style={[styles.plan, !wide && styles.noFlex]}>
                <Text style={styles.planName}>{t('landing.price.freeName')}</Text>
                <View style={styles.planPriceRow}>
                  <Text style={styles.planPrice}>{india ? '₹0' : '$0'}</Text>
                  <Text style={styles.planPer}>{t('landing.price.forAlways')}</Text>
                </View>
                {FREE.map((key) => <Tick key={key} text={t(`landing.price.free.${key}`)} />)}
                <View style={styles.grow} />
                <Pressable accessibilityRole="link" onPress={door.openWeb} style={({ hovered }: { hovered?: boolean }) => [styles.planButton, styles.planButtonQuiet, hovered && styles.lift]}>
                  <Text style={[styles.planButtonText, { color: colors.logoIndigo }]}>{t('landing.price.startFree')}</Text>
                </Pressable>
              </View>
              <View style={[styles.plan, styles.planPlus, !wide && styles.noFlex]}>
                <View style={styles.planTag}><Text style={styles.planTagText}>{t('pay.firstTwoFree')}</Text></View>
                <Text style={styles.planName}>{t('landing.price.plusName')}</Text>
                <View style={styles.planPriceRow}>
                  <Text style={styles.planPrice}>{prices.monthly.display}</Text>
                  <Text style={styles.planPer}>{t('landing.price.perMonthOrYear', { yearly: prices.yearly.display })}</Text>
                </View>
                <Tick text={t('landing.price.plusAll')} />
                {PLUS.map((key) => <Tick key={key} text={t(key)} />)}
                <View style={styles.grow} />
                <Pressable accessibilityRole="link" onPress={openPlus} style={({ hovered }: { hovered?: boolean }) => [styles.planButton, styles.planButtonGold, hovered && styles.lift]}>
                  <Text style={[styles.planButtonText, { color: colors.text }]}>{t('pay.startFree')}</Text>
                </Pressable>
                <Text style={styles.planNote}>{t('landing.price.cancel')}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Elders and privacy */}
        <View style={[styles.band, styles.bandWarm, pad]}>
          <View style={[styles.inner, styles.pair, !wide && styles.stack]}>
            <View style={[styles.box, styles.boxDark, !wide && styles.noFlex]}>
              <View style={styles.boxIcon}><MicIcon color={colors.logoYellow} size={26} /></View>
              <Text style={[styles.eyebrow, { color: colors.logoYellow }]}>{t('landing.elders.eyebrow')}</Text>
              <Text accessibilityRole="header" style={[styles.h2, { color: colors.white }]}>{t('landing.elders.title')}</Text>
              <Text style={[styles.lead, { color: colors.textOnDark }]}>{t('landing.elders.text')}</Text>
              {(['big', 'simple', 'voice'] as const).map((key) => <Tick key={key} onDark text={t(`landing.elders.${key}`)} />)}
            </View>
            <View style={[styles.box, !wide && styles.noFlex]}>
              <View style={[styles.boxIcon, { backgroundColor: colors.tint }]}><ShieldIcon color={colors.relation} size={26} /></View>
              <Text style={styles.eyebrow}>{t('landing.safe.eyebrow')}</Text>
              <Text accessibilityRole="header" style={styles.h2}>{t('landing.safe.title')}</Text>
              <Text style={styles.lead}>{t('landing.safe.text')}</Text>
              {(['private', 'number', 'ads', 'remove'] as const).map((key) => <Tick key={key} text={t(`landing.safe.${key}`)} />)}
            </View>
          </View>
        </View>

        {/* Poster and book */}
        <View style={[styles.band, styles.bandTint, pad]}>
          <View style={[styles.inner, styles.split, !wide && styles.stack]}>
            <View style={[styles.side, !wide && styles.noFlex]}>
              <Text style={styles.eyebrow}>{t('landing.print.eyebrow')}</Text>
              <Text accessibilityRole="header" style={styles.h2}>{t('landing.print.title')}</Text>
              <Text style={styles.lead}>{t('landing.print.text')}</Text>
            </View>
            <View style={[styles.products, !wide && styles.noFlex]}>
              {(['tree_poster', 'family_book'] as const).map((product) => (
                <View key={product} style={styles.product}>
                  <ProductPicture product={product} />
                  <View style={styles.productWords}>
                    <Text style={styles.h3}>{productWords.name(product)}</Text>
                    <Text style={styles.body}>{productWords.about(product)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Questions */}
        <View onLayout={mark('questions')} style={[styles.band, pad]}>
          <View style={styles.inner}>
            <View style={styles.titleCentre}>
              <Text style={styles.eyebrow}>{t('landing.questions.eyebrow')}</Text>
              <Text accessibilityRole="header" style={[styles.h2, styles.textCentre]}>{t('landing.questions.title')}</Text>
            </View>
            <View style={styles.questions}>
              {QUESTIONS.map((q) => <Question key={q.id} group={q.group} id={q.id} />)}
              <Pressable accessibilityRole="link" onPress={() => router.push('/faq')} style={styles.allQuestions}>
                <Text style={styles.allQuestionsText}>{t('landing.questions.all')}</Text>
                <RightIcon color={colors.relation} size={18} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* The last ask: the opening's indigo and rings again */}
        <View style={[styles.hero, styles.last, pad]}>
          <View style={[styles.ring, styles.ringOne]} />
          <View style={[styles.inner, styles.centre]}>
            <Text style={styles.lastEyebrow}>{t('landing.last.eyebrow')}</Text>
            <Text accessibilityRole="header" style={[styles.h1, narrow ? styles.h1Narrow : styles.h1Mid, styles.textCentre]}>{t('landing.last.title')}</Text>
            <Text style={[styles.heroLead, styles.textCentre]}>{t('landing.last.text')}</Text>
            <View style={[styles.stores, styles.storesCentre]}>
              <StoreButton platform="android" link={door.android} onDark />
              <StoreButton platform="ios" link={door.ios} onDark />
            </View>
            <WebButton door={door} tone={door.anyStore ? 'outlineOnDark' : 'yellow'} />
          </View>
        </View>

        <LandingFooter onTop={toTop} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  centre: { alignItems: 'center' },
  start: { alignItems: 'flex-start' },
  textCentre: { textAlign: 'center' },
  noFlex: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  padNarrow: { paddingHorizontal: 16, paddingVertical: 48 },
  inner: { width: '100%', maxWidth: 1120, gap: 28 },
  stack: { flexDirection: 'column', alignItems: 'stretch', gap: 32 },

  hero: { backgroundColor: colors.logoIndigo, paddingHorizontal: 32, paddingTop: 64, paddingBottom: 120, alignItems: 'center', overflow: 'hidden' },
  ring: { position: 'absolute', borderRadius: 800, borderWidth: 1, borderColor: colors.glass },
  ringOne: { width: 900, height: 900, top: -420, right: -260 },
  ringTwo: { width: 1500, height: 1500, top: -700, right: -560 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 48 },
  heroWords: { flex: 1, minWidth: 0, gap: 18, alignItems: 'flex-start' },
  heroWordsStack: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', alignItems: 'center' },
  badge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.glass },
  badgeText: { color: colors.logoYellow, fontFamily: fonts.bold, fontSize: 13 },
  h1: { color: colors.white, fontFamily: fonts.extrabold },
  h1Wide: { fontSize: 68, lineHeight: 74, letterSpacing: -2.6 },
  h1Mid: { fontSize: 52, lineHeight: 58, letterSpacing: -2 },
  h1Narrow: { fontSize: 40, lineHeight: 46, letterSpacing: -1.6 },
  gold: { color: colors.logoYellow },
  heroLead: { color: colors.textOnDark, fontFamily: fonts.medium, fontSize: 19, lineHeight: 30, maxWidth: 540 },
  heroLeadNarrow: { fontSize: 17, lineHeight: 26 },
  stores: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  storesCentre: { justifyContent: 'center' },
  soonNote: { color: colors.textOnDark, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, maxWidth: 480 },
  heroArt: { width: 480, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  heroArtNarrow: { width: '100%' },
  glow: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: colors.glass },
  noteOne: { position: 'absolute', left: -60, top: 104 },
  noteTwo: { position: 'absolute', right: -60, top: 204 },

  promiseBand: { paddingHorizontal: 32, alignItems: 'center', marginTop: -52 },
  promiseBandNarrow: { paddingHorizontal: 16 },
  promiseCard: { width: '100%', maxWidth: 1120, flexDirection: 'row', flexWrap: 'wrap', gap: 16, backgroundColor: colors.card, borderRadius: radius.hero, borderWidth: 1, borderColor: colors.cardBorder, paddingVertical: 24, paddingHorizontal: 24, ...shadows.raised },
  promise: { flexGrow: 1, flexBasis: 260, minWidth: 0 },

  band: { paddingHorizontal: 32, paddingVertical: 80, alignItems: 'center' },
  bandTint: { backgroundColor: colors.tint },
  bandWarm: { backgroundColor: colors.warmTint },
  split: { flexDirection: 'row', alignItems: 'center', gap: 56 },
  side: { flex: 1, minWidth: 0, gap: 12 },
  titleCentre: { alignItems: 'center', alignSelf: 'center', gap: 10, maxWidth: 680 },
  eyebrow: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase' },
  h2: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 42, letterSpacing: -0.9 },
  h3: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 27 },
  lead: { color: colors.muted, fontFamily: fonts.medium, fontSize: 17, lineHeight: 27 },
  body: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 23 },

  wall: { flex: 1.1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 },
  wallWord: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 26, borderWidth: 1, borderColor: colors.cardBorder, ...shadows.card },

  explorer: { flexDirection: 'row', alignItems: 'stretch', gap: 20 },
  tabs: { width: 320, gap: 8 },
  tabsWrap: { width: '100%', flexDirection: 'row', flexWrap: 'wrap' },
  tab: { minHeight: 56, paddingHorizontal: 18, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, cursor: 'pointer' },
  tabChip: { minHeight: minTapSize, paddingHorizontal: 14, borderRadius: 22 },
  tabOn: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  tabText: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, flexShrink: 1 },
  tabTextOn: { color: colors.white },
  panel: { flex: 1, minWidth: 0, minHeight: 300, backgroundColor: colors.logoIndigo, borderRadius: radius.hero, padding: 36, gap: 14, justifyContent: 'center', ...shadows.raised },
  panelIcon: { width: 88, height: 88, borderRadius: 28, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
  panelText: { color: colors.textOnDark, fontFamily: fonts.medium, fontSize: 18, lineHeight: 28, maxWidth: 560 },
  panelCount: { color: colors.logoYellow, fontFamily: fonts.bold, fontSize: 13 },

  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 28 },
  step: { flexGrow: 1, flexBasis: 280, minWidth: 0, gap: 8 },
  stepNumber: { color: colors.tintDeep, fontFamily: fonts.extrabold, fontSize: 84, lineHeight: 88, letterSpacing: -3 },
  stepBar: { width: 48, height: 5, borderRadius: 3, backgroundColor: colors.logoYellow, marginBottom: 6 },

  pair: { flexDirection: 'row', alignItems: 'stretch', gap: 20 },
  box: { flex: 1, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.hero, borderWidth: 1, borderColor: colors.warmBorder, padding: 28, gap: 12, ...shadows.card },
  boxDark: { backgroundColor: colors.logoIndigo, borderColor: colors.logoIndigo },
  boxIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },

  products: { flex: 1.2, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  product: { flexGrow: 1, flexBasis: 220, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden', ...shadows.card },
  productWords: { padding: 16, gap: 4 },

  grow: { flex: 1 },
  lift: { opacity: 0.9, transform: [{ translateY: -1 }] },
  plan: { flex: 1, minWidth: 0, backgroundColor: colors.card, borderRadius: radius.hero, borderWidth: 1, borderColor: colors.cardBorder, padding: 28, gap: 12, ...shadows.card },
  planPlus: { borderWidth: 2, borderColor: colors.logoIndigo },
  planTag: { position: 'absolute', top: -14, right: 24, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16, backgroundColor: colors.logoYellow },
  planTagText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 13 },
  planName: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 31 },
  planPriceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, marginBottom: 6 },
  planPrice: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 48, lineHeight: 56, letterSpacing: -1.6 },
  planPer: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 16 },
  planButton: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 10, cursor: 'pointer' },
  planButtonQuiet: { borderWidth: 1.5, borderColor: colors.logoIndigo, backgroundColor: colors.tint },
  planButtonGold: { backgroundColor: colors.logoYellow },
  planButtonText: { fontFamily: fonts.bold, fontSize: 16 },
  planNote: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  questions: { alignSelf: 'center', width: '100%', maxWidth: 760, gap: 10 },
  allQuestions: { minHeight: minTapSize, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  allQuestionsText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 15 },

  last: { paddingTop: 80, paddingBottom: 80 },
  lastEyebrow: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase' },
});
