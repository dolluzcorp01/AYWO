// My orders: posters, books and invites bought, with where each one is and its tracking link.
// Opened with ?paid=1 straight after paying (Stripe's return address, and the shop inside the apps): the list holds
// only orders the payment service has confirmed, so the screen thanks the person and keeps refreshing until the
// new order shows. &order=<id> names the order when the app knows it.
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, PrimaryButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/ops/types';
import type { MyOrder } from '@/ops/types';
import { Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

const STEPS = ['queued', 'printing', 'shipped', 'delivered'] as const;
const REFRESH_EVERY_MS = 3000;
const REFRESH_FOR_MS = 90_000;
const JUST_NOW_MS = 15 * 60_000;

/** Only real web links open. A tracking link is typed by staff, and anything else (tel:, javascript:, a file) is not one. */
function safeLink(url: string | null): string | null {
  return url && /^https:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
}

export default function MyOrders() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ paid?: string; order?: string }>();
  const justPaid = params.paid === '1';
  const [openedAt] = useState(() => Date.now());
  const [stopped, setStopped] = useState(false);
  const [linkFailed, setLinkFailed] = useState<string | null>(null);

  // The order just paid for is in the list: the named one, or else one paid in the last few minutes.
  const arrived = (list: MyOrder[] | undefined) =>
    !!list?.some((o) => (params.order ? o.id === params.order : !!o.paid_at && Math.abs(openedAt - new Date(o.paid_at).getTime()) < JUST_NOW_MS));

  const orders = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.rpc<MyOrder[]>('my_orders'),
    refetchInterval: (query) => (justPaid && !stopped && !arrived(query.state.data) ? REFRESH_EVERY_MS : false),
  });
  const confirmed = justPaid && arrived(orders.data);

  useEffect(() => {
    if (!justPaid) return;
    const timer = setTimeout(() => setStopped(true), REFRESH_FOR_MS);
    return () => clearTimeout(timer);
  }, [justPaid]);

  async function openTracking(id: string, url: string) {
    setLinkFailed(null);
    await Linking.openURL(url).catch(() => setLinkFailed(id));
  }

  return (
    <Page title={t('ops.orders.title')} subtitle={t('ops.orders.subtitle')}>
      {justPaid ? (
        <Card style={styles.paid}>
          <Text accessibilityRole="header" style={styles.title}>{t(confirmed ? 'ops.orders.paidTitle' : 'ops.shop.thanksTitle')}</Text>
          <View accessibilityLiveRegion="polite">
            <Note>{t(confirmed ? 'ops.orders.paidDone' : stopped ? 'ops.orders.paidSlow' : 'ops.orders.paidWaiting')}</Note>
          </View>
          {!confirmed && stopped ? (
            <>
              <TextButton
                label={orders.isFetching ? t('ops.orders.checking') : t('ops.orders.checkAgain')}
                disabled={orders.isFetching}
                onPress={() => void orders.refetch()}
              />
              <TextButton label={t('ops.orders.help')} onPress={() => router.push('/help')} />
            </>
          ) : null}
        </Card>
      ) : null}
      <Gate query={orders}>
        {(list) =>
          list.length === 0 ? (
            justPaid && !confirmed ? null : (
              <>
                <Note>{t('ops.orders.none')}</Note>
                <PrimaryButton label={t('ops.orders.shop')} onPress={() => router.push('/shop')} />
              </>
            )
          ) : (
            <View style={styles.list}>
              {list.map((o) => {
                const reached = STEPS.indexOf(o.fulfilment as (typeof STEPS)[number]);
                const trackingLink = safeLink(o.tracking_url);
                return (
                  <Card key={o.id} style={styles.order}>
                    <Text style={styles.title}>
                      {t(`ops.shop.products.${o.product}`)}
                      {o.quantity > 1 ? ` x ${o.quantity}` : ''}
                    </Text>
                    <Note>
                      {formatMoney(o.amount_minor, o.currency, i18n.language)} · {new Date(o.created_at).toLocaleDateString(i18n.language)}
                    </Note>
                    {o.status === 'refunded' ? (
                      <Text style={styles.state}>{t('ops.orders.refunded')}</Text>
                    ) : o.fulfilment === 'none' ? (
                      <Text style={styles.state}>{t('ops.orders.digital')}</Text>
                    ) : o.fulfilment === 'cancelled' ? (
                      <Text style={styles.state}>{t('ops.orders.cancelled')}</Text>
                    ) : (
                      <View style={styles.steps} accessibilityLabel={t(`ops.orders.steps.${o.fulfilment}`)}>
                        {STEPS.map((step, i) => (
                          <View key={step} style={styles.step}>
                            <View style={[styles.dot, i <= reached && styles.dotOn]} />
                            <Text style={[styles.stepText, i <= reached && styles.stepOn]}>{t(`ops.orders.steps.${step}`)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {o.tracking_number ? (
                      <Note>{t('ops.orders.tracking', { carrier: o.carrier ?? '', number: o.tracking_number })}</Note>
                    ) : null}
                    {trackingLink ? <TextButton label={t('ops.orders.track')} onPress={() => void openTracking(o.id, trackingLink)} /> : null}
                    {linkFailed === o.id ? <Note>{t('ops.orders.trackFailed')}</Note> : null}
                  </Card>
                );
              })}
              <TextButton label={t('ops.orders.help')} onPress={() => router.push('/help')} />
            </View>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  paid: { gap: 8, marginBottom: 12 },
  order: { gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  state: { color: colors.muted, fontFamily: fonts.bold, fontSize: 14 },
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.cardBorder },
  dotOn: { backgroundColor: colors.logoIndigo },
  stepText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
  stepOn: { color: colors.text, fontFamily: fonts.bold },
});
