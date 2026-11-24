// S-15 AYWO Plus (wireframe F3). Apps: Google Play and Apple billing. Web: Razorpay in India, Stripe overseas.
// Plus appears only when GET /plan says so, after the provider's signed webhook.
// A purchase waiting for that webhook is remembered on the device (pay/pending.ts), so leaving and coming back
// cannot lead to paying twice. Free Plus days (referrals, support) show as Plus with their end date, and nothing
// is sold while they run: the server would refuse it on the web, and a store purchase would go through for nothing.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Spinner } from '@/components/Loaders';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { BackButton, Loading, LoadFailed, PrimaryButton, TextButton, TopBar } from '@/components/ui';
import { api, deviceStore } from '@/lib/api';
import { clearPending, readPending, rememberPending } from '@/pay/pending';
import { buyStorePlan, loadStorePackages, restoreStorePurchases, storeAvailable } from '@/pay/store';
import { hasPlusNow, onBonusOnly, PLAN_KEY, PRODUCT_OF, payErrorText, usePlan } from '@/pay/usePlan';
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
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ checkout?: string; order?: string }>();
  // Old links: a paid shop order used to come back here. It belongs in My orders, not in front of a Plus offer.
  const shopReturn = params.order === 'success';
  const paidReturn = params.checkout === 'success';

  // Stripe sends people back here with checkout=success.
  const [waiting, setWaiting] = useState(paidReturn);
  // When the purchase being confirmed was made, and whether the device has been asked about one yet.
  const [since, setSince] = useState<number | null>(null);
  const [pendingChecked, setPendingChecked] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [period, setPeriod] = useState<PlanPeriod>('yearly');
  const [chosenMethod, setChosenMethod] = useState<WebMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const plan = usePlan(waiting);
  const data = plan.data;
  // A Razorpay plan cancelled on this phone still reads "renews" on the server until the period ends (see
  // family-plan.tsx, which leaves this mark). Without it this page would promise a payment that will not come.
  const [cancelledUntil, setCancelledUntil] = useState<{ profile: string; renews_at: string | null } | null>(null);
  useEffect(() => {
    void deviceStore
      .get('aywo.planCancelled')
      .then((saved) => (saved ? setCancelledUntil(JSON.parse(saved) as { profile: string; renews_at: string | null }) : undefined))
      .catch(() => undefined);
  }, []);

  const packages = useQuery({
    queryKey: ['store-packages', data?.profile_id],
    queryFn: () => loadStorePackages(data?.profile_id ?? ''),
    enabled: storeAvailable && !!data,
  });

  useEffect(() => {
    if (shopReturn) router.replace({ pathname: '/orders', params: { paid: '1' } });
  }, [shopReturn, router]);

  const profileId = data?.profile_id;
  const nowPlus = !!data?.plus;
  // A purchase made earlier and not confirmed yet: carry on waiting for it instead of offering to sell again.
  useEffect(() => {
    if (!profileId) return;
    let live = true;
    void (async () => {
      if (nowPlus) {
        await clearPending();
      } else {
        const saved = await readPending(profileId);
        const at = saved ?? (paidReturn ? await rememberPending(profileId).catch(() => Date.now()) : null);
        if (live && at !== null) {
          setSince(at);
          setWaiting(true);
        }
      }
      if (live) setPendingChecked(true);
    })();
    return () => {
      live = false;
    };
  }, [profileId, nowPlus, paidReturn]);

  useEffect(() => {
    if (waiting && nowPlus) router.replace('/family-plan');
  }, [waiting, nowPlus, router]);

  useEffect(() => {
    if (!waiting) return;
    const left = Math.max(0, CONFIRM_TIMEOUT_MS - (Date.now() - (since ?? Date.now())));
    const timer = setTimeout(() => setTimedOut(true), left);
    return () => clearTimeout(timer);
  }, [waiting, since]);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  if (plan.isError && !data) {
    // With the shared top bar there is a way out even when the page cannot load.
    return (
      <Screen>
        <TopBar title={t('pay.kicker')} onBack={close} close />
        <LoadFailed message={payErrorText(t, plan.error)} onRetry={() => plan.refetch()} />
      </Screen>
    );
  }
  if (!data || !pendingChecked || shopReturn) {
    return (
      <Screen>
        <Loading label={t('pay.loading')} />
      </Screen>
    );
  }

  const webMethods = data.web_methods.filter((m) => m !== 'apple_pay' || (isWeb && applePayPossible()));
  const method = chosenMethod ?? webMethods[0] ?? null;

  const storePrice = storeAvailable ? packages.data : undefined;
  // In the apps the store's own price is the one charged. Until the store has answered, a dash is shown, not the
  // website's price: that one could differ, and the person would see the number change under their thumb.
  const storeLoading = storeAvailable && packages.isPending;
  const yearlyPrice = storeLoading ? '…' : (storePrice?.yearly?.price ?? data.prices.yearly.display);
  const monthlyPrice = storeLoading ? '…' : (storePrice?.monthly?.price ?? data.prices.monthly.display);
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
    setSince(Date.now());
    setWaiting(true);
    if (data) void rememberPending(data.profile_id).catch(() => undefined);
    queryClient.invalidateQueries({ queryKey: PLAN_KEY });
  }

  const bonus = onBonusOnly(data);
  const bonusDate = data.bonus_until
    ? new Date(data.bonus_until).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  // Someone who already has Plus is told what their plan is, in words, instead of only "You already have Plus".
  const day = (value: string | null) => (value ? new Date(value).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const yearlyNow = data.product_id === 'aywo_plus_yearly';
  const priceNow = yearlyNow ? yearlyPrice : monthlyPrice;
  const payerName = data.members.find((m) => m.is_payer)?.display_name ?? '';
  const cancelledHere = !!cancelledUntil && data.store === 'razorpay' && cancelledUntil.profile === data.profile_id && cancelledUntil.renews_at === data.renews_at;
  const nowLine = !data.is_payer
    ? payerName
      ? t('pay.now.member', { name: payerName })
      : t('pay.now.memberNoName')
    : data.status === 'trial'
      ? t(yearlyNow ? 'pay.now.trialYearly' : 'pay.now.trialMonthly', { date: day(data.trial_ends_at), price: priceNow })
      : data.status === 'grace'
        ? t('pay.family.paymentProblem')
        : data.will_renew && !cancelledHere
          ? t(yearlyNow ? 'pay.now.yearly' : 'pay.now.monthly', { price: priceNow, date: day(data.renews_at) })
          : t('pay.now.ending', { date: day(data.renews_at) });

  return (
    <Screen flush>
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.kicker}>{t('pay.kicker')}</Text>
            <BackButton close onPress={close} />
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
              <Text style={styles.sectionTitle}>{t('pay.now.title')}</Text>
              <Text style={styles.nowLine}>{nowLine}</Text>
              <Text style={styles.freeNote}>{t('pay.now.manageHint')}</Text>
              <PrimaryButton label={t('pay.seeFamilyPlan')} onPress={() => router.replace('/family-plan')} />
            </>
          ) : bonus ? (
            <>
              <Text style={styles.sectionTitle}>{t('pay.bonus.title', { date: bonusDate })}</Text>
              <Text style={styles.freeNote}>{t('pay.bonus.why')}</Text>
              <Text style={styles.freeNote}>{t('pay.bonus.noBuy', { date: bonusDate })}</Text>
              <PrimaryButton label={t('pay.close')} onPress={close} />
            </>
          ) : waiting ? (
            <View style={styles.waiting} accessibilityLiveRegion="polite">
              {timedOut ? null : <Spinner />}
              <Text style={styles.sectionTitle}>{timedOut ? t('pay.confirmSlowTitle') : t('pay.confirming')}</Text>
              {timedOut ? (
                <>
                  <Text style={styles.freeNote}>{t('pay.confirmSlow')}</Text>
                  <Text style={styles.freeNote}>{t('pay.pendingWhy')}</Text>
                  <TextButton label={plan.isFetching ? t('pay.pleaseWait') : t('pay.checkAgain')} disabled={plan.isFetching} onPress={() => void plan.refetch()} />
                  <TextButton label={t('pay.pendingHelp')} onPress={() => router.push('/help')} />
                </>
              ) : null}
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
                      accessibilityState={{ checked: method === m }}
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

          {!isWeb && !hasPlusNow(data) && !waiting ? (
            <TextButton label={t('pay.restore')} onPress={() => void restore()} disabled={busy} />
          ) : null}

          <View style={styles.legal}>
            <TextButton label={t('legal.termsLink')} onPress={() => router.push('/terms')} />
            <TextButton label={t('legal.privacyLink')} onPress={() => router.push('/privacy')} />
            <TextButton label={t('legal.refundsLink')} onPress={() => router.push('/refunds')} />
          </View>
        </View>
      </ScrollView>
    </Screen>
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
      accessibilityState={{ checked: props.selected }}
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
  // Screen keeps the page clear of the phone's status bar and home bar; this is the room below the last link.
  scroll: { flexGrow: 1, paddingBottom: 22 },
  nowLine: { color: colors.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 },

  hero: { borderBottomLeftRadius: 34, borderBottomRightRadius: 34, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22, gap: 12 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 1.5 },
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
