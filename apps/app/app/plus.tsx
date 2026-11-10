// S-15 AYWO Plus (wireframe F3). Apps: Google Play and Apple billing. Web: Razorpay in India, Stripe overseas.
// Plus appears only when GET /plan says so, after the provider's signed webhook.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PageLoader, Spinner } from '@/components/Loaders';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/components/Text';
import { PrimaryButton } from '@/components/ui';
import { api } from '@/lib/api';
import { buyStorePlan, loadStorePackages, restoreStorePurchases, storeAvailable } from '@/pay/store';
import { PLAN_KEY, PRODUCT_OF, payErrorText, usePlan } from '@/pay/usePlan';
import type { PlanPeriod, WebMethod } from '@/pay/usePlan';
import { applePayPossible, goToHostedPage, openRazorpay } from '@/pay/webCheckout';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const CONFIRM_TIMEOUT_MS = 90_000;
const isWeb = Platform.OS === 'web';

const BENEFITS = [
  { key: 'pay.benefitCall', path: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2' },
  { key: 'pay.benefitChat', path: 'M4 4h16v12H8l-4 4z' },
  { key: 'pay.benefitReact', path: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z' },
];

export default function Plus() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ checkout?: string }>();

  // Stripe sends people back here with checkout=success.
  const [waiting, setWaiting] = useState(params.checkout === 'success');
  const [timedOut, setTimedOut] = useState(false);
  const [period, setPeriod] = useState<PlanPeriod>('yearly');
  const [chosenMethod, setChosenMethod] = useState<WebMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const plan = usePlan(waiting);
  const data = plan.data;

  const packages = useQuery({
    queryKey: ['store-packages', data?.profile_id],
    queryFn: () => loadStorePackages(data?.profile_id ?? ''),
    enabled: storeAvailable && !!data,
  });

  const nowPlus = !!data?.plus;
  useEffect(() => {
    if (waiting && nowPlus) router.replace('/family-plan');
  }, [waiting, nowPlus, router]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setTimedOut(true), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  if (plan.isError && !data) {
    return (
      <View style={styles.centre}>
        <Text style={styles.message}>{payErrorText(t, plan.error)}</Text>
        <Pressable accessibilityRole="button" onPress={() => plan.refetch()} style={styles.textButton}>
          <Text style={styles.link}>{t('pay.tryAgain')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.centre}>
        <PageLoader label={t('pay.loading')} />
      </View>
    );
  }

  const webMethods = data.web_methods.filter((m) => m !== 'apple_pay' || (isWeb && applePayPossible()));
  const method = chosenMethod ?? webMethods[0] ?? null;

  const storePrice = storeAvailable ? packages.data : undefined;
  const yearlyPrice = storePrice?.yearly?.price ?? data.prices.yearly.display;
  const monthlyPrice = storePrice?.monthly?.price ?? data.prices.monthly.display;
  const trial = storeAvailable ? !!storePrice?.yearly?.freeTrial : data.trial_eligible;
  const showTrial = period === 'yearly' && trial;

  const action = showTrial
    ? t('pay.startFree')
    : period === 'yearly'
      ? t('pay.payYearly', { price: yearlyPrice })
      : t('pay.payMonthly', { price: monthlyPrice });
  const small = showTrial
    ? t('pay.thenYearly', { price: yearlyPrice })
    : period === 'yearly'
      ? t('pay.renewsYearly')
      : t('pay.renewsMonthly');

  async function buy() {
    if (!data) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    try {
      if (!isWeb) {
        if ((await buyStorePlan(period, data.profile_id)) === 'bought') startWaiting();
      } else if (data.provider === 'razorpay') {
        const started = await api.post<{ subscription_id: string; key_id: string }>('/pay/razorpay/subscribe', {
          product_id: PRODUCT_OF[period],
        });
        const result = await openRazorpay({
          keyId: started.key_id,
          subscriptionId: started.subscription_id,
          description: period === 'yearly' ? t('pay.yearlyName') : t('pay.monthlyName'),
          method: method ?? undefined,
          methodLabel: method ? t(`pay.method.${method}`) : '',
        });
        if (result === 'paid') startWaiting();
      } else {
        const { url } = await api.post<{ url: string }>('/pay/stripe/checkout', { product_id: PRODUCT_OF[period] });
        goToHostedPage(url);
      }
    } catch (e) {
      setProblem(payErrorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!data) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    try {
      if (await restoreStorePurchases(data.profile_id)) startWaiting();
      else setNote(t('pay.restoreNothing'));
    } catch (e) {
      setProblem(payErrorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  function startWaiting() {
    setTimedOut(false);
    setWaiting(true);
    queryClient.invalidateQueries({ queryKey: PLAN_KEY });
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 22 }]}>
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + 16 }]}>
          <View style={styles.heroTop}>
            <Text style={styles.kicker}>{t('pay.kicker')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('pay.close')} onPress={close} style={styles.close}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={2.2}>
                <Path d="M6 6l12 12M18 6L6 18" />
              </Svg>
            </Pressable>
          </View>
          <Text style={styles.title} accessibilityRole="header">{t('pay.title')}</Text>
          <View style={styles.benefits}>
            {BENEFITS.map((benefit) => (
              <View key={benefit.key} style={styles.benefit}>
                <View style={styles.benefitIcon}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.logoYellow} strokeWidth={2}>
                    <Path d={benefit.path} />
                  </Svg>
                </View>
                <Text style={styles.benefitText}>{t(benefit.key)}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={styles.body}>
          {data.plus ? (
            <>
              <Text style={styles.sectionTitle}>{t('pay.alreadyPlus')}</Text>
              <PrimaryButton label={t('pay.seeFamilyPlan')} onPress={() => router.replace('/family-plan')} />
            </>
          ) : waiting ? (
            <View style={styles.waiting} accessibilityLiveRegion="polite">
              {timedOut ? null : <Spinner />}
              <Text style={styles.sectionTitle}>{timedOut ? t('pay.confirmSlowTitle') : t('pay.confirming')}</Text>
              {timedOut ? <Text style={styles.freeNote}>{t('pay.confirmSlow')}</Text> : null}
            </View>
          ) : (
            <>
              <Text style={styles.sectionTitle}>{t('pay.oneFamily')}</Text>

              <PlanOption
                selected={period === 'yearly'}
                onPress={() => setPeriod('yearly')}
                title={t('pay.yearlyPrice', { price: yearlyPrice })}
                detail={trial ? t('pay.firstTwoFree') : t('pay.startsToday')}
                highlightDetail={trial}
                badge={t('pay.bestValue')}
              />
              <PlanOption
                selected={period === 'monthly'}
                onPress={() => setPeriod('monthly')}
                title={t('pay.monthlyPrice', { price: monthlyPrice })}
                detail={t('pay.startsToday')}
              />

              <Text style={styles.freeNote}>{t('pay.alwaysFree')}</Text>

              {isWeb && webMethods.length > 1 ? (
                <View style={styles.methods} accessibilityRole="radiogroup" accessibilityLabel={t('pay.payWith')}>
                  {webMethods.map((m) => (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: method === m }}
                      onPress={() => setChosenMethod(m)}
                      style={[styles.methodChip, method === m && styles.methodChipOn]}
                    >
                      <Text style={styles.methodText}>{t(`pay.method.${m}`)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {problem ? <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text> : null}
              {note ? <Text style={styles.freeNote} accessibilityLiveRegion="polite">{note}</Text> : null}

              <View style={styles.action}>
                <PrimaryButton label={busy ? t('pay.pleaseWait') : action} onPress={buy} disabled={busy} />
              </View>
              <Text style={styles.small}>{small}</Text>
            </>
          )}

          {!isWeb && !data.plus ? (
            <Pressable accessibilityRole="button" onPress={restore} disabled={busy} style={styles.textButton}>
              <Text style={styles.link}>{t('pay.restore')}</Text>
            </Pressable>
          ) : null}

          <View style={styles.legal}>
            <Pressable accessibilityRole="link" onPress={() => router.push('/terms')} style={styles.textButton}>
              <Text style={styles.link}>{t('legal.termsLink')}</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')} style={styles.textButton}>
              <Text style={styles.link}>{t('legal.privacyLink')}</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => router.push('/refunds')} style={styles.textButton}>
              <Text style={styles.link}>{t('legal.refundsLink')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function PlanOption(props: {
  selected: boolean;
  onPress: () => void;
  title: string;
  detail: string;
  highlightDetail?: boolean;
  badge?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={[styles.plan, props.selected && styles.planOn]}
    >
      <View style={[styles.dot, props.selected && styles.dotOn]} />
      <View style={styles.planWords}>
        <Text style={styles.planTitle}>{props.title}</Text>
        <Text style={[styles.planDetail, props.highlightDetail && styles.planDetailHighlight]}>{props.detail}</Text>
      </View>
      {props.badge ? (
        <LinearGradient colors={gradients.highlight} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
          <Text style={styles.badgeText}>{props.badge}</Text>
        </LinearGradient>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background, gap: 12 },
  message: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  textButton: { minHeight: minTapSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  link: { color: colors.logoPurple, fontFamily: fonts.bold, fontSize: 13, textDecorationLine: 'underline' },

  hero: { borderBottomLeftRadius: 34, borderBottomRightRadius: 34, paddingHorizontal: 20, paddingBottom: 22, gap: 12 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 1.5 },
  close: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
  benefits: { gap: 9 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 14 },

  body: { flex: 1, paddingHorizontal: 20, paddingTop: 18, gap: 10 },
  sectionTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  waiting: { alignItems: 'center', gap: 12, paddingVertical: 24 },

  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTapSize,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  planOn: { borderWidth: 2, borderColor: colors.logoPurple },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.cardBorder },
  dotOn: { borderWidth: 7, borderColor: colors.logoPurple },
  planWords: { flex: 1 },
  planTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  planDetail: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  planDetailHighlight: { color: colors.relation, fontFamily: fonts.bold },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 11 },

  freeNote: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: {
    minHeight: minTapSize,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodChipOn: { borderWidth: 2, borderColor: colors.logoPurple },
  methodText: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  problem: { color: colors.alert, fontFamily: fonts.semibold, fontSize: 13 },
  action: { marginTop: 'auto', paddingTop: 10 },
  small: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center' },
  legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
});
